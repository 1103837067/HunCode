import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LspServerConfig } from "./types.js";

function findUp(targets: string[], start: string, stop: string): string | undefined {
	let dir = start;
	while (true) {
		for (const target of targets) {
			if (existsSync(join(dir, target))) return dir;
		}
		if (dir === stop || dir === dirname(dir)) return undefined;
		dir = dirname(dir);
	}
}

function which(binary: string): boolean {
	const pathEnv = process.env.PATH ?? "";
	const dirs = pathEnv.split(process.platform === "win32" ? ";" : ":");
	for (const dir of dirs) {
		if (!dir) continue;
		if (existsSync(join(dir, binary))) return true;
		if (process.platform === "win32") {
			for (const ext of [".exe", ".cmd", ".bat"]) {
				if (existsSync(join(dir, binary + ext))) return true;
			}
		}
	}
	return false;
}

export const typescriptServer: LspServerConfig = {
	id: "typescript",
	extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
	async excludeWhen(file, workspaceDir) {
		const dir = dirname(file);
		return findUp(["deno.json", "deno.jsonc"], dir, workspaceDir) !== undefined;
	},
	async root(file, workspaceDir) {
		const dir = dirname(file);
		const lockRoot = findUp(
			["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"],
			dir,
			workspaceDir,
		);
		return lockRoot ?? workspaceDir;
	},
	command() {
		if (!which("typescript-language-server")) return undefined;
		return ["typescript-language-server", "--stdio"];
	},
};

export const defaultServers: LspServerConfig[] = [typescriptServer];
