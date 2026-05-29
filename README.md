# AstraFlow Agent Studio

**AstraFlow Agent Studio（星流智能体工作台）** 是一个本地优先、跨平台、可视化的智能体桌面应用原型，目标是把通用 Agent 的任务规划、上下文编排、长期记忆、MCP/Skill 扩展、模型接入和 Token 成本治理放到一个产品化工作台里。

技术栈固定为 **Tauri 2 + React + TypeScript + Vite**，支持 Windows 和 macOS 桌面端，也可以用 Vite 作为网页预览运行。

## 核心能力

- **Agent Canvas**：用可视化节点展示 Planner、Memory、Context、MCP Tool、Skill、Model Call、Result 的执行链路，并支持点击节点查看输入输出、切换步骤状态、重试、请求审批和复制节点输入。
- **任务入口**：支持一句话手写任务、计划模式/直接执行切换、工作区文件夹选择、文件上传、图片上传和多模态任务附件。
- **Task Plan / Coding Plan**：任务开始前生成执行计划；代码类任务会额外生成影响范围、修改策略、验证命令和回滚建议。
- **Token Plan**：预估上下文大小、模型策略、输入/输出 Token、软预算和硬预算。
- **Token Monitor**：按任务、模型、Provider 聚合 Token 与费用，Provider 连通测试成功后也会写入用量记录。
- **Memory System**：支持 Profile、Project、Episodic、Procedural 四类记忆，包含本地存储位置、写入策略、生命周期、治理开关、来源、时间、置信度、启用状态，并支持手动添加、编辑、禁用和删除。
- **Context Inspector**：展示实际进入模型的上下文；只有发生超预算裁剪时才展示“被裁剪内容”。
- **MCP Center**：支持 stdio、HTTP/SSE 形态的 MCP Server 安装、启用、禁用和权限声明。
- **Skill Store**：支持从语义一句话推荐并安装 Skill，Skill 通过 Runtime 权限层调用工具。
- **Provider Hub**：统一配置 OpenAI-compatible、Anthropic、Gemini、小米 MiMo、DeepSeek、Qwen、Kimi、Zhipu、Ollama 等 Provider。
- **Sandbox & Approval**：按低/中/高风险拆分权限，Shell、删除、密钥读取、部署、Git push 等高风险动作必须审批。

## 目录结构

```text
.
├── sidecar/                 # Node.js/TypeScript Agent Runtime 原型
├── src/
│   ├── components/          # 工作台 UI 组件
│   ├── desktop/             # Tauri command 映射
│   ├── domain/              # 核心类型定义
│   ├── runtime/             # Planner、Context、Provider、Usage 等本地运行逻辑
│   ├── store/               # Zustand 本地状态与持久化
│   └── styles/              # 产品界面样式
├── src-tauri/               # Tauri 2 桌面壳
└── README.md
```

## 快速启动

```bash
npm install
npm run dev
```

默认访问地址：

```text
http://127.0.0.1:5173/
```

## 启动桌面端

首次运行桌面端需要安装 Rust：

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

然后启动 Tauri：

```bash
npm run tauri:dev
```

构建安装包：

```bash
npm run tauri:build
```

## 模型接入

进入 **模型接入中心** 后可以添加或编辑 Provider：

- 国内外 OpenAI-compatible API：填写 `Base URL`、模型名、价格和 API Key。
- Anthropic：使用原生 Messages API：`POST /v1/messages`，请求头包含 `x-api-key` 和 `anthropic-version`。
- Gemini：使用原生 `generateContent`：`POST /v1beta/models/{model}:generateContent`，请求头包含 `x-goog-api-key`。
- 小米 MiMo：使用 OpenAI-compatible Chat Completions：`POST /v1/chat/completions`，请求头使用 `api-key`。
- Ollama：本地无需 API Key，可直接测试 `http://localhost:11434/v1`。

桌面端的 API Key 保存和 Provider 连通测试已经迁入 Tauri 后端：

- 明文 API Key 由 Rust command 写入系统钥匙串，macOS 使用 Keychain，Windows 使用系统凭据存储。
- 前端 Zustand 持久化状态只保存 `maskedKey` 这类脱敏标记，位置是浏览器/WebView 的 `localStorage`。
- Provider 测试请求由 Tauri 后端发起，前端不直接持有持久化密钥，也不把明文 Key 写入日志或模型上下文。
- Vite 网页预览模式没有系统钥匙串能力，仅保留脱敏标记，适合界面调试。

Provider Adapter 已拆成独立运行时层：

- **OpenAI Chat Completions Adapter**：OpenAI-compatible、小米 MiMo、DeepSeek、Qwen、Kimi、Zhipu、Ollama。
- **Anthropic Messages Adapter**：Claude 原生接口，Token 统计映射 `input_tokens / output_tokens`。
- **Gemini generateContent Adapter**：Gemini 原生接口，Token 统计映射 `promptTokenCount / candidatesTokenCount`。

模型名称不硬编码为唯一选择，界面允许用户按 Provider 手动维护模型、上下文长度和价格表。

Token Monitor 会单独统计：

- prompt / completion / embedding Token。
- cached Token。
- 缓存命中率：`cachedTokens / (promptTokens + cachedTokens)`。
- 缓存单独成本：按 Provider 的“缓存命中价格 / 百万 Token”计算。
- 总成本：普通调用成本 + 缓存成本。

## 任务执行模式

聊天任务框支持两种执行模式：

- **计划模式**：只生成 Task Plan / Coding Plan，用户审批后再执行。
- **直接执行**：先生成计划，再自动执行低/中风险任务；如果识别到 Shell、密钥、删除、部署、Git push 等高风险动作，会自动切换到人工审批态。

桌面端点击 **选择工作区** 会打开系统文件夹选择器，并把本机路径写入任务上下文。网页预览受浏览器安全限制，不能读取完整本机路径，可先手动粘贴路径。

## 记忆架构

记忆模块放在本地 Agent Runtime 内，由三层组成：

- **SQLite metadata**：保存记忆类型、来源、置信度、启用状态、时间戳和任务关联。
- **LanceDB vector index**：保存 Profile、Project、Episodic、Procedural 四类向量索引。
- **Context Compiler**：按“当前任务 > 用户明确输入 > 选中文件/网页 > 相关记忆 > Skill 指令 > 历史摘要”的优先级注入上下文。

敏感信息不进入模型上下文；桌面端 API Key 只写入系统钥匙串，网页预览模式不持久化明文密钥。低置信度记忆先进入候选区，用户确认后再固化。

记忆记录可以在界面中直接管理：

- 手动添加新的 Profile / Project / Episodic / Procedural 记忆。
- 编辑记忆类型、来源、内容、置信度和启用状态。
- 禁用后不参与检索和上下文注入。
- 删除后从本地记忆列表移除，不再被后续任务使用。

## MCP 与 Skill

MCP 和 Skill 都可以通过一句话安装入口创建配置：

- MCP 安装会生成名称、传输方式、启动命令或 URL、权限和健康状态。
- Skill 安装会生成 `skill.json` 风格的 Manifest、`SKILL.md` 入口、权限和可选脚本。
- 新安装项默认不自动启用，用户确认后才进入 Agent Runtime。

## 常用脚本

```bash
npm run dev          # 启动 Vite 预览
npm run build        # TypeScript + Vite 构建
npm run test         # 运行 Vitest 单元测试
npm run runtime:dev  # 启动 Node.js sidecar 原型
npm run tauri:dev    # 启动 Tauri 桌面端
npm run tauri:build  # 构建桌面安装包
```

## 测试覆盖

当前测试覆盖重点：

- Provider Adapter 的价格与 Token 统计基础逻辑。
- Context Compiler 的排序、裁剪和上下文预算逻辑。
- Memory 的来源追踪和检索逻辑。
- Skill Manifest 与 MCP Manifest 的校验逻辑。
- UI 侧通过本地浏览器验证任务输入、上传、Provider 配置、Skill/MCP 安装和移动端导航。

## 产品状态

这是一个可运行的产品级前端与本地 Runtime 原型：核心信息架构、交互、状态持久化、可操作 Agent Canvas、Tauri 后端 Provider 测试、系统钥匙串 API Key 保存、Token 监控、Context Inspector、MCP/Skill 安装入口已经完成。后续要继续做成真正可发布的商业桌面应用，建议优先补齐：

- Tauri command 到 SQLite、LanceDB 的真实落库。
- MCP 进程管理与 HTTP/SSE 会话管理。
- Docker/Podman 沙箱执行器。
- 真实 Agent 任务队列、暂停/继续/重试和审批弹窗。
- Windows/macOS 安装包签名与自动更新。
