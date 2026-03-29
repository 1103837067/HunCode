import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { build, context } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const srcDir = resolve(packageRoot, "src");
const distDir = resolve(packageRoot, "dist");
const watchMode = process.argv.includes("--watch");
const skipWebview = process.argv.includes("--skip-webview");
const skipTailwind = process.argv.includes("--skip-tailwind");

function tailwindArgs(watch) {
	const args = [
		resolve(packageRoot, "node_modules", "tailwindcss", "lib", "cli.js"),
		"-c",
		resolve(packageRoot, "tailwind.config.ts"),
		"-i",
		resolve(srcDir, "webview", "styles", "globals.css"),
		"-o",
		resolve(distDir, "webview", "styles.css"),
		"--minify",
	];
	if (watch) args.push("--watch");
	return args;
}

async function runTailwindOnce() {
	await new Promise((resolvePromise, reject) => {
		const child = spawn(process.execPath, tailwindArgs(false), {
			cwd: packageRoot,
			stdio: "inherit",
		});
		child.on("exit", (code) => {
			if (code === 0) resolvePromise();
			else reject(new Error(`tailwindcss exited with code ${code ?? -1}`));
		});
		child.on("error", reject);
	});
}

function startTailwindWatch() {
	const child = spawn(process.execPath, tailwindArgs(true), {
		cwd: packageRoot,
		stdio: "inherit",
	});
	child.on("error", (error) => {
		console.error(error);
		process.exitCode = 1;
	});
	return child;
}

function extensionBuildOptions() {
	return {
		entryPoints: [resolve(srcDir, "extension.ts")],
		outfile: resolve(distDir, "extension.js"),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node20",
		external: ["vscode"],
		sourcemap: true,
		legalComments: "none",
	};
}

function webviewBuildOptions() {
	return {
		entryPoints: [resolve(srcDir, "webview", "main.tsx")],
		outfile: resolve(distDir, "webview", "main.js"),
		bundle: true,
		platform: "browser",
		format: "esm",
		target: "es2022",
		sourcemap: true,
		loader: {
			".css": "css",
		},
		legalComments: "none",
	};
}

async function createWatchContext(options) {
	const ctx = await context(options);
	await ctx.watch();
	return ctx;
}

async function main() {
	await rm(distDir, { recursive: true, force: true });
	await mkdir(resolve(distDir, "webview"), { recursive: true });

	if (!watchMode) {
		await build(extensionBuildOptions());
		if (!skipWebview) {
			await build(webviewBuildOptions());
		}
		if (!skipTailwind) {
			await runTailwindOnce();
		}
		return;
	}

	const backgroundProcesses = [];
	if (!skipTailwind) {
		backgroundProcesses.push(startTailwindWatch());
	}
	const contexts = await Promise.all([
		createWatchContext(extensionBuildOptions()),
		...(skipWebview ? [] : [createWatchContext(webviewBuildOptions())]),
	]);

	console.log("[pi-vscode-extension] watch mode ready");

	const shutdown = async () => {
		for (const child of backgroundProcesses) {
			child.kill();
		}
		await Promise.all(contexts.map((ctx) => ctx.dispose()));
	};

	process.on("SIGINT", () => {
		void shutdown().finally(() => process.exit(0));
	});
	process.on("SIGTERM", () => {
		void shutdown().finally(() => process.exit(0));
	});

	await new Promise(() => undefined);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
