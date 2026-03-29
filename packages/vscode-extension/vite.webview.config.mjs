import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

function writePortToFile() {
	return {
		name: "write-port-to-file",
		configureServer(server) {
			server.httpServer?.once("listening", () => {
				const address = server.httpServer?.address();
				const port = typeof address === "object" && address ? address.port : null;
				if (port) {
					writeFileSync(resolve(__dirname, ".vite-port"), String(port));
				}
			});
		},
	};
}

export default defineConfig({
	plugins: [react(), writePortToFile()],
	server: {
		host: "127.0.0.1",
		port: 4173,
		hmr: {
			host: "127.0.0.1",
			protocol: "ws",
		},
		cors: {
			origin: "*",
		},
	},
});
