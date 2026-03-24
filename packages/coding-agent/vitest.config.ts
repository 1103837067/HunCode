import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve workspace `packages/agent` so tests use XML tool exports (registry tarball may lag source). */
const agentCoreSrc = path.resolve(__dirname, "../agent/src/index.ts");

export default defineConfig({
	resolve: {
		alias: {
			"@mariozechner/pi-agent-core": agentCoreSrc,
		},
	},
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000, // 30 seconds for API calls
		server: {
			deps: {
				external: [/@silvia-odwyer\/photon-node/],
			},
		},
	},
});
