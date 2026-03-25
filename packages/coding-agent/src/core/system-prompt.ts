/**
 * System prompt construction and project context loading
 */

import { execSync } from "node:child_process";
import * as os from "node:os";
import { getDocsPath, getExamplesPath, getReadmePath } from "../config.js";
import { buildCursorStyleDefaultSystemPrompt } from "./cursor-style-system-prompt.js";
import { formatSkillsForPrompt, type Skill } from "./skills.js";

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
	customPrompt?: string;
	selectedTools?: string[];
	toolSnippets?: Record<string, string>;
	promptGuidelines?: string[];
	appendSystemPrompt?: string;
	cwd?: string;
	contextFiles?: Array<{ path: string; content: string }>;
	skills?: Skill[];
}

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

		if (contextFiles.length > 0) {
			prompt += "\n\n# Project Context\n\n";
			prompt += "Project-specific instructions and guidelines:\n\n";
			for (const { path: filePath, content } of contextFiles) {
				prompt += `## ${filePath}\n\n${content}\n\n`;
			}
		}

		const customPromptHasRead = !selectedTools || selectedTools.includes("read");
		if (customPromptHasRead && skills.length > 0) {
			prompt += formatSkillsForPrompt(skills);
		}

		prompt += `\nCurrent date: ${date}`;
		prompt += `\nCurrent working directory: ${promptCwd}`;
		prompt += `\n${getEnvironmentInfo(resolvedCwd)}`;

		return prompt;
	}

	const readmePath = getReadmePath();
	const docsPath = getDocsPath();
	const examplesPath = getExamplesPath();

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

	if (contextFiles.length > 0) {
		prompt += "\n\n# Project Context\n\n";
		prompt += "Project-specific instructions and guidelines:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			prompt += `## ${filePath}\n\n${content}\n\n`;
		}
	}

	if (hasRead && skills.length > 0) {
		prompt += formatSkillsForPrompt(skills);
	}

	prompt += `\nCurrent date: ${date}`;
	prompt += `\nCurrent working directory: ${promptCwd}`;
	prompt += `\n${getEnvironmentInfo(resolvedCwd)}`;

	return prompt;
}
