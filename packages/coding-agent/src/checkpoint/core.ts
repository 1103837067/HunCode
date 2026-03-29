/**
 * Core checkpoint functions — git plumbing operations for creating and restoring snapshots.
 * No dependencies on the pi-coding-agent hook/extension system.
 *
 * Adapted from https://github.com/prateekmedia/pi-hooks (checkpoint-core.ts).
 */

import { spawn } from "child_process";
import { readdirSync, statSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// ============================================================================
// Constants & Types
// ============================================================================

export const ZEROS = "0".repeat(40);
export const REF_BASE = "refs/pi-checkpoints";

const MAX_UNTRACKED_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB
const MAX_UNTRACKED_DIR_FILES = 200;

const IGNORED_DIR_NAMES = new Set([
	"node_modules",
	".venv",
	"venv",
	"env",
	".env",
	"dist",
	"build",
	".pytest_cache",
	".mypy_cache",
	".cache",
	".tox",
	"__pycache__",
]);

export interface CheckpointData {
	id: string;
	turnIndex: number;
	sessionId: string;
	headSha: string;
	indexTreeSha: string;
	worktreeTreeSha: string;
	timestamp: number;
	preexistingUntrackedFiles?: string[];
	skippedLargeFiles?: string[];
	skippedLargeDirs?: string[];
}

// ============================================================================
// Git helpers
// ============================================================================

function parseArgs(cmd: string): string[] {
	const args: string[] = [];
	let current = "";
	let inSingleQuote = false;
	let inDoubleQuote = false;

	for (let i = 0; i < cmd.length; i++) {
		const char = cmd[i];
		if (char === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote;
		} else if (char === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote;
		} else if (char === " " && !inSingleQuote && !inDoubleQuote) {
			if (current) {
				args.push(current);
				current = "";
			}
		} else {
			current += char;
		}
	}
	if (current) args.push(current);
	return args;
}

export function git(cmd: string, cwd: string, opts: { env?: NodeJS.ProcessEnv; input?: string } = {}): Promise<string> {
	return new Promise((resolve, reject) => {
		const args = parseArgs(cmd);
		const proc = spawn("git", args, { cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"] });

		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (data) => {
			stdout += data;
		});
		proc.stderr.on("data", (data) => {
			stderr += data;
		});

		proc.on("close", (code) => {
			if (code === 0) resolve(stdout.trim());
			else reject(new Error(stderr || `git ${cmd} failed with code ${code}`));
		});
		proc.on("error", reject);

		if (opts.input && proc.stdin) {
			proc.stdin.write(opts.input);
			proc.stdin.end();
		} else if (proc.stdin) {
			proc.stdin.end();
		}
	});
}

export function gitLowPriority(cmd: string, cwd: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const args = parseArgs(cmd);
		const proc = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (data) => {
			stdout += data;
		});
		proc.stderr.on("data", (data) => {
			stderr += data;
		});

		proc.on("close", (code) => {
			if (code === 0) resolve(stdout.trim());
			else reject(new Error(stderr || `git ${cmd} failed with code ${code}`));
		});
		proc.on("error", reject);
	});
}

export const isGitRepo = (cwd: string) =>
	git("rev-parse --is-inside-work-tree", cwd)
		.then(() => true)
		.catch(() => false);

export const getRepoRoot = (cwd: string) => git("rev-parse --show-toplevel", cwd);

// ============================================================================
// Path filtering
// ============================================================================

export function shouldIgnoreForSnapshot(path: string): boolean {
	const components = path.split(/[/\\]/);
	return components.some((c) => IGNORED_DIR_NAMES.has(c));
}

function isLargeFile(root: string, relativePath: string): boolean {
	try {
		const stats = statSync(join(root, relativePath));
		return stats.isFile() && stats.size > MAX_UNTRACKED_FILE_SIZE;
	} catch {
		return false;
	}
}

function countFilesInDirectory(dirPath: string, maxCount: number): number {
	let count = 0;
	function recurse(currentPath: string): void {
		if (count > maxCount) return;
		try {
			const entries = readdirSync(currentPath, { withFileTypes: true });
			for (const entry of entries) {
				if (count > maxCount) return;
				if (entry.isDirectory()) recurse(join(currentPath, entry.name));
				else if (entry.isFile()) count++;
			}
		} catch {
			// permission errors etc.
		}
	}
	recurse(dirPath);
	return count;
}

function _isLargeDirectory(root: string, relativePath: string): boolean {
	try {
		const fullPath = join(root, relativePath);
		const stats = statSync(fullPath);
		if (!stats.isDirectory()) return false;
		return countFilesInDirectory(fullPath, MAX_UNTRACKED_DIR_FILES) >= MAX_UNTRACKED_DIR_FILES;
	} catch {
		return false;
	}
}

// ============================================================================
// Path helpers
// ============================================================================

function normalizeGitPath(p: string): string {
	let normalized = p.replace(/\\/g, "/");
	if (normalized.startsWith("./")) normalized = normalized.slice(2);
	return normalized.replace(/\/$/, "");
}

function getParentDir(p: string): string {
	const parts = p.split(/[/\\]/).filter(Boolean);
	if (parts.length <= 1) return ".";
	return parts.slice(0, -1).join("/");
}

function pathDepth(p: string): number {
	return p.split(/[/\\]/).filter(Boolean).length;
}

function isPathWithinDir(p: string, dir: string): boolean {
	if (!dir || dir === ".") return true;
	if (p === dir) return true;
	return p.startsWith(dir.endsWith("/") ? dir : `${dir}/`);
}

function isPathWithinAnyDir(p: string, dirs: Set<string>): boolean {
	for (const dir of dirs) {
		if (isPathWithinDir(p, dir)) return true;
	}
	return false;
}

function isPathAncestorOfAnyDir(p: string, dirs: Set<string>): boolean {
	for (const dir of dirs) {
		if (isPathWithinDir(dir, p)) return true;
	}
	return false;
}

function extractStatusPathAfterFields(record: string, fieldsBeforePath: number): string | null {
	if (fieldsBeforePath <= 0) return null;
	let spaces = 0;
	for (let i = 0; i < record.length; i++) {
		if (record[i] === " ") {
			spaces++;
			if (spaces === fieldsBeforePath) {
				const p = record.slice(i + 1);
				return p.length > 0 ? p : null;
			}
		}
	}
	return null;
}

interface LargeUntrackedDir {
	path: string;
	fileCount: number;
}

function detectLargeUntrackedDirs(files: string[], dirs: string[], threshold: number): LargeUntrackedDir[] {
	if (threshold <= 0 || files.length === 0) return [];

	const counts = new Map<string, number>();
	const sortedDirs = [...dirs].sort((a, b) => {
		const depthDiff = pathDepth(b) - pathDepth(a);
		return depthDiff !== 0 ? depthDiff : a.localeCompare(b);
	});

	for (const file of files) {
		let key: string | null = null;
		for (const dir of sortedDirs) {
			if (isPathWithinDir(file, dir)) {
				key = dir;
				break;
			}
		}
		if (!key) {
			const parent = getParentDir(file);
			key = parent || ".";
		}
		counts.set(key, (counts.get(key) || 0) + 1);
	}

	return [...counts.entries()]
		.filter(([, count]) => count >= threshold)
		.map(([p, fileCount]) => ({ path: p, fileCount }))
		.filter((entry) => entry.path && entry.path !== ".")
		.sort((a, b) => {
			const countDiff = b.fileCount - a.fileCount;
			return countDiff !== 0 ? countDiff : a.path.localeCompare(b.path);
		});
}

// ============================================================================
// Untracked file handling
// ============================================================================

async function getUntrackedFiles(root: string): Promise<string[]> {
	try {
		const output = await git("status --porcelain=v2 -uall", root);
		if (!output) return [];
		return output
			.split("\n")
			.filter((line) => line.startsWith("? "))
			.map((line) => normalizeGitPath(line.slice(2)))
			.filter((p) => p.length > 0);
	} catch {
		return [];
	}
}

async function addUntrackedToTree(
	root: string,
	baseTreeSha: string,
	untrackedFiles: string[],
): Promise<{
	treeSha: string;
	preexistingUntrackedFiles: string[];
	skippedLargeFiles: string[];
	skippedLargeDirs: string[];
}> {
	if (untrackedFiles.length === 0) {
		return { treeSha: baseTreeSha, preexistingUntrackedFiles: [], skippedLargeFiles: [], skippedLargeDirs: [] };
	}

	const preexistingUntrackedFiles = [...untrackedFiles];
	const skippedLargeFiles: string[] = [];
	const skippedLargeDirs: string[] = [];

	const filteredFiles: string[] = [];
	const filteredDirs: string[] = [];

	for (const file of untrackedFiles) {
		if (shouldIgnoreForSnapshot(file)) continue;
		if (isLargeFile(root, file)) {
			skippedLargeFiles.push(file);
			continue;
		}
		filteredFiles.push(file);
	}

	const largeDirs = detectLargeUntrackedDirs(filteredFiles, filteredDirs, MAX_UNTRACKED_DIR_FILES);
	const largeDirPaths = new Set(largeDirs.map((d) => d.path));

	for (const dir of largeDirs) {
		skippedLargeDirs.push(dir.path);
	}

	const filesToAdd = filteredFiles.filter((f) => !isPathWithinAnyDir(f, largeDirPaths));

	if (filesToAdd.length === 0) {
		return { treeSha: baseTreeSha, preexistingUntrackedFiles, skippedLargeFiles, skippedLargeDirs };
	}

	const tmpDir = await mkdtemp(join(tmpdir(), "pi-checkpoint-"));
	try {
		const indexFile = join(tmpDir, "index");
		const env = { ...process.env, GIT_INDEX_FILE: indexFile };

		await git(`read-tree ${baseTreeSha}`, root, { env });

		const BATCH_SIZE = 50;
		for (let i = 0; i < filesToAdd.length; i += BATCH_SIZE) {
			const batch = filesToAdd.slice(i, i + BATCH_SIZE);
			const pathArgs = batch.map((f) => `"${f}"`).join(" ");
			try {
				await git(`add --force -- ${pathArgs}`, root, { env });
			} catch {
				for (const file of batch) {
					try {
						await git(`add --force -- "${file}"`, root, { env });
					} catch {
						// skip individual failures
					}
				}
			}
		}

		const treeSha = await git("write-tree", root, { env });
		return { treeSha, preexistingUntrackedFiles, skippedLargeFiles, skippedLargeDirs };
	} finally {
		await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	}
}

// ============================================================================
// Checkpoint create / restore
// ============================================================================

export async function createCheckpoint(
	root: string,
	id: string,
	turnIndex: number,
	sessionId: string,
): Promise<CheckpointData> {
	const timestamp = Date.now();
	const isoTimestamp = new Date(timestamp).toISOString();

	const tmpDir = await mkdtemp(join(tmpdir(), "pi-checkpoint-"));
	try {
		let headSha: string;
		try {
			headSha = await git("rev-parse HEAD", root);
		} catch {
			headSha = ZEROS;
		}

		const indexTreeSha = await git("write-tree", root);

		const statusOutput = await git("status --porcelain=v2 -uall", root);
		const lines = statusOutput ? statusOutput.split("\n").filter(Boolean) : [];

		const modifiedFiles: string[] = [];
		const untrackedFilesRaw: string[] = [];

		for (const line of lines) {
			if (line.startsWith("1 ") || line.startsWith("2 ")) {
				const p = extractStatusPathAfterFields(line, line.startsWith("1 ") ? 8 : 9);
				if (p) modifiedFiles.push(normalizeGitPath(p));
			} else if (line.startsWith("? ")) {
				untrackedFilesRaw.push(normalizeGitPath(line.slice(2)));
			}
		}

		let worktreeTreeSha: string;
		let preexistingUntrackedFiles: string[] | undefined;
		let skippedLargeFiles: string[] = [];
		let skippedLargeDirs: string[] = [];

		if (modifiedFiles.length === 0 && untrackedFilesRaw.length === 0) {
			worktreeTreeSha = indexTreeSha;
		} else {
			const indexFile = join(tmpDir, "worktree-index");
			const env = { ...process.env, GIT_INDEX_FILE: indexFile };

			if (headSha !== ZEROS) {
				await git(`read-tree ${headSha}`, root, { env });
			}

			if (modifiedFiles.length > 0) {
				const BATCH_SIZE = 50;
				for (let i = 0; i < modifiedFiles.length; i += BATCH_SIZE) {
					const batch = modifiedFiles.slice(i, i + BATCH_SIZE);
					const pathArgs = batch.map((f) => `"${f}"`).join(" ");
					try {
						await git(`add --force -- ${pathArgs}`, root, { env });
					} catch {
						for (const file of batch) {
							try {
								await git(`add --force -- "${file}"`, root, { env });
							} catch {
								// skip
							}
						}
					}
				}
			}

			const baseTree = await git("write-tree", root, { env });

			const result = await addUntrackedToTree(root, baseTree, untrackedFilesRaw);
			worktreeTreeSha = result.treeSha;
			preexistingUntrackedFiles = result.preexistingUntrackedFiles;
			skippedLargeFiles = result.skippedLargeFiles;
			skippedLargeDirs = result.skippedLargeDirs;
		}

		const untrackedJson = JSON.stringify(preexistingUntrackedFiles ?? []);
		const largeFilesJson = JSON.stringify(skippedLargeFiles);
		const largeDirsJson = JSON.stringify(skippedLargeDirs);

		const message = [
			`checkpoint:${id}`,
			`sessionId ${sessionId}`,
			`turn ${turnIndex}`,
			`head ${headSha}`,
			`index-tree ${indexTreeSha}`,
			`worktree-tree ${worktreeTreeSha}`,
			`created ${isoTimestamp}`,
			`untracked ${untrackedJson}`,
			`largeFiles ${largeFilesJson}`,
			`largeDirs ${largeDirsJson}`,
		].join("\n");

		const commitEnv = {
			...process.env,
			GIT_AUTHOR_NAME: "pi-checkpoint",
			GIT_AUTHOR_EMAIL: "checkpoint@pi",
			GIT_AUTHOR_DATE: isoTimestamp,
			GIT_COMMITTER_NAME: "pi-checkpoint",
			GIT_COMMITTER_EMAIL: "checkpoint@pi",
			GIT_COMMITTER_DATE: isoTimestamp,
		};

		const commitSha = await git(`commit-tree ${worktreeTreeSha}`, root, {
			input: message,
			env: commitEnv,
		});

		await git(`update-ref ${REF_BASE}/${id} ${commitSha}`, root);

		return {
			id,
			turnIndex,
			sessionId,
			headSha,
			indexTreeSha,
			worktreeTreeSha,
			timestamp,
			preexistingUntrackedFiles,
			skippedLargeFiles: skippedLargeFiles.length > 0 ? skippedLargeFiles : undefined,
			skippedLargeDirs: skippedLargeDirs.length > 0 ? skippedLargeDirs : undefined,
		};
	} finally {
		await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	}
}

export async function restoreCheckpoint(root: string, cp: CheckpointData): Promise<void> {
	if (cp.headSha !== ZEROS) {
		await git(`reset --hard ${cp.headSha}`, root);
	}

	await git(`read-tree --reset -u ${cp.worktreeTreeSha}`, root);

	await safeCleanUntrackedFiles(
		root,
		cp.preexistingUntrackedFiles || [],
		cp.skippedLargeFiles || [],
		cp.skippedLargeDirs || [],
	);

	await git(`read-tree --reset ${cp.indexTreeSha}`, root);
}

async function safeCleanUntrackedFiles(
	root: string,
	preexistingFiles: string[],
	skippedLargeFiles: string[] = [],
	skippedLargeDirs: string[] = [],
): Promise<void> {
	const currentUntracked = await getUntrackedFiles(root);
	if (currentUntracked.length === 0) return;

	const preexistingSet = new Set(preexistingFiles);
	const skippedLargeFilesSet = new Set(skippedLargeFiles);
	const skippedLargeDirsSet = new Set(skippedLargeDirs);

	const filesToRemove = currentUntracked.filter((f) => {
		if (preexistingSet.has(f)) return false;
		if (shouldIgnoreForSnapshot(f)) return false;
		if (skippedLargeFilesSet.has(f)) return false;
		if (isPathWithinAnyDir(f, skippedLargeDirsSet)) return false;
		return true;
	});

	if (filesToRemove.length === 0) return;

	const BATCH_SIZE = 100;
	for (let i = 0; i < filesToRemove.length; i += BATCH_SIZE) {
		const batch = filesToRemove.slice(i, i + BATCH_SIZE);
		const pathArgs = batch.map((f) => `"${f}"`).join(" ");
		await git(`clean -f -- ${pathArgs}`, root).catch(() => {});
	}

	await git("clean -fd --dry-run", root)
		.then(async (output) => {
			const pathsToClean = output
				.split("\n")
				.filter((line) => line.startsWith("Would remove "))
				.map((line) => line.replace("Would remove ", "").replace(/\/$/, ""))
				.filter((p) => {
					if (shouldIgnoreForSnapshot(p)) return false;
					if (skippedLargeFilesSet.has(p)) return false;
					if (isPathWithinAnyDir(p, skippedLargeDirsSet)) return false;
					if (isPathAncestorOfAnyDir(p, skippedLargeDirsSet)) return false;
					return true;
				});

			for (const p of pathsToClean) {
				await git(`clean -fd -- "${p}"`, root).catch(() => {});
			}
		})
		.catch(() => {});
}

// ============================================================================
// Checkpoint loading
// ============================================================================

export async function loadCheckpointFromRef(
	root: string,
	refName: string,
	lowPriority = false,
): Promise<CheckpointData | null> {
	try {
		const gitFn = lowPriority ? gitLowPriority : git;
		const commitSha = await gitFn(`rev-parse --verify ${REF_BASE}/${refName}`, root);
		const commitMsg = await gitFn(`cat-file commit ${commitSha}`, root);

		const get = (key: string) => commitMsg.match(new RegExp(`^${key} (.+)$`, "m"))?.[1]?.trim();

		const sessionId = get("sessionId");
		const turn = get("turn");
		const head = get("head");
		const index = get("index-tree");
		const worktree = get("worktree-tree");
		const created = get("created");
		const untrackedJson = get("untracked");
		const largeFilesJson = get("largeFiles");
		const largeDirsJson = get("largeDirs");

		if (!sessionId || !turn || !head || !index || !worktree) return null;

		let preexistingUntrackedFiles: string[] | undefined;
		if (untrackedJson) {
			try {
				preexistingUntrackedFiles = JSON.parse(untrackedJson);
			} catch {
				// backwards compat
			}
		}

		let skippedLargeFiles: string[] | undefined;
		if (largeFilesJson) {
			try {
				const parsed = JSON.parse(largeFilesJson);
				if (parsed.length > 0) skippedLargeFiles = parsed;
			} catch {
				// backwards compat
			}
		}

		let skippedLargeDirs: string[] | undefined;
		if (largeDirsJson) {
			try {
				const parsed = JSON.parse(largeDirsJson);
				if (parsed.length > 0) skippedLargeDirs = parsed;
			} catch {
				// backwards compat
			}
		}

		return {
			id: refName,
			turnIndex: Number.parseInt(turn, 10),
			sessionId,
			headSha: head,
			indexTreeSha: index,
			worktreeTreeSha: worktree,
			timestamp: created ? new Date(created).getTime() : 0,
			preexistingUntrackedFiles,
			skippedLargeFiles,
			skippedLargeDirs,
		};
	} catch {
		return null;
	}
}

export async function listCheckpointRefs(root: string, lowPriority = false): Promise<string[]> {
	try {
		const prefix = `${REF_BASE}/`;
		const gitFn = lowPriority ? gitLowPriority : git;
		const stdout = await gitFn(`for-each-ref --format="%(refname)" ${prefix}`, root);
		return stdout
			.split("\n")
			.filter(Boolean)
			.map((ref) => ref.replace(prefix, ""));
	} catch {
		return [];
	}
}

export async function loadAllCheckpoints(
	root: string,
	sessionFilter?: string,
	lowPriority = false,
): Promise<CheckpointData[]> {
	const refs = await listCheckpointRefs(root, lowPriority);

	if (lowPriority) {
		const results: CheckpointData[] = [];
		const BATCH_SIZE = 3;
		for (let i = 0; i < refs.length; i += BATCH_SIZE) {
			const batch = refs.slice(i, i + BATCH_SIZE);
			const batchResults = await Promise.all(batch.map((ref) => loadCheckpointFromRef(root, ref, true)));
			results.push(
				...batchResults.filter(
					(cp): cp is CheckpointData => cp !== null && (!sessionFilter || cp.sessionId === sessionFilter),
				),
			);
			await new Promise((resolve) => setImmediate(resolve));
		}
		return results;
	}

	const results = await Promise.all(refs.map((ref) => loadCheckpointFromRef(root, ref)));
	return results.filter(
		(cp): cp is CheckpointData => cp !== null && (!sessionFilter || cp.sessionId === sessionFilter),
	);
}

// ============================================================================
// Utilities
// ============================================================================

export const isSafeId = (id: string) => /^[\w-]+$/.test(id);

export function findClosestCheckpoint(checkpoints: CheckpointData[], targetTs: number): CheckpointData {
	return checkpoints.reduce((best, cp) => {
		const bestDiff = Math.abs(best.timestamp - targetTs);
		const cpDiff = Math.abs(cp.timestamp - targetTs);
		if (cp.timestamp <= targetTs && best.timestamp > targetTs) return cp;
		if (best.timestamp <= targetTs && cp.timestamp > targetTs) return best;
		return cpDiff < bestDiff ? cp : best;
	});
}
