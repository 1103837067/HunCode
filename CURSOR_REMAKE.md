# Cursor Remake - 对比与进度

基于 Cursor Agent 的系统提示词、工具体系、交互行为，对 pi 项目进行对齐。

---

## 系统提示词对比

| Cursor section | pi 对应 | 状态 |
|---|---|---|
| `<tone_and_style>` | `<communication>` | done |
| `<tool_calling>` 多工具并行/串行 | `<tool_calling>` 第 6、7 点 | done |
| `<making_code_changes>` | `<making_code_changes>` | done |
| `<no_thinking_in_code_or_commands>` | `<no_thinking_in_code_or_commands>` | done |
| `<linter_errors>` ReadLints | `<making_code_changes>` 第 9 点 read_lints | done |
| `<search_and_reading>` | `<search_and_reading>` | done |
| `<debugging>` | `<debugging>` | done |
| `<calling_external_apis>` | `<calling_external_apis>` | done |
| `<citing_code>` startLine:endLine:filepath 引用 | 无 | skip (Cursor IDE UI 特有) |
| `<inline_line_numbers>` LINE_NUMBER\|LINE_CONTENT | 无 | skip (pi read 工具自带行号) |
| `<terminal_files_information>` 终端文件监控 | 无 | skip (Cursor IDE 特有) |
| `<mode_selection>` Agent/Plan/Debug/Ask 模式 | 无 | skip (Cursor IDE 特有 UI 模式) |

### 初始上下文数据

Cursor 首次对话时注入 OS、Shell、Git repo 信息。pi 已对齐：

- 文件：`packages/coding-agent/src/core/system-prompt.ts` → `getEnvironmentInfo()`
- 输出：`OS: darwin 25.1.0` / `Shell: /bin/zsh` / `Git repo: yes`

---

## 工具体系对比

### 内置工具

| Cursor 工具 | pi 工具 | 状态 |
|---|---|---|
| Read | read | done |
| Shell | bash | done |
| StrReplace (edit) | edit | done |
| Write | write | done |
| Grep | grep | done |
| Glob (find) | find | done |
| Ls (目录列表) | ls | done |
| ReadLints | read_lints | done |
| SemanticSearch | 无 | skip (需要向量索引基础设施) |
| WebSearch | 无 | skip (需要搜索 API) |
| WebFetch | 无 | skip (需要网络抓取) |
| GenerateImage | 无 | skip (需要图像生成 API) |
| Task (子 agent) | 无 | skip (高级功能) |
| EditNotebook | 无 | skip (Jupyter 特有) |
| AskQuestion | 无 | skip (Cursor IDE UI 特有) |
| SwitchMode | 无 | skip (Cursor IDE 特有) |

### 工具调用格式

| 方面 | Cursor | pi | 状态 |
|---|---|---|---|
| 格式 | `<function_calls><invoke name="...">` | `<function_calls><invoke name="...">` | done |
| 包裹层 | `<function_calls>` 统一包裹 | `<function_calls>` 统一包裹 | done |
| 参数格式 | `<parameter name="key">value</parameter>` | `<parameter name="key">value</parameter>` | done |
| 多工具调用 | 多个 `<invoke>` 在同一个 `<function_calls>` 内 | 多个 `<invoke>` 在同一个 `<function_calls>` 内 | done |
| 参数命名 | JSON schema key 直接使用 | JSON schema key 直接使用 (auto-derive) | done |

### XML 实体编码

- `&amp;` → `&`, `&lt;` → `<`, `&gt;` → `>`, `&quot;` → `"`, `&apos;` → `'`
- 文件：`packages/agent/src/xml-tool-calls.ts` → `decodeXmlEntities()`

### XmlToolCallSpec 类型

```typescript
export interface XmlToolCallSpec {
  parameterTags?: Record<string, string>;  // JSON key → XML parameter name (可选, 默认用 key 自身)
}
```

- `rootTag` 已删除 — 工具名直接写在 `<invoke name="tool_name">`
- `parameterTags` 可选 — 默认 auto-derive: 每个 JSON schema property key 映射为自身
- 工具定义无需手写 `xml` 字段，`resolveXmlSpec()` 自动从 TypeBox schema 推导

---

## 交互行为对比

### 工具调用后文字截断

Cursor 行为：`<function_calls>` 之后的任何文字被丢弃，不渲染、不捕获。

| 位置 | 处理 |
|---|---|
| `<function_calls>` 之前的文字 | 正常渲染给用户 |
| `<function_calls>` XML 块 | 解析为工具调用，执行 |
| `</function_calls>` 之后的文字 | 丢弃，当作不存在 |

pi 状态：**done** — `findFunctionCallsStart()` 定位 `<function_calls` 位置，`stripParsedXmlToolBlocksFromText()` 和 `stripStreamingXmlToolBlocksFromText()` 在该位置截断。

文件：`packages/agent/src/xml-tool-calls.ts`

### 流式渲染

Cursor 行为：
1. 流式接收文本
2. 检测到 `<function_calls` → 截断文字渲染
3. 检测到 `</invoke>` → 该工具立即开始执行
4. 流继续，下一个 `</invoke>` → 下一个工具立即执行
5. 流结束 → 等待所有执行完成，收集结果

pi 状态：**done**

- `stripStreamingXmlToolBlocksFromText` + `stripTrailingPartialTags` 处理流式文字截断（含部分标签 `<function_c`）
- `parseCompletedInvokeBlocks()` 在流式过程中检测已完成的 `<invoke>` 块
- `streamAssistantResponse` 的 `onInvokeComplete` 回调在 `</invoke>` 到达时立即触发
- `runLoop` 中的 `earlyExecutions` Map 管理已启动的工具执行 Promise
- `collectToolResults` 合并早期执行结果与后续执行结果

### write/edit 后自动 LSP 诊断

Cursor 行为：编辑文件后自动触发 linter 检查，错误注入到工具返回结果中。

pi 状态：**done** — `agent-session.ts` 的 `setAfterToolCall` 钩子检测 write/edit，调用 `lspManager.touchFile()` + `formatDiagnosticsForLLM()` 注入诊断。

---

## LSP 模块

替换外部 `@yofriadi/pi-lsp` 扩展为内置模块。

### 架构

```
packages/coding-agent/src/lsp/
├── types.ts      # LspDiagnostic, LspServerConfig, LANGUAGE_EXTENSIONS
├── client.ts     # vscode-jsonrpc 客户端，LSP 协议通信
├── servers.ts    # TypeScript Language Server 定义（可扩展）
├── manager.ts    # LspManager: 多客户端管理，lazy spawn，diagnostics
└── index.ts      # re-exports
```

### 工具

- 名称：`read_lints`（与 Cursor 的 `ReadLints` 对齐）
- 文件：`packages/coding-agent/src/core/tools/lsp.ts`
- 参数：`paths?: string[]`（可选，指定检查的文件/目录）
- 默认激活：是

### 依赖变更

- 新增：`vscode-jsonrpc@^8.2.1`
- 移除：`@yofriadi/pi-lsp`

### 语言支持

- 默认：TypeScript（`typescript-language-server --stdio`）
- 可扩展：`servers.ts` 中添加新的 `LspServerConfig`

### 集成点

- `agent-session.ts`：初始化 LspManager、注册 read_lints 工具、afterToolCall 诊断注入、dispose/reload 生命周期
- `main.ts`：移除 `@yofriadi/pi-lsp` 扩展加载

---

## 待办

- [ ] LSP 支持更多语言（Go、Python、Rust 等 server 定义）
- [ ] SemanticSearch 工具（需要向量索引基础设施）
- [ ] WebSearch / WebFetch 工具（需要搜索/抓取 API）
