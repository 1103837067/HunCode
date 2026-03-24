// Core Agent
export * from "./agent.js";
// Loop functions
export * from "./agent-loop.js";
// Proxy utilities
export * from "./proxy.js";
// Types
export * from "./types.js";
// XML-only tool invocation (no provider function calling)
export {
	augmentAssistantMessageForXmlStreaming,
	augmentAssistantMessageWithXmlToolCalls,
	coerceXmlStringArgs,
	type ParsedXmlToolCall,
	parseCompletedInvokeBlocks,
	parseXmlToolCallsFromText,
	stripParsedXmlToolBlocksFromText,
	stripStreamingXmlToolBlocksFromText,
	syntheticXmlToolCallId,
} from "./xml-tool-calls.js";
