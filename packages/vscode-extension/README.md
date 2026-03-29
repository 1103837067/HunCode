# @mariozechner/pi-vscode-extension

VS Code extension package for pi.

## Scope

Current scope is a Sidebar chat MVP with:
- Activity Bar entry
- Sidebar webview host
- local backend process bridge
- typed RPC shell
- React/Tailwind webview runtime
- Chat / Settings page shell

The runtime reuses `@mariozechner/pi-coding-agent`; this package is a UI and integration layer.

## Scripts

- `pnpm --filter pi-vscode-extension run build`
- `pnpm --filter pi-vscode-extension run dev`
- `pnpm --filter pi-vscode-extension run dev:watch`
- `pnpm --filter pi-vscode-extension run dev:webview`
- `pnpm --filter pi-vscode-extension run check`
- `cd packages/vscode-extension && pnpm dlx @vscode/vsce package --allow-missing-repository --no-dependencies`

## Local UI development

Use VS Code's Extension Development Host instead of reinstalling a `.vsix` for every UI tweak.

### One-click VS Code workflow

The repo now includes ready-to-use VS Code task and launch configs:

- `.vscode/tasks.json`
- `.vscode/launch.json`

Recommended flow:

1. Open the repo root in VS Code.
2. Go to **Run and Debug**.
3. Start **`Run Pi VS Code Extension (HMR)`**.
4. Wait for the background task to start the webview dev server at `http://127.0.0.1:4173/` and the Extension Development Host to open.
5. Edit files under `packages/vscode-extension/src/webview/**`.
6. UI-only changes hot-update through Vite HMR.
7. If you change extension host or backend code, run **`Developer: Reload Window`** in the Extension Development Host.

### Terminal workflow

If you prefer the terminal:

1. Start both the extension/backend watcher and the webview Vite dev server:
   ```bash
   cd packages/vscode-extension
   pnpm run dev
   ```
2. In the repo root opened with VS Code, run the extension with **`Run Pi VS Code Extension`** or **`Run Pi VS Code Extension (HMR)`**.
3. Edit files under `src/webview/**`.
4. The webview connects to the local Vite dev server in development mode, so UI edits hot-update without rebuilding the packaged webview bundle.

### What each script does

- `pnpm run dev` — starts both host/backend watch and webview HMR dev server
- `pnpm run dev:watch` — watches extension host + backend only
- `pnpm run dev:webview` — runs the webview Vite dev server only

## Runtime architecture

- VS Code host activates the extension and opens the `Pi` Sidebar
- `ProcessManager` launches a local backend child process
- `RpcClient` communicates with the backend over stdio JSON lines
- The backend uses `SessionBridge` on top of `@mariozechner/pi-coding-agent`
- The webview is a React application bundled to `dist/webview/main.js`

## E2E smoke workflow

### Package

```bash
cd packages/vscode-extension
pnpm run build
pnpm dlx @vscode/vsce package --allow-missing-repository --no-dependencies
```

### Install

```bash
code --uninstall-extension mariozechner.pi-vscode-extension
code --install-extension packages/vscode-extension/pi-vscode-extension-0.0.0.vsix
```

### Smoke steps

1. Restart VS Code
2. Open the `Pi` activity bar item
3. Confirm the Sidebar is not blank
4. Confirm the debug banner is visible at the top
5. Switch between Chat and Settings
6. Open the Output panel and select `Pi`
7. Confirm you see activation / backend / rpc logs

### Logs to look for

- `[pi] Activating VS Code extension`
- `[pi] Starting pi backend: ...`
- `[pi][rpc] send init`
- `[pi][rpc] recv sessionReady`
- `[pi][rpc] recv models`
- `[pi][webview] ...` or `[pi][webview:error] ...`

If the page is blank, the Output panel plus the debug banner should now reveal whether the failure is in:
- webview mount
- runtime exception
- backend startup
- rpc event flow
- model/connection state
