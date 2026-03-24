export { createLspClient, type LspClientInfo } from "./client.js";
export { LspManager } from "./manager.js";
export { defaultServers, typescriptServer } from "./servers.js";
export type {
	LspClientState,
	LspClientStatus,
	LspDiagnostic,
	LspDiagnosticPosition,
	LspDiagnosticRange,
	LspServerConfig,
} from "./types.js";
export { LANGUAGE_EXTENSIONS, SEVERITY_LABELS } from "./types.js";
