import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as vscode from "vscode";

function findCliPath(): string {
	const startDir = dirname(fileURLToPath(import.meta.url));
	let dir = startDir;
	const prev = new Set<string>();
	while (!prev.has(dir)) {
		prev.add(dir);
		const candidate = join(dir, "node_modules", "@mariozechner", "pi-coding-agent", "dist", "cli.js");
		if (existsSync(candidate)) return candidate;
		dir = dirname(dir);
	}
	throw new Error(`Cannot find @mariozechner/pi-coding-agent/dist/cli.js (searched upward from ${startDir})`);
}

export class ProcessManager implements vscode.Disposable {
	private readonly output: vscode.OutputChannel;
	private child?: ChildProcessWithoutNullStreams;

	constructor(output: vscode.OutputChannel) {
		this.output = output;
	}

	start(): ChildProcessWithoutNullStreams {
		if (this.child && !this.child.killed) {
			return this.child;
		}

		const cliPath = findCliPath();
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		this.log(`Starting pi --mode rpc: ${cliPath} (cwd=${cwd ?? "<none>"})`);
		const child = spawn(process.execPath, [cliPath, "--mode", "rpc"], {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});

		child.on("error", (error) => {
			this.output.appendLine(`[pi] failed to start backend process: ${error.message}`);
		});

		child.stderr.on("data", (chunk: Buffer) => {
			this.output.append(chunk.toString());
		});

		child.on("exit", (code, signal) => {
			this.output.appendLine(`pi backend exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
			if (this.child === child) {
				this.child = undefined;
			}
		});

		this.child = child;
		return child;
	}

	stop(): void {
		if (!this.child) return;
		this.child.kill();
		this.child = undefined;
	}

	restart(): ChildProcessWithoutNullStreams {
		this.stop();
		return this.start();
	}

	getProcess(): ChildProcessWithoutNullStreams | undefined {
		return this.child;
	}

	log(message: string): void {
		this.output.appendLine(`[pi] ${message}`);
	}

	dispose(): void {
		this.stop();
	}
}
