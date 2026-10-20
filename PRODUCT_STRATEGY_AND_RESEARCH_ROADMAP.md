# Mac MCP Gateway — 产品北极星、研究战略与社区发布路线

## 先有用户，再扩张平台（CURRENT / OWNER DECISION）

**不变的长期北极星**：通用、自托管的远程 MCP Router，将多个本地 MCP Server 接入云端 AI 并统一管理。


---

## 1. 北极星：通用、自托管的远程 MCP Router

> **把原本只能本地使用的多个 MCP Server，变成可由不同云端 AI 持续调用、统一管理、独立部署的远程能力网络。**

其中，Desktop Commander 是第一个执行后端；Router 是核心平台能力；安全治理保证这个能力网络可以扩大使用范围。

**项目价值主张**：方便、安全、稳定、灵活。不能仅把竞争力定义为“比 Desktop Commander 更安全”或“能转发更多 MCP 工具”；这两项单独看容易复制。

继续保留已经确认的三层职责，不把 Gateway 做成第二个 Desktop Commander：

- **执行层（Desktop Commander / 后续其他 MCP Server）**：完成文件、编辑、搜索、Git、Shell 和各领域真实操作，Gateway 不重复实现成熟执行工具。
- **桥接与治理层（Mac MCP Gateway / Router）**：提供多客户端远程接入、上游 MCP tool discovery/Schema/结果透明转发、路由、项目范围、权限档位、审计、健康与恢复、扩展工具。
- **安全防护层（分层研究）**：与真实操作的风险一起演进，既不把全权限 Shell 错当项目沙箱，也不把不相干的高保证研究作为普通工具的强制前置。

**双入口、统一执行**：`DIRECT_URL`（客户端 HTTPS URL 直连、自有 Caddy/reverse proxy）与 `OPENAI_TUNNEL`（ChatGPT → OpenAI Secure MCP Tunnel）是两个可独立部署和启停的远程入口，但必须共享同一个 Gateway/Router、工具路由及治理语义。Caddy 目前停用并禁止自启；保留其证书、配置和代码供后续社区用户使用。私人 Tunnel 已连通真实 Desktop Commander。不能把“网络 HTTPS 可达”等同于“ChatGPT 插件能够注册/调用”。

## 2. 三条研究路线：不是竞争关系，关键是顺序

> 我的建议很明确：下一阶段继续以 Mac MCP Gateway + Desktop Commander 的真实开发能力为主线，同时开始验证 MCP Router 的通用性。安全研究不暂停，但改为由产品实际风险驱动。
>
> 这三条路线不是相互竞争的。它们更像是在解决三个不同层次的问题：
>
> **Desktop Commander 集成：证明 Gateway 真正有用。**
>
> **MCP Router：证明 Gateway 不只是 Desktop Commander 的附属品，而是一个具有独立价值的平台。**
>
> **安全防护研究：证明这个平台在扩大使用范围后仍然可信。**
>
> **关键是顺序。**

### 第一阶段 · 现在最重要：真正可用的远程开发工作台

> **把 Desktop Commander 变成真正能持续开发项目的远程工作台。**
>
> 完整执行真实研发任务，而不是继续做 Canary 测试。

验证可靠的连续开发能力：代码搜索/阅读、精确编辑、Git status/diff/add/commit/push、npm/Python/构建与测试、长进程输出、取消/超时/恢复、错误定位、工作树冲突和审查。执行功能继续使用 Desktop Commander；Gateway 负责远程路由和正确授权。

**本阶段具备最小可用产品与基础安全之后就可以面向社区发布早期版本**（README、安装/卸载、所支持环境、部署模式、限制、安全提示、Bug/Issue 反馈入口、可复现验收）。

### 第二阶段 · 验证独立平台价值：第二个真实 MCP Server

> **接入第二个真实 MCP Server，实现多上游路由。**
>
> 验证工具发现、Schema 透明转发、路由与会话管理。

核心问题：

> **用户是否只连接一个 Gateway，就能可靠使用多个 MCP Server，且不需要关心后面有几个执行引擎？**

真实第二上游（不能只以 Mock 代替）之后检验工具重名/命名空间、Schema 兼容与上游升级、断线故障隔离、重连与生命周期、权限差异、结果透明性、并发和观测性。沿用同一 Gateway 端口和双入口部署，不为每个新上游无限扩增监听端口。

### 第三阶段 · 面向更广泛社区与部署场景

> **双入口部署、权限档位、可靠性与安全治理。**
>
> 让不同用户根据部署环境和风险选择适当的运行模式。

重点研究跨设备/客户端身份、不同上游作用域、DIRECT_URL 自主部署体验、跨平台兼容、稳定性与更新治理。

**说明**：这里的第三阶段是更完整的社区级产品化，而**非“直到第三阶段才首次开源”**。第一阶段有可用版本即可考虑尽早公开，第二、三阶段以真实用户意见滚动发展。

**版本发布次序：**

1. **Release 1 · 先发布 Desktop Commander 自托管远程工作台。** 面向现有 Desktop Commander Remote MCP 用户，替代 **Desktop Commander 官方托管中转服务**的依赖；继续使用开源的本地 Desktop Commander 执行文件、搜索、终端及 Git 操作，不复制执行引擎。安装、授权项目、启动、连接 ChatGPT、验证首个真实调用应尽量由安装/配置向导完成，不要求用户手写 JSON 或搭建独立 Caddy。官方托管服务和本项目不是同一公司/官方产品。
2. **Release 2 · 通用 MCP Router 和 MCP Catalog / 商店。**
3. **安全研究贯穿两阶段，按实际风险投入。** 首发必须保障最低可接受的认证、权限、工作区边界、密钥与拒绝行为；与首发无直接风险关联的跨 UID / Witness / F5 高保证研究不是发布时间的前置条件。
