import type { WebviewState } from "../lib/state.js";
import { createInitialState, reduceAgentEvent, reduceState } from "../lib/state.js";
import type { ContextPill } from "../types/ui.js";

export { createInitialState, reduceAgentEvent, reduceState as reduceUiAction };

export type {
	BackendState,
	RpcState,
	SidebarView,
	WebviewAction as UIAction,
	WebviewState as ChatViewState,
} from "../lib/state.js";

export function appendUserPrompt(
	state: WebviewState,
	payload: { id: string; text: string; context?: ContextPill[] },
): WebviewState {
	return reduceState(state, {
		type: "appendUserPrompt",
		id: payload.id,
		text: payload.text,
		context: payload.context,
	});
}
