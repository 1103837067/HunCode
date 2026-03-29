import type { ContextPill } from "../types/ui.js";
import { mapHostContextToPills, type PromptContext } from "./state.js";

export function adaptHostContext(context: PromptContext): ContextPill[] {
	return mapHostContextToPills(context);
}
