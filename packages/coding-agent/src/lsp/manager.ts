import { extname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLspClient, type LspClientInfo } from "./client.js";
import { defaultServers } from "./servers.js";
import { type LspDiagnostic, type LspServerConfig, SEVERITY_LABELS } from "./types.js";

const MAX_DIAGNOSTICS_PER_FILE = 20;
const MAX_PROJECT_DIAGNOSTICS_FILES = 5;

export class LspManager {
	private readonly _cwd: string;
	private readonly _servers: LspServerConfig[];
	private readonly _clients: LspClientInfo[] = [];
	private readonly _spawning = new Map<string, Promise<LspClientInfo | undefined>>();
	private readonly _broken = new Set<string>();

	constructor(cwd: string, servers?: LspServerConfig[]) {
		this._cwd = cwd;
		this._servers = servers ?? [...defaultServers];
	}

	async touchFile(filePath: string, waitForDiagnostics = true): Promise<void> {
		const absPath = isAbsolute(filePath) ? filePath : resolve(this._cwd, filePath);
		const clients = await this._getClients(absPath);
		await Promise.all(
			clients.map(async (client) => {
				const waitPromise = waitForDiagnostics ? client.waitForDiagnostics(absPath) : Promise.resolve();
				await client.notify.open(absPath);
				return waitPromise;
			}),
		).catch(() => {});
	}

	getDiagnostics(filePath?: string): Map<string, LspDiagnostic[]> {
		const result = new Map<string, LspDiagnostic[]>();
		for (const client of this._clients) {
			if (filePath) {
				const absPath = isAbsolute(filePath) ? filePath : resolve(this._cwd, filePath);
				const diags = client.diagnostics.get(absPath);
				if (diags && diags.length > 0) {
					const existing = result.get(absPath) ?? [];
					existing.push(...diags);
					result.set(absPath, existing);
				}
			} else {
				for (const [path, diags] of client.diagnostics) {
					if (diags.length === 0) continue;
					const existing = result.get(path) ?? [];
					existing.push(...diags);
					result.set(path, existing);
				}
			}
		}
		return result;
	}

	formatDiagnosticsForLLM(editedFilePath: string): string {
		const absPath = isAbsolute(editedFilePath) ? editedFilePath : resolve(this._cwd, editedFilePath);

		const allDiags = this.getDiagnostics();
		let output = "";
		let projectDiagCount = 0;

		for (const [file, issues] of allDiags) {
			const errors = issues.filter((d) => d.severity === 1);
			if (errors.length === 0) continue;

			const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE);
			const suffix =
				errors.length > MAX_DIAGNOSTICS_PER_FILE
					? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more`
					: "";

			if (file === absPath) {
				output += `\n\nLSP errors detected in this file, please fix:\n${limited.map(prettyDiagnostic).join("\n")}${suffix}`;
				continue;
			}

			if (projectDiagCount >= MAX_PROJECT_DIAGNOSTICS_FILES) continue;
			projectDiagCount++;
			const relPath = file.startsWith(this._cwd) ? file.slice(this._cwd.length + 1) : file;
			output += `\n\nLSP errors in ${relPath}:\n${limited.map(prettyDiagnostic).join("\n")}${suffix}`;
		}

		return output;
	}

	async hover(filePath: string, line: number, character: number): Promise<unknown> {
		const absPath = isAbsolute(filePath) ? filePath : resolve(this._cwd, filePath);
		const clients = await this._getClients(absPath);
		for (const client of clients) {
			try {
				const result = await client.connection.sendRequest("textDocument/hover", {
					textDocument: { uri: pathToFileURL(absPath).href },
					position: { line, character },
				});
				if (result) return result;
			} catch {
				/* continue */
			}
		}
		return null;
	}

	async definition(filePath: string, line: number, character: number): Promise<unknown[]> {
		const absPath = isAbsolute(filePath) ? filePath : resolve(this._cwd, filePath);
		const clients = await this._getClients(absPath);
		const results: unknown[] = [];
		for (const client of clients) {
			try {
				const r = await client.connection.sendRequest("textDocument/definition", {
					textDocument: { uri: pathToFileURL(absPath).href },
					position: { line, character },
				});
				if (r) results.push(r);
			} catch {
				/* continue */
			}
		}
		return results.flat().filter(Boolean);
	}

	async references(filePath: string, line: number, character: number): Promise<unknown[]> {
		const absPath = isAbsolute(filePath) ? filePath : resolve(this._cwd, filePath);
		const clients = await this._getClients(absPath);
		const results: unknown[] = [];
		for (const client of clients) {
			try {
				const r = await client.connection.sendRequest("textDocument/references", {
					textDocument: { uri: pathToFileURL(absPath).href },
					position: { line, character },
					context: { includeDeclaration: true },
				});
				if (r) results.push(r);
			} catch {
				/* continue */
			}
		}
		return results.flat().filter(Boolean);
	}

	async documentSymbol(filePath: string): Promise<unknown[]> {
		const absPath = isAbsolute(filePath) ? filePath : resolve(this._cwd, filePath);
		const uri = pathToFileURL(absPath).href;
		const clients = await this._getClients(absPath);
		const results: unknown[] = [];
		for (const client of clients) {
			try {
				const r = await client.connection.sendRequest("textDocument/documentSymbol", {
					textDocument: { uri },
				});
				if (r) results.push(r);
			} catch {
				/* continue */
			}
		}
		return results.flat().filter(Boolean);
	}

	async workspaceSymbol(query: string): Promise<unknown[]> {
		const results: unknown[] = [];
		for (const client of this._clients) {
			if (client.state !== "ready") continue;
			try {
				const r = await client.connection.sendRequest("workspace/symbol", { query });
				if (Array.isArray(r)) results.push(...r.slice(0, 10));
			} catch {
				/* continue */
			}
		}
		return results;
	}

	getStatus(): { servers: Array<{ id: string; root: string; state: string }> } {
		return {
			servers: this._clients.map((c) => ({
				id: c.serverID,
				root: c.root,
				state: c.state,
			})),
		};
	}

	async hasClients(filePath: string): Promise<boolean> {
		const absPath = isAbsolute(filePath) ? filePath : resolve(this._cwd, filePath);
		const ext = extname(absPath);
		for (const server of this._servers) {
			if (server.extensions.length && !server.extensions.includes(ext)) continue;
			if (server.excludeWhen && (await server.excludeWhen(absPath, this._cwd))) continue;
			const root = await server.root(absPath, this._cwd);
			if (!root) continue;
			const key = root + server.id;
			if (this._broken.has(key)) continue;
			return true;
		}
		return false;
	}

	async shutdown(): Promise<void> {
		await Promise.all(this._clients.map((c) => c.shutdown().catch(() => {})));
		this._clients.length = 0;
		this._spawning.clear();
		this._broken.clear();
	}

	private async _getClients(absPath: string): Promise<LspClientInfo[]> {
		const ext = extname(absPath);
		const matched: LspClientInfo[] = [];

		for (const server of this._servers) {
			if (server.extensions.length && !server.extensions.includes(ext)) continue;
			if (server.excludeWhen && (await server.excludeWhen(absPath, this._cwd))) continue;

			const root = await server.root(absPath, this._cwd);
			if (!root) continue;

			const key = root + server.id;
			if (this._broken.has(key)) continue;

			const existing = this._clients.find((c) => c.root === root && c.serverID === server.id);
			if (existing) {
				matched.push(existing);
				continue;
			}

			const inflight = this._spawning.get(key);
			if (inflight) {
				const client = await inflight;
				if (client) matched.push(client);
				continue;
			}

			const task = this._spawnClient(server, root, key);
			this._spawning.set(key, task);
			task.finally(() => {
				if (this._spawning.get(key) === task) this._spawning.delete(key);
			});

			const client = await task;
			if (client) matched.push(client);
		}

		return matched;
	}

	private async _spawnClient(server: LspServerConfig, root: string, key: string): Promise<LspClientInfo | undefined> {
		const command = server.command(root);
		if (!command) {
			this._broken.add(key);
			return undefined;
		}

		try {
			const client = await createLspClient({
				serverID: server.id,
				command,
				root,
				cwd: this._cwd,
			});
			this._clients.push(client);
			return client;
		} catch {
			this._broken.add(key);
			return undefined;
		}
	}
}

function prettyDiagnostic(d: LspDiagnostic): string {
	const severity = SEVERITY_LABELS[d.severity ?? 1] ?? "ERROR";
	const line = d.range.start.line + 1;
	const col = d.range.start.character + 1;
	return `${severity} [${line}:${col}] ${d.message}`;
}
