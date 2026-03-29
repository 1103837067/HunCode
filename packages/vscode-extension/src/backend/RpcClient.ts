import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

type RpcResponse = {
	id?: string;
	type: "response";
	command: string;
	success: boolean;
	data?: unknown;
	error?: string;
};

function isRpcResponse(value: unknown): value is RpcResponse {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return (
		candidate.type === "response" && typeof candidate.command === "string" && typeof candidate.success === "boolean"
	);
}

type ExtensionUIRequest = Record<string, unknown> & { type: "extension_ui_request" };

function isExtensionUIRequest(value: unknown): value is ExtensionUIRequest {
	if (!value || typeof value !== "object") return false;
	return (value as Record<string, unknown>).type === "extension_ui_request";
}

export class RpcClient {
	private readonly events = new EventEmitter();
	private buffer = "";
	private process?: ChildProcessWithoutNullStreams;
	private readonly logger?: (message: string) => void;
	private readonly pendingResponses = new Map<
		string,
		{
			resolve: (response: RpcResponse) => void;
			reject: (error: Error) => void;
			timeout: ReturnType<typeof setTimeout>;
		}
	>();

	constructor(logger?: (message: string) => void) {
		this.logger = logger;
	}

	attach(process: ChildProcessWithoutNullStreams): void {
		this.detach();
		this.process = process;
		this.logger?.("attach child process");
		process.stdout.setEncoding("utf8");
		process.stdout.on("data", this.handleStdout);
	}

	detach(): void {
		if (!this.process) return;
		this.logger?.("detach child process");
		this.process.stdout.off("data", this.handleStdout);
		this.process = undefined;
		this.buffer = "";
		for (const [id, pending] of this.pendingResponses) {
			clearTimeout(pending.timeout);
			pending.reject(new Error(`RPC connection closed before response: ${id}`));
		}
		this.pendingResponses.clear();
	}

	sendCommand(command: Record<string, unknown>): void {
		if (!this.process?.stdin.writable) {
			throw new Error("Backend process is not available");
		}
		this.logger?.(`send ${String(command.type)}`);
		this.process.stdin.write(`${JSON.stringify(command)}\n`);
	}

	request<TResponse = unknown>(command: Record<string, unknown>, timeoutMs = 10000): Promise<TResponse> {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
		const requestCommand = { ...command, id };
		if (!this.process?.stdin.writable) {
			throw new Error("Backend process is not available");
		}
		this.logger?.(`request ${String(command.type)} (${id})`);
		return new Promise<TResponse>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingResponses.delete(id);
				reject(new Error(`RPC request timed out: ${String(command.type)}`));
			}, timeoutMs);
			this.pendingResponses.set(id, {
				resolve: (response) => {
					if (!response.success) {
						reject(new Error(response.error ?? `RPC request failed: ${String(command.type)}`));
						return;
					}
					resolve((response.data ?? undefined) as TResponse);
				},
				reject,
				timeout,
			});
			this.process?.stdin.write(`${JSON.stringify(requestCommand)}\n`);
		});
	}

	onEvent(listener: (event: Record<string, unknown>) => void): () => void {
		this.events.on("event", listener);
		return () => this.events.off("event", listener);
	}

	onExtensionUI(listener: (request: Record<string, unknown>) => void): () => void {
		this.events.on("extension_ui", listener);
		return () => this.events.off("extension_ui", listener);
	}

	private readonly handleStdout = (chunk: string | Buffer): void => {
		this.buffer += chunk.toString();
		const lines = this.buffer.split("\n");
		this.buffer = lines.pop() ?? "";
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const parsed = JSON.parse(trimmed) as Record<string, unknown>;
				if (isRpcResponse(parsed)) {
					this.logger?.(`recv response ${parsed.command}${parsed.id ? ` (${parsed.id})` : ""}`);
					if (parsed.id) {
						const pending = this.pendingResponses.get(parsed.id);
						if (pending) {
							clearTimeout(pending.timeout);
							this.pendingResponses.delete(parsed.id);
							pending.resolve(parsed);
						}
					}
				} else if (isExtensionUIRequest(parsed)) {
					this.logger?.(`recv extension_ui_request ${String(parsed.method)}`);
					this.events.emit("extension_ui", parsed);
				} else {
					this.logger?.(`recv ${String(parsed.type)}`);
					this.events.emit("event", parsed);
				}
			} catch {
				this.logger?.(`failed to parse stdout line: ${trimmed.slice(0, 100)}`);
			}
		}
	};
}
