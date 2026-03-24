import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	createMessageConnection,
	type MessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/lib/node/main.js";
import { LANGUAGE_EXTENSIONS, type LspClientState, type LspDiagnostic, type LspDiagnosticRange } from "./types.js";

const DIAGNOSTICS_DEBOUNCE_MS = 150;
const DIAGNOSTICS_TIMEOUT_MS = 3000;
const INITIALIZE_TIMEOUT_MS = 45_000;

export interface LspClientInfo {
	readonly serverID: string;
	readonly root: string;
	readonly connection: MessageConnection;
	readonly state: LspClientState;
	notify: {
		open(filePath: string): Promise<void>;
	};
	readonly diagnostics: Map<string, LspDiagnostic[]>;
	waitForDiagnostics(filePath: string): Promise<void>;
	shutdown(): Promise<void>;
}

export async function createLspClient(options: {
	serverID: string;
	command: string[];
	root: string;
	cwd: string;
}): Promise<LspClientInfo> {
	const { serverID, command, root, cwd } = options;
	const [binary, ...args] = command;

	const proc: ChildProcessWithoutNullStreams = spawn(binary, args, {
		cwd: root,
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env },
	});

	if (!proc.stdin || !proc.stdout || !proc.stderr) {
		throw new Error(`Failed to start LSP process: ${binary}`);
	}

	const connection = createMessageConnection(
		new StreamMessageReader(proc.stdout),
		new StreamMessageWriter(proc.stdin),
	);

	const storedDiagnostics = new Map<string, LspDiagnostic[]>();
	const diagnosticListeners = new Map<string, Array<() => void>>();
	let clientState: LspClientState = "starting";

	connection.onNotification("textDocument/publishDiagnostics", (params: { uri: string; diagnostics: unknown[] }) => {
		const filePath = normalizeFilePath(params.uri);
		const parsed = normalizeDiagnostics(params.diagnostics);
		storedDiagnostics.set(filePath, parsed);

		const listeners = diagnosticListeners.get(filePath);
		if (listeners) {
			for (const cb of listeners) cb();
		}
	});

	connection.onRequest("window/workDoneProgress/create", () => null);
	connection.onRequest("workspace/configuration", () => [{}]);
	connection.onRequest("client/registerCapability", () => undefined);
	connection.onRequest("client/unregisterCapability", () => undefined);
	connection.onRequest("workspace/workspaceFolders", () => [{ name: "workspace", uri: pathToFileURL(root).href }]);

	connection.listen();

	const initPromise = Promise.race([
		connection.sendRequest("initialize", {
			rootUri: pathToFileURL(root).href,
			processId: proc.pid,
			workspaceFolders: [{ name: "workspace", uri: pathToFileURL(root).href }],
			capabilities: {
				window: { workDoneProgress: true },
				workspace: {
					configuration: true,
					didChangeWatchedFiles: { dynamicRegistration: true },
				},
				textDocument: {
					synchronization: { didOpen: true, didChange: true },
					publishDiagnostics: { versionSupport: true },
				},
			},
		}),
		new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new Error(`LSP initialize timed out after ${INITIALIZE_TIMEOUT_MS}ms`)),
				INITIALIZE_TIMEOUT_MS,
			),
		),
	]);

	try {
		await initPromise;
	} catch (err) {
		proc.kill("SIGKILL");
		throw err;
	}

	await connection.sendNotification("initialized", {});
	clientState = "ready";

	const fileVersions = new Map<string, number>();

	const client: LspClientInfo = {
		serverID,
		root,
		connection,
		get state() {
			return clientState;
		},
		diagnostics: storedDiagnostics,

		notify: {
			async open(filePath: string) {
				const absPath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
				const text = await readFile(absPath, "utf-8");
				const ext = extname(absPath);
				const languageId = LANGUAGE_EXTENSIONS[ext] ?? "plaintext";
				const uri = pathToFileURL(absPath).href;

				const existingVersion = fileVersions.get(absPath);

				if (existingVersion !== undefined) {
					const nextVersion = existingVersion + 1;
					fileVersions.set(absPath, nextVersion);

					await connection.sendNotification("workspace/didChangeWatchedFiles", {
						changes: [{ uri, type: 2 }],
					});
					await connection.sendNotification("textDocument/didChange", {
						textDocument: { uri, version: nextVersion },
						contentChanges: [{ text }],
					});
				} else {
					fileVersions.set(absPath, 0);

					await connection.sendNotification("workspace/didChangeWatchedFiles", {
						changes: [{ uri, type: 1 }],
					});
					storedDiagnostics.delete(absPath);
					await connection.sendNotification("textDocument/didOpen", {
						textDocument: { uri, languageId, version: 0, text },
					});
				}
			},
		},

		async waitForDiagnostics(filePath: string) {
			const absPath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
			return new Promise<void>((resolvePromise) => {
				let debounceTimer: ReturnType<typeof setTimeout> | undefined;
				let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

				const cleanup = () => {
					if (debounceTimer) clearTimeout(debounceTimer);
					if (timeoutTimer) clearTimeout(timeoutTimer);
					const arr = diagnosticListeners.get(absPath);
					if (arr) {
						const idx = arr.indexOf(onDiag);
						if (idx >= 0) arr.splice(idx, 1);
						if (arr.length === 0) diagnosticListeners.delete(absPath);
					}
				};

				const done = () => {
					cleanup();
					resolvePromise();
				};

				const onDiag = () => {
					if (debounceTimer) clearTimeout(debounceTimer);
					debounceTimer = setTimeout(done, DIAGNOSTICS_DEBOUNCE_MS);
				};

				timeoutTimer = setTimeout(done, DIAGNOSTICS_TIMEOUT_MS);

				let arr = diagnosticListeners.get(absPath);
				if (!arr) {
					arr = [];
					diagnosticListeners.set(absPath, arr);
				}
				arr.push(onDiag);
			});
		},

		async shutdown() {
			clientState = "inactive";
			try {
				await Promise.race([connection.sendRequest("shutdown"), new Promise<void>((r) => setTimeout(r, 1000))]);
				connection.sendNotification("exit");
			} catch {
				// ignore
			}
			connection.end();
			connection.dispose();
			try {
				proc.kill("SIGTERM");
				await new Promise<void>((r) => {
					const t = setTimeout(() => {
						try {
							proc.kill("SIGKILL");
						} catch {
							/* ignore */
						}
						r();
					}, 2000);
					proc.once("exit", () => {
						clearTimeout(t);
						r();
					});
				});
			} catch {
				// ignore
			}
		},
	};

	proc.on("exit", () => {
		if (clientState === "ready") {
			clientState = "error";
		}
	});

	return client;
}

function normalizeFilePath(uri: string): string {
	try {
		return fileURLToPath(uri);
	} catch {
		return uri;
	}
}

function normalizeDiagnostics(raw: unknown[]): LspDiagnostic[] {
	if (!Array.isArray(raw)) return [];
	const result: LspDiagnostic[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const d = item as Record<string, unknown>;
		const message = typeof d.message === "string" ? d.message : undefined;
		const range = normalizeRange(d.range);
		if (!message || !range) continue;
		result.push({
			range,
			severity: typeof d.severity === "number" ? d.severity : undefined,
			code: typeof d.code === "string" || typeof d.code === "number" ? d.code : undefined,
			source: typeof d.source === "string" ? d.source : undefined,
			message,
		});
	}
	return result;
}

function normalizeRange(raw: unknown): LspDiagnosticRange | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Record<string, unknown>;
	const start = normalizePosition(r.start);
	const end = normalizePosition(r.end);
	if (!start || !end) return undefined;
	return { start, end };
}

function normalizePosition(raw: unknown): { line: number; character: number } | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const p = raw as Record<string, unknown>;
	if (typeof p.line !== "number" || typeof p.character !== "number") return undefined;
	return { line: p.line, character: p.character };
}
