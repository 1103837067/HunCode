/**
 * Checkpoint extension — creates an Extension object that plugs into the hook system.
 * Subscribes to turn_start, session_before_fork, session_before_tree, session_start,
 * session_fork, and session_shutdown.
 */

import type { Extension, ExtensionContext } from "../core/extensions/types.js";
import type { SourceInfo } from "../core/source-info.js";
import { CheckpointManager } from "./manager.js";

interface ForkEvent {
	entryId: string;
}

interface TreeEvent {
	preparation: { targetId: string };
}

interface TurnEvent {
	turnIndex: number;
}

export function createCheckpointExtension(cwd: string, sourceInfo: SourceInfo): Extension {
	const manager = new CheckpointManager(cwd);
	manager.initialize().catch(() => {});

	const handlers = new Map<string, Array<(...args: any[]) => any>>();

	function on(event: string, handler: (...args: any[]) => any): void {
		const list = handlers.get(event) ?? [];
		list.push(handler);
		handlers.set(event, list);
	}

	on("session_start", (_event: unknown, ctx: ExtensionContext) => {
		manager.updateSession(ctx.sessionManager.getSessionId());
	});

	on("session_fork", (_event: unknown, ctx: ExtensionContext) => {
		manager.updateSession(ctx.sessionManager.getSessionId());
	});

	on("turn_start", (event: TurnEvent) => {
		manager.createTurnCheckpoint(event.turnIndex);
	});

	on("session_before_fork", async (event: ForkEvent, ctx: ExtensionContext) => {
		if (!manager.isAvailable || !ctx.hasUI) return;

		const entry = ctx.sessionManager.getEntry(event.entryId);
		if (!entry) return;

		const targetTs = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();
		const header = ctx.sessionManager.getHeader();

		const checkpoint = await manager.loadForTarget(targetTs, {
			targetSessionId: ctx.sessionManager.getSessionId(),
			parentSessionFile: header?.parentSession,
		});
		if (!checkpoint) return;

		const choice = await ctx.ui.select("Restore code state?", [
			"Restore all (files + conversation)",
			"Conversation only (keep current files)",
			"Code only (restore files, keep conversation)",
			"Cancel",
		]);

		if (!choice || choice === "Cancel") {
			return { cancel: true };
		}
		if (choice.startsWith("Conversation only")) {
			return;
		}

		try {
			await manager.saveAndRestore(checkpoint);
			ctx.ui.notify("Files restored to checkpoint", "info");
		} catch (err) {
			ctx.ui.notify(`Restore failed: ${err instanceof Error ? err.message : String(err)}`, "error");
			return;
		}

		if (choice.startsWith("Code only")) {
			return { skipConversationRestore: true };
		}
	});

	on("session_before_tree", async (event: TreeEvent, ctx: ExtensionContext) => {
		if (!manager.isAvailable || !ctx.hasUI) return;

		const entry = ctx.sessionManager.getEntry(event.preparation.targetId);
		if (!entry) return;

		const isUser = "message" in entry && (entry as any).message?.role === "user";
		if (!isUser) return;

		const targetTs = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();
		const header = ctx.sessionManager.getHeader();

		const checkpoint = await manager.loadForTarget(targetTs, {
			targetSessionId: ctx.sessionManager.getSessionId(),
			parentSessionFile: header?.parentSession,
		});
		if (!checkpoint) return;

		const choice = await ctx.ui.select("Restore code state?", [
			"Restore files to this point",
			"Keep current files",
			"Cancel navigation",
		]);

		if (!choice || choice === "Cancel navigation") {
			return { cancel: true };
		}
		if (choice === "Keep current files") {
			return;
		}

		try {
			await manager.saveAndRestore(checkpoint);
			ctx.ui.notify("Files restored to checkpoint", "info");
		} catch (err) {
			ctx.ui.notify(`Restore failed: ${err instanceof Error ? err.message : String(err)}`, "error");
		}
	});

	on("session_shutdown", async () => {
		await manager.shutdown();
	});

	return {
		path: "<builtin:checkpoint>",
		resolvedPath: "<builtin:checkpoint>",
		sourceInfo,
		handlers: handlers as Extension["handlers"],
		tools: new Map(),
		messageRenderers: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
	};
}
