import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");

console.log("[pi-vscode-extension] dev starting");

function start(command, args, prefix, onLine) {
	const child = spawn(command, args, {
		cwd: packageRoot,
		stdio: ["ignore", "pipe", "pipe"],
		shell: false,
		env: { ...process.env },
	});

	const pipe = (stream) => {
		const rl = readline.createInterface({ input: stream });
		rl.on("line", (line) => {
			console.log(line);
			onLine?.(line);
		});
	};

	pipe(child.stdout);
	pipe(child.stderr);

	child.on("exit", (code) => {
		if (code && code !== 0) {
			console.error(`[${prefix}] exited with code ${code}`);
			process.exitCode = code;
		}
	});
	return child;
}

let watchReady = false;
let webviewReady = false;
let announcedReady = false;

function maybeAnnounceReady() {
	if (!announcedReady && watchReady && webviewReady) {
		announcedReady = true;
		console.log("[pi-vscode-extension] dev ready");
	}
}

const processes = [
	start("pnpm", ["run", "dev:watch"], "dev:watch", (line) => {
		if (line.includes("[pi-vscode-extension] watch mode ready")) {
			watchReady = true;
			maybeAnnounceReady();
		}
	}),
	start("pnpm", ["run", "dev:webview"], "dev:webview", (line) => {
		if (line.includes("Local:") && line.includes("127.0.0.1:")) {
			webviewReady = true;
			maybeAnnounceReady();
		}
	}),
];

const shutdown = () => {
	for (const child of processes) {
		child.kill();
	}
};

process.on("SIGINT", () => {
	shutdown();
	process.exit(0);
});

process.on("SIGTERM", () => {
	shutdown();
	process.exit(0);
});
