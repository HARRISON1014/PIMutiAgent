# 连接适配与验证边界

角色配置与模型接入分开：`workflow.planner / reviewer / riskReviewer / defaultWorker` 引用连接 ID；`workerPool` 限制自动分配范围。手动任务可以引用任意已启用连接。规则匹配、用户锁定、备用权限和计划版本检查由调度器执行。

## API 协议

API 均通过 Pi 官方 provider 与 Agent 循环接入，支持结构化角色响应与工具执行。四个协议分别为：

| 协议 | 模型列表 | 请求适配 |
| --- | --- | --- |
| OpenAI Chat Completions | `/models`，Bearer | Pi `openAICompletionsApi` |
| OpenAI Responses | `/models`，Bearer | Pi `openAIResponsesApi` |
| Anthropic Messages | `/v1/models`，`x-api-key` | Pi `anthropicMessagesApi` |
| Google Gemini Native | `/models`，`x-goog-api-key` | Pi `googleGenerativeAIApi` |

厂商预设提供默认协议与端点，可以自行修改端点、模型 ID、上下文窗口和输出限制。部分厂商的地区、套餐端点或模型列表权限不同，实际推理测试才确认本次连接可调用。默认模型 ID 留空，避免把展示名称当成 API ID。

本地协议集成测试实际收发 HTTP / SSE，验证认证头、流式响应、结构化内容、用量和模型列表；Chat Completions 还实际执行主机文件工具。模拟测试不代表持有某家厂商的账号权益。

## 订阅 / 账号 CLI

订阅执行不是把文字建议当成工作完成。适配器将当前 Pi 对话与主机工具列表发给官方 CLI，请模型输出结构化动作，再由 Pi 校验和执行这些动作。只有允许的工具可调用；文件工具和本机命令确认规则与 API 执行一致。

| CLI | 认证 / 输出 | 原生工具限制 |
| --- | --- | --- |
| Codex | `login status` 检查 ChatGPT；`exec --json --output-schema` | `read-only`；宿主操作通过 Pi 工具协议完成 |
| Claude Code | `auth status` 检查账号 OAuth；`-p --output-format json --json-schema` | `--safe-mode --tools "" --disallowedTools "mcp__*"` |
| Gemini CLI | 强制 `oauth-personal`；`--output-format json` | 请求专用系统配置、空匹配原生工具集、拒绝策略与 plan 模式 |
| GitHub Copilot CLI | 复用官方账号；silent 文本响应并校验 JSON | 仅允许 `view` 读取请求文件，禁用内置 MCP，拒绝 shell / write / url / memory |
| Qwen Code | 校验已有 Qwen OAuth 认证选择；JSON 终态 | safe mode、0 原生工具调用预算、排除 agent |
| Kimi Code | 复用官方客户端账号；quiet 最终响应 | 请求专用 Agent，`tools: []` |

CLI 在请求专用目录运行。长上下文通过 stdin 传递；Copilot 通过只读请求文件传递，避免 Windows 命令行长度限制。标准 npm `.cmd` / `.ps1` shim 被解析到 Node JS 入口，以 `shell:false` 启动，不通过拼接 shell 命令传递任务。

Codex 在当前机器曾遇到 WebSocket 重试，HTTPS 请求成功。该适配默认只为本次子进程设置 `piagent_chatgpt` provider 和 HTTPS，不修改全局配置。需要默认传输时可将连接的 `transport` 设为 `auto`。

Claude 订阅模式使用 safe mode 保留账号认证；不使用会跳过 OAuth 的 bare mode。API 密钥环境变量不会传给订阅桥接子进程以触发自动计费切换。Kimi / Copilot 的实际账号套餐仍需在对应官方客户端确认，不能根据安装状态推断订阅资格。

CLI 参数可能随版本变化。不兼容时明确返回错误，不删除限制参数后偷偷重试。没有自动安装额外 CLI、替用户登录或从网页提取 Cookie。

## 已有验证

- 旧版核心回归测试与新增角色 / 分工测试通过。
- 任意角色选择、完全手动跳过规划、先规划后指定、固定规则、禁止静默换模型和审计返工保留分工均有调度测试。
- 新增 CLI 的参数、认证拒绝、工具限制、成功 / 失败输出解析通过进程模拟测试。
- 订阅桥接经过真实 Pi Agent 工具循环测试，实际写出产物文件；模拟的模型响应没有消耗厂商额度。
- Codex 的真实订阅结构化请求已验证；其他未提供账号或密钥的厂商，只声明协议适配已测试。
- 浏览器演示验证了选角色、人工改派、锁定标记、确认前零执行、确认后完成。

CLI 的内置只读模式和主机文件工具限制不构成操作系统沙箱。明确获准的任意代码具有当前用户权限。缺少用量的 CLI 请求会标记为未返回用量，不能据此推断零消耗。

## 官方资料

- [Pi 源码与 API](https://github.com/earendil-works/pi)
- [Codex 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode) · [传输配置](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Claude Code 自动化](https://code.claude.com/docs/en/headless) · [CLI 参数](https://code.claude.com/docs/en/cli-reference)
- [Gemini CLI 认证](https://geminicli.com/docs/get-started/authentication/) · [非交互输出](https://geminicli.com/docs/cli/headless/) · [策略](https://geminicli.com/docs/reference/policy-engine/)
- [GitHub Copilot CLI 参数](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
- [Qwen Code 非交互模式](https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/)
- [Kimi Code Agent 配置](https://moonshotai.github.io/kimi-cli/en/customization/agents.html)

预设端点还参考了本项目固定版本 Pi 包中对应厂商 provider 的公开定义。套餐密钥和普通 API 密钥应按官方账号对应的端点使用。
