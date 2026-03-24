export interface LspDiagnosticPosition {
	line: number;
	character: number;
}

export interface LspDiagnosticRange {
	start: LspDiagnosticPosition;
	end: LspDiagnosticPosition;
}

export interface LspDiagnostic {
	range: LspDiagnosticRange;
	severity?: number;
	code?: string | number;
	source?: string;
	message: string;
}

export type LspClientState = "inactive" | "starting" | "ready" | "error";

export interface LspClientStatus {
	state: LspClientState;
	reason: string;
	serverID: string;
	root: string;
	pid: number | undefined;
}

export interface LspServerConfig {
	id: string;
	extensions: string[];
	root(file: string, workspaceDir: string): Promise<string | undefined>;
	command(root: string): string[] | undefined;
	excludeWhen?: (file: string, workspaceDir: string) => Promise<boolean>;
}

export const LANGUAGE_EXTENSIONS: Record<string, string> = {
	".ts": "typescript",
	".tsx": "typescriptreact",
	".js": "javascript",
	".jsx": "javascriptreact",
	".mjs": "javascript",
	".cjs": "javascript",
	".mts": "typescript",
	".cts": "typescript",
	".json": "json",
	".py": "python",
	".pyi": "python",
	".go": "go",
	".rs": "rust",
	".c": "c",
	".cpp": "cpp",
	".h": "c",
	".hpp": "cpp",
	".java": "java",
	".rb": "ruby",
	".php": "php",
	".swift": "swift",
	".kt": "kotlin",
	".lua": "lua",
	".sh": "shellscript",
	".bash": "shellscript",
	".zsh": "shellscript",
	".css": "css",
	".html": "html",
	".vue": "vue",
	".svelte": "svelte",
	".yaml": "yaml",
	".yml": "yaml",
	".toml": "toml",
	".md": "markdown",
	".sql": "sql",
	".ex": "elixir",
	".exs": "elixir",
	".zig": "zig",
	".dart": "dart",
	".cs": "csharp",
	".fs": "fsharp",
};

export const SEVERITY_LABELS: Record<number, string> = {
	1: "ERROR",
	2: "WARN",
	3: "INFO",
	4: "HINT",
};
