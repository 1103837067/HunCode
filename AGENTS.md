# Development Rules

## First message

If the user did not give you a concrete task in their first message, read `README.md`, then ask which module(s) to work on. Based on the answer, read the relevant `README.md` files in parallel:

- `packages/ai/README.md`
- `packages/tui/README.md`
- `packages/agent/README.md`
- `packages/coding-agent/README.md`
- `packages/mom/README.md`
- `packages/pods/README.md`
- `packages/web-ui/README.md`

## Package manager

This monorepo uses **pnpm** (`packageManager` in root `package.json`). Install with `pnpm install`. Prefer `pnpm run <script>` at the repo root over `npm run`.

## Code quality

- No `any` types unless absolutely necessary
- Check `node_modules` for external API type definitions instead of guessing
- **NEVER use inline imports** — no `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always use standard top-level imports
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask before removing functionality or code that appears to be intentional
- Never hardcode key checks with, e.g., `matchesKey(keyData, "ctrl+x")`. All keybindings must be configurable. Add defaults to the matching object (`DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS`)

## Commands

- After **code** changes (not documentation-only changes): run **`pnpm run check`** at the repo root (full output, no tail). Fix all errors, warnings, and infos before committing
- `pnpm run check` does not run the full test suite
- NEVER run: `pnpm run dev`, `pnpm run build`, `pnpm test` unless the user explicitly asks
- Run **specific** tests only when the user instructs, from the **package** root, for example:
  ```bash
  cd packages/coding-agent && pnpm exec vitest --run test/tools.test.ts
  cd packages/agent && pnpm exec vitest --run test/xml-tool-calls.test.ts
  ```
- If you create or modify a test file, you MUST run that test file and iterate until it passes
- NEVER commit unless the user asks

## XML-only tool calls (Morph-style)

When working on `toolInvocation: "xml"` or Morph XML in assistant text:

- **Agent loop** (`packages/agent`): `augmentAssistantMessageForXmlStreaming` during `message_start` / `message_update` strips incomplete XML from assistant text and emits synthetic `toolCall`s with stable ids `xml-synthetic-0`, …; final turn uses `augmentAssistantMessageWithXmlToolCalls`
- **Coding agent** (`packages/coding-agent`): built-in tools with `ToolDefinition.xml` document XML in the system prompt; `ToolRenderContext` may include `toolResult` after execution so call renderers can drop streaming previews (see write tool)
- Parsing/stripping helpers live in `packages/agent/src/xml-tool-calls.ts`

## GitHub issues

When reading issues:

- Always read all comments on the issue
- Use one call:
  ```bash
  gh issue view <number> --json title,body,comments,labels,state
  ```

## OSS weekend

- If the user says `enable OSS weekend mode until X`, run `node scripts/oss-weekend.mjs --mode=close --end-date=YYYY-MM-DD --git` with the requested end date
- If the user says `end OSS weekend mode`, run `node scripts/oss-weekend.mjs --mode=open --git`
- The script updates `README.md`, `packages/coding-agent/README.md`, and `.github/oss-weekend.json`
- With `--git`, the script stages only those OSS weekend files, commits them, and pushes them

When creating issues:

- Add `pkg:*` labels: `pkg:agent`, `pkg:ai`, `pkg:coding-agent`, `pkg:mom`, `pkg:pods`, `pkg:tui`, `pkg:web-ui`
- If an issue spans multiple packages, add all relevant labels

When posting issue/PR comments:

- Write the full comment to a temp file and use `gh issue comment --body-file` or `gh pr comment --body-file`
- Never pass multi-line markdown directly via `--body` in shell commands
- Post exactly one final comment unless the user explicitly asks for multiple comments
- If a comment is malformed, delete it immediately, then post one corrected comment

When closing issues via commit:

- Include `fixes #<number>` or `closes #<number>` in the commit message

## PR workflow

- Analyze PRs without pulling locally first
- If the user approves: create a feature branch, pull PR, rebase on main, apply adjustments, commit, merge into main, push, close PR, and leave a comment in the user's tone
- Do not open PRs yourself unless the user asks

## Testing pi interactive mode (tmux)

```bash
tmux new-session -d -s pi-test -x 80 -y 24
tmux send-keys -t pi-test "cd <repo-root> && ./pi-test.sh" Enter
sleep 3 && tmux capture-pane -t pi-test -p
tmux send-keys -t pi-test "your prompt here" Enter
tmux send-keys -t pi-test Escape
tmux send-keys -t pi-test C-o
tmux kill-session -t pi-test
```

## Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- Technical prose only; be direct and kind

## Changelog

Location: `packages/*/CHANGELOG.md` (each package has its own).

### Format

Under `## [Unreleased]`:

- `### Breaking Changes`
- `### Added`
- `### Changed`
- `### Fixed`
- `### Removed`

### Rules

- Read the full `[Unreleased]` section before appending
- New entries only under `[Unreleased]`
- Append to existing subsections; do not duplicate subsection headers
- NEVER edit already-released version sections
- Attribution: internal `fixes #123` / external PR with `@username` as in repo convention

## Adding a new LLM provider (`packages/ai`)

See existing sections in this file and `packages/ai/README.md`: types, provider implementation, lazy registration, `generate-models.ts`, tests, coding-agent model resolver and docs, `packages/ai/CHANGELOG.md`.

## Releasing

Lockstep versioning across `@mariozechner/*` packages.

```bash
pnpm run release:patch   # fixes and additions
pnpm run release:minor   # API breaking changes
```

Ensure `[Unreleased]` CHANGELOGs are up to date before releasing.

## Critical: tools and edits

- NEVER use `sed`/`cat` to read files; use the editor read tool (with `offset`/`limit` for ranges)
- Read every file you modify in full before editing

## Critical: git (parallel agents)

### Committing

- ONLY commit files **you** changed in **this** session
- Use `fixes #<n>` / `closes #<n>` when there is a related issue
- NEVER `git add -A` or `git add .`
- `git add <path1> <path2> …` for your files only
- Before commit: `git status` and confirm staged files are yours

### Forbidden

- `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git commit --no-verify`
- Force push

### Safe workflow

```bash
git status
git add packages/agent/src/xml-tool-calls.ts packages/agent/CHANGELOG.md
git commit -m "fix(agent): description"
git pull --rebase && git push
```

If rebase conflicts appear in a file you did not touch, abort and ask the user.
