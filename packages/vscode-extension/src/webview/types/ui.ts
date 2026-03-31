export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export type SessionHistoryItem = {
	id: string;
	path: string;
	name?: string;
	preview: string;
	modifiedAt: string;
};

export type ContextPill =
	| { kind: "workspace"; label: string; workspacePath: string }
	| { kind: "current-file"; label: string; path: string; language?: string }
	| {
			kind: "selection";
			label: string;
			path: string;
			text: string;
			startLine?: number;
			endLine?: number;
	  };

export type TimelineUserItem = {
	kind: "user";
	id: string;
	text: string;
	context: ContextPill[];
};

export type ToolState = "running" | "success" | "error";

export type ToolLike = {
	id: string;
	toolName: string;
	/** Tool arguments (from tool_execution_start event) */
	args?: Record<string, unknown>;
	summary?: string;
	output: string;
	state: ToolState;
	isExpanded: boolean;
	rendererKey?: string;
	meta?: Record<string, unknown>;
	startedAt?: number;
	finishedAt?: number;
	/** Tool-specific details from result (e.g., diff for edit tool) */
	details?: Record<string, unknown>;
};

export type TimelineAssistantPart =
	| {
			kind: "thinking";
			id: string;
			text: string;
	  }
	| {
			kind: "text";
			id: string;
			text: string;
	  }
	| ({
			kind: "tool";
			toolCallId: string;
	  } & ToolLike);

export type TimelineAssistantItem = {
	kind: "assistant";
	id: string;
	text: string;
	parts: TimelineAssistantPart[];
	isStreaming: boolean;
	streamState?: "thinking" | "responding" | "completed";
	// compatibility fields during migration
	thinkingText?: string;
	resultText?: string;
	toolCallIds?: string[];
	lastToolCallId?: string;
};

export type TimelineToolItem = {
	kind: "tool";
	assistantMessageId?: string;
} & ToolLike;

export type TimelineSystemItem = {
	kind: "system";
	id: string;
	level: "info" | "error";
	text: string;
};

export type TimelineItem = TimelineUserItem | TimelineAssistantItem | TimelineToolItem | TimelineSystemItem;

export type ChatStatus = "ready" | "thinking" | "running-tools" | "error";

export type ProviderConfigState = {
	baseUrl?: string;
	api?: string;
	apiKey?: string;
	authHeader?: boolean;
	headers?: Record<string, string>;
	compat?: Record<string, unknown>;
};

export type ConfigureProviderPayload = {
	provider: string;
	baseUrl: string;
	api: string;
	apiKey: string;
	authHeader?: boolean;
	headers?: Record<string, string>;
	compat?: Record<string, unknown>;
};

export type ConfigureModelPayload = {
	provider: string;
	modelId: string;
	name?: string;
	reasoning?: boolean;
	input?: Array<"text" | "image">;
	contextWindow?: number;
	maxTokens?: number;
	headers?: Record<string, string>;
	cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
	compat?: Record<string, unknown>;
};

export type ChatViewState = {
	connectionState: ConnectionState;
	status: ChatStatus;
	sessionId?: string;
	model?: string;
	availableModels: Array<{ id: string; provider: string; label: string }>;
	draft: string;
	contextPills: ContextPill[];
	timeline: TimelineItem[];
	activeAssistantMessageId?: string;
	activeToolCallIds: string[];
	lastError?: string;
};

export type UIAction =
	| { type: "setDraft"; draft: string }
	| { type: "setConnectionState"; connectionState: ConnectionState }
	| { type: "setContextPills"; pills: ContextPill[] }
	| {
			type: "appendUserPrompt";
			id: string;
			text: string;
			context?: {
				workspacePath?: string;
				currentFile?: { path: string; language?: string };
				selection?: { path: string; text: string; startLine?: number; endLine?: number };
			};
	  }
	| { type: "toggleToolExpanded"; toolCallId: string }
	| { type: "reset" };
