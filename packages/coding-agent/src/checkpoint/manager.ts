/**
 * CheckpointManager — state management wrapper around the core git checkpoint operations.
 * Tracks the current session, caches checkpoints, and provides the high-level API
 * that AgentSession integrates with.
 */

import { spawn } from "child_process";
import {
	type CheckpointData,
	createCheckpoint,
	getRepoRoot,
	isGitRepo,
	isSafeId,
	listCheckpointRefs,
	loadCheckpointFromRef,
	restoreCheckpoint,
} from "./core.js";

// ============================================================================
// State
// ============================================================================

export class CheckpointManager {
	private gitAvailable = false;
	private checkpointingFailed = false;
	private currentSessionId = "";
	private checkpointCache: CheckpointData[] | null = null;
	private pendingCheckpoint: Promise<void> | null = null;

	private cachedRepoRoot: string | null = null;

	constructor(private cwd: string) {}

	get isAvailable(): boolean {
		return this.gitAvailable && !this.checkpointingFailed;
	}

	// ========================================================================
	// Lifecycle
	// ========================================================================

	async initialize(): Promise<void> {
		this.gitAvailable = await isGitRepo(this.cwd);
		if (this.gitAvailable) {
			try {
				this.cachedRepoRoot = await getRepoRoot(this.cwd);
			} catch {
				this.gitAvailable = false;
			}
		}
	}

	updateSession(sessionId: string): void {
		if (sessionId && isSafeId(sessionId)) {
			this.currentSessionId = sessionId;
		}
	}

	async shutdown(): Promise<void> {
		if (this.pendingCheckpoint) {
			await this.pendingCheckpoint.catch(() => {});
		}
	}

	// ========================================================================
	// Checkpoint creation
	// ========================================================================

	createTurnCheckpoint(turnIndex: number): void {
		if (!this.gitAvailable || this.checkpointingFailed || !this.currentSessionId) return;

		this.pendingCheckpoint = (async () => {
			try {
				const root = await this.getRoot();
				const id = `${this.currentSessionId}-turn-${turnIndex}-${Date.now()}`;
				const cp = await createCheckpoint(root, id, turnIndex, this.currentSessionId);
				this.addToCache(cp);
			} catch {
				this.checkpointingFailed = true;
			}
		})();
	}

	// ========================================================================
	// Checkpoint loading
	// ========================================================================

	async loadForTarget(
		targetTs: number,
		opts?: {
			targetTurnIndex?: number;
			targetSessionId?: string;
			parentSessionFile?: string;
		},
	): Promise<CheckpointData | null> {
		if (!this.gitAvailable) return null;
		if (this.pendingCheckpoint) await this.pendingCheckpoint;

		const sessionIds: string[] = [];
		const directSessionIds: string[] = [];

		const targetSessionId =
			opts?.targetSessionId && isSafeId(opts.targetSessionId) ? opts.targetSessionId : undefined;

		if (targetSessionId) {
			directSessionIds.push(targetSessionId);
		} else if (this.currentSessionId) {
			directSessionIds.push(this.currentSessionId);
		}
		for (const id of directSessionIds) sessionIds.push(id);

		// Walk parent session chain (fork lineage)
		const visited = new Set<string>();
		const MAX_DEPTH = 50;
		let parentFile = opts?.parentSessionFile;
		let depth = 0;
		while (parentFile && depth < MAX_DEPTH) {
			if (visited.has(parentFile)) break;
			visited.add(parentFile);
			depth++;

			const match = parentFile.match(/_([0-9a-f-]{36})\.jsonl$/);
			if (match && isSafeId(match[1]) && !sessionIds.includes(match[1])) {
				sessionIds.push(match[1]);
			}
			try {
				const line = await readFirstLine(parentFile);
				const next = line ? extractJsonField(line, "parentSession") : undefined;
				parentFile = next && next !== parentFile ? next : undefined;
			} catch {
				break;
			}
		}

		if (sessionIds.length === 0) return null;

		const root = await this.getRoot();

		// Try direct lookup by turn index first
		if (
			typeof opts?.targetTurnIndex === "number" &&
			Number.isFinite(opts.targetTurnIndex) &&
			directSessionIds.length > 0
		) {
			for (const sid of directSessionIds) {
				const candidateId = `${sid}-turn-${opts.targetTurnIndex}-${targetTs}`;
				const cached = this.getCachedById(candidateId);
				if (cached) return cached;

				const direct = await loadCheckpointFromRef(root, candidateId, true);
				if (direct) {
					this.addToCache(direct);
					return direct;
				}
			}
		}

		// Fallback: scan all refs and find closest
		const refs = await listCheckpointRefs(root, true);
		if (refs.length === 0) return null;

		const refInfos: Array<{ id: string; timestamp: number }> = [];
		for (const ref of refs) {
			const matchesSession = sessionIds.some((id) => ref.startsWith(`${id}-`));
			if (!matchesSession) continue;
			const timestamp = parseTimestampFromId(ref);
			if (timestamp === undefined) continue;
			refInfos.push({ id: ref, timestamp });
		}
		if (refInfos.length === 0) return null;

		const exactRef = refInfos.find((r) => r.timestamp === targetTs);
		const bestRef = exactRef ?? findClosestRef(refInfos, targetTs);
		if (!bestRef) return null;

		const cached = this.getCachedById(bestRef.id);
		if (cached) return cached;

		const cp = await loadCheckpointFromRef(root, bestRef.id, true);
		if (cp) this.addToCache(cp);
		return cp ?? null;
	}

	// ========================================================================
	// Restore
	// ========================================================================

	async saveAndRestore(target: CheckpointData): Promise<void> {
		const root = await this.getRoot();
		const beforeId = `${this.currentSessionId}-before-restore-${Date.now()}`;
		const saveCp = await createCheckpoint(root, beforeId, 0, this.currentSessionId);
		this.addToCache(saveCp);
		await restoreCheckpoint(root, target);
	}

	// ========================================================================
	// Internal
	// ========================================================================

	private async getRoot(): Promise<string> {
		if (!this.cachedRepoRoot) {
			this.cachedRepoRoot = await getRepoRoot(this.cwd);
		}
		return this.cachedRepoRoot;
	}

	private addToCache(cp: CheckpointData): void {
		if (!this.checkpointCache) this.checkpointCache = [];
		if (this.checkpointCache.some((existing) => existing.id === cp.id)) return;
		this.checkpointCache.push(cp);
	}

	private getCachedById(id: string): CheckpointData | undefined {
		return this.checkpointCache?.find((cp) => cp.id === id);
	}
}

// ============================================================================
// Helpers (no git dependency)
// ============================================================================

function parseTimestampFromId(id: string): number | undefined {
	const lastDash = id.lastIndexOf("-");
	if (lastDash === -1 || lastDash === id.length - 1) return undefined;
	const ts = Number(id.slice(lastDash + 1));
	return Number.isFinite(ts) ? ts : undefined;
}

function findClosestRef(
	refs: Array<{ id: string; timestamp: number }>,
	targetTs: number,
): { id: string; timestamp: number } | undefined {
	if (refs.length === 0) return undefined;
	return refs.reduce((best, ref) => {
		const bestDiff = Math.abs(best.timestamp - targetTs);
		const refDiff = Math.abs(ref.timestamp - targetTs);
		if (ref.timestamp <= targetTs && best.timestamp > targetTs) return ref;
		if (best.timestamp <= targetTs && ref.timestamp > targetTs) return best;
		return refDiff < bestDiff ? ref : best;
	});
}

function readFirstLine(filePath: string): Promise<string> {
	return new Promise((resolve) => {
		const proc = spawn("head", ["-1", filePath], { stdio: ["ignore", "pipe", "ignore"] });
		let data = "";
		proc.stdout.on("data", (chunk) => {
			data += chunk;
		});
		proc.on("close", () => resolve(data.trim()));
		proc.on("error", () => resolve(""));
	});
}

function extractJsonField(line: string, field: string): string | undefined {
	const regex = new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`, "i");
	const match = line.match(regex);
	return match?.[1] || undefined;
}
