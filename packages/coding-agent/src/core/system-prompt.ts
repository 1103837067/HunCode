/**
 * System prompt construction and project context loading
 */

import { execSync } from "node:child_process";
import * as os from "node:os";
import { getDocsPath, getExamplesPath, getReadmePath } from "../config.js";
import { buildCursorStyleDefaultSystemPrompt } from "./cursor-style-system-prompt.js";
import type { ToolDefinition } from "./extensions/types.js";
import { formatSkillsForPrompt, type Skill } from "./skills.js";
import { buildXmlToolCallsPromptSection } from "./xml-tool-registration.js";

function getEnvironmentInfo(cwd: string): string {
	const platform = `${process.platform} ${os.release()}`;
	const shell = process.env.SHELL ?? process.env.COMSPEC ?? "unknown";
	let isGitRepo = false;
	try {
		execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" });
		isGitRepo = true;
	} catch {}
	return [`OS: ${platform}`, `Shell: ${shell}`, `Git repo: ${isGitRepo ? "yes" : "no"}`].join("\n");
}

export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces default). */
	customPrompt?: string;
	/** Tools to include in prompt. Default: all built-in tools */
	selectedTools?: string[];
	/** Optional one-line tool snippets keyed by tool name. */
	toolSnippets?: Record<string, string>;
	/** Additional guideline bullets appended after the default gist-style body (## Additional guidelines). */
	promptGuidelines?: string[];
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Working directory. Default: process.cwd() */
	cwd?: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: Skill[];
	/**
	 * Tools that declare `ToolDefinition.xml`. When non-empty, appends Morph-style XML documentation
	 * for those tools (same parameters as the JSON tool API).
	 */
	xmlToolDefinitions?: ToolDefinition[];
}

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions = {}): string {
	const {
		customPrompt,
		selectedTools,
		toolSnippets,
		promptGuidelines,
		appendSystemPrompt,
		cwd,
		contextFiles: providedContextFiles,
		skills: providedSkills,
		xmlToolDefinitions,
	} = options;
	const resolvedCwd = cwd ?? process.cwd();
	const promptCwd = resolvedCwd.replace(/\\/g, "/");

	const date = new Date().toISOString().slice(0, 10);

	const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";

	const contextFiles = providedContextFiles ?? [];
	const skills = providedSkills ?? [];

	if (customPrompt) {
		let prompt = customPrompt;

		if (appendSection) {
			prompt += appendSection;
		}

		// Append project context files
		if (contextFiles.length > 0) {
			prompt += "\n\n# Project Context\n\n";
			prompt += "Project-specific instructions and guidelines:\n\n";
			for (const { path: filePath, content } of contextFiles) {
				prompt += `## ${filePath}\n\n${content}\n\n`;
			}
		}

		// Append skills section (only if read tool is available)
		const customPromptHasRead = !selectedTools || selectedTools.includes("read");
		if (customPromptHasRead && skills.length > 0) {
			prompt += formatSkillsForPrompt(skills);
		}

		prompt += buildXmlToolCallsPromptSection(xmlToolDefinitions ?? []);

		prompt += `\nCurrent date: ${date}`;
		prompt += `\nCurrent working directory: ${promptCwd}`;
		prompt += `\n${getEnvironmentInfo(resolvedCwd)}`;

		return prompt;
	}

	// Get absolute paths to documentation and examples
	const readmePath = getReadmePath();
	const docsPath = getDocsPath();
	const examplesPath = getExamplesPath();

	// Build tools list based on selected tools.
	// A tool appears in Available tools only when the caller provides a one-line snippet.
	const tools = selectedTools || ["read", "bash", "edit", "write", "grep", "find", "ls", "read_lints"];
	const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
	const toolsList =
		visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n") : "(none)";

	const hasRead = tools.includes("read");

	let prompt = buildCursorStyleDefaultSystemPrompt({
		toolsList,
		selectedTools: tools,
		readmePath,
		docsPath,
		examplesPath,
	});

	if (promptGuidelines?.length) {
		const guidelinesSet = new Set<string>();
		const guidelinesList: string[] = [];
		for (const guideline of promptGuidelines) {
			const normalized = guideline.trim();
			if (normalized.length > 0 && !guidelinesSet.has(normalized)) {
				guidelinesSet.add(normalized);
				guidelinesList.push(normalized);
			}
		}
		if (guidelinesList.length > 0) {
			prompt += `\n\n## Additional guidelines\n\n${guidelinesList.map((g) => `- ${g}`).join("\n")}`;
		}
	}

	if (appendSection) {
		prompt += appendSection;
	}

	// Append project context files
	if (contextFiles.length > 0) {
		prompt += "\n\n# Project Context\n\n";
		prompt += "Project-specific instructions and guidelines:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			prompt += `## ${filePath}\n\n${content}\n\n`;
		}
	}

	// Append skills section (only if read tool is available)
	if (hasRead && skills.length > 0) {
		prompt += formatSkillsForPrompt(skills);
	}

	prompt += buildXmlToolCallsPromptSection(xmlToolDefinitions ?? []);

	prompt += `\nCurrent date: ${date}`;
	prompt += `\nCurrent working directory: ${promptCwd}`;
	prompt += `\n${getEnvironmentInfo(resolvedCwd)}`;

	return prompt;
}
