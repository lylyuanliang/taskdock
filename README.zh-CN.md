# TaskDock

[English](README.md) | [简体中文](README.zh-CN.md)

TaskDock 是一款本地优先的桌面任务管理工具，面向个人工作、软件开发交付和日常计划。项目当前以轻量的 Windows 桌面应用为首要目标，采用 React 工作区、Rust/Tauri 桌面壳和 SQLite 本地数据存储。

> 项目状态：预发布阶段。正式稳定版发布前，数据模型和用户界面仍可能变化。

## 已实现能力

- 创建、编辑、完成、恢复、搜索和查看任务。
- 使用收件箱、今天、即将开始、已完成、项目和日历视图。
- 创建、重命名、归档和选择项目。
- 按月查看已排期任务，并查看选中日期的任务详情。
- 使用英文或简体中文，并切换内置主题。
- 打开可移动的快速面板，方便在桌面轻量访问任务。
- 使用 SQLite 在本地保存数据；当前版本不需要账户或云服务。

## 规划中，尚未交付

- WebDAV 同步，以及对坚果云等服务商的兼容说明。
- 基于 OpenAPI 兼容服务的可扩展 AI 服务边界。
- 仅供同一台 Windows 电脑使用、由桌面程序处理数据的本地 Web 门户。
- Android 和更广泛的跨平台支持。
- 附件、评论和更丰富的项目协作工作流。

## 项目文档

- [架构说明](docs/architecture.md)：运行边界、数据归属和扩展策略。
- [开发路线图](docs/roadmap.md)：交付里程碑、当前阶段和完成标准。
- [已知问题与发布风险](docs/known-issues.md)：确认问题、验收缺口和预计修复里程碑。

## 名称说明

面向用户的产品和安装包名称为 **TaskDock**。Rust 包名和本地 `todo-app.sqlite3` 数据库文件名等内部兼容名称会保留，避免仅因品牌调整迁移已有的本地任务数据。

## 技术栈

| 层级     | 选型                                         |
| -------- | -------------------------------------------- |
| 桌面壳   | Tauri 2                                      |
| 前端     | React 19、TypeScript、Vite                   |
| 原生应用 | Rust 2021                                    |
| 本地存储 | `rusqlite` 和内置 SQLite 库                  |
| 测试     | Vitest、React Testing Library、Rust 单元测试 |
| UI 资产  | Lucide React 图标和 CSS 自定义属性           |

## 开发前置条件

TaskDock 当前面向 Windows 开发和打包。

- Vite 7 支持的 Node.js：Node 20.19+ 或 22.12+。
- pnpm，可通过 Corepack 启用或单独安装。
- Rust stable，以及 `x86_64-pc-windows-msvc` 工具链。
- 安装了 Desktop development with C++ 工作负载的 Visual Studio Build Tools。
- Microsoft Edge WebView2 Runtime，受支持的 Windows 系统通常已内置。

可使用下列命令检查本地工具：

```powershell
node --version
pnpm --version
rustc --version
cargo --version
```

## 快速开始

```powershell
git clone https://github.com/lylyuanliang/taskdock.git
Set-Location taskdock
corepack enable
pnpm install
```

如果已配置 GitHub SSH 密钥，也可以使用：

```powershell
git clone git@github.com:lylyuanliang/taskdock.git
```

启动 Vite 前端，用于静态布局和视觉开发：

```powershell
pnpm dev
```

浏览器服务没有任务或项目数据适配器，因此任务和项目操作需要在 Tauri 桌面壳中运行。日常开发建议双击项目根目录的 `start-dev.bat`，或在终端执行：

```powershell
pnpm tauri dev
```

该命令使用正式应用标识 `io.github.lylyuanliang.taskdock`，源码运行会读取正式版的数据目录，适合在真实任务数据上验证。启动前必须关闭已安装的 TaskDock 和其他同标识进程，禁止与正式版并行运行。首次进行源码验证前，请备份应用数据目录中的 `todo-app.sqlite3`、`todo-app.sqlite3-wal` 和 `todo-app.sqlite3-shm`（如果存在）。

需要生成 Windows 安装包时，可以双击项目根目录的 `package-release.bat`，或在终端执行：

```powershell
pnpm tauri build
```

脚本不会自动关闭正在运行的开发进程；开始前请先关闭所有 `pnpm tauri dev` 实例。安装包会生成在 `src-tauri/target/release/bundle/nsis/` 和 `src-tauri/target/release/bundle/msi/`，这些目录已被 Git 忽略。

## Windows 发布构建

以下流程面向维护者手动构建 Windows 发布包，不用于日常开发。也可以直接双击项目根目录的 `package-release.bat` 执行打包。开始前请关闭所有 `pnpm tauri dev` 实例。Tauri 构建命令会自动执行已配置的前端生产构建。

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm format:check

Push-Location src-tauri
cargo fmt --check
cargo clippy -- -D warnings
cargo test
Pop-Location

pnpm tauri build
```

Windows 安装包会生成在以下已被 Git 忽略的目录中：

```text
src-tauri/target/release/bundle/nsis/
src-tauri/target/release/bundle/msi/
```

应将 NSIS 安装程序作为主要发布文件上传；MSI 安装包可选，主要用于受统一管理的 Windows 环境。不要提交这两类生成的安装包。

## 质量检查

创建 Pull Request 前，请运行：

```powershell
pnpm test
pnpm lint
pnpm format:check
pnpm build
```

如改动了 Rust 代码，还应运行：

```powershell
Set-Location src-tauri
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

## 架构

```text
React 工作区
  -> Tauri IPC 命令
  -> Rust 领域与应用服务
  -> SQLite 仓储与迁移
```

前端负责视图状态、本地化、主题和交互反馈。Rust 负责校验、任务和项目操作、数据库迁移与持久化。IPC DTO 是两层之间的边界。

日历归属只由任务的 `scheduledAt` 决定；截止时间不会被当作日历排期。

## 数据与隐私

- TaskDock 为本地优先应用：当前版本将任务和项目数据保存到操作系统应用数据目录中的 SQLite。
- 不要提交本地数据库、环境文件、构建产物、测试报告或交接记录。本地 UI 截图请存放在 `artifacts/screenshots/`，该目录已被忽略。不要忽略所有 `*.png` 文件，因为 Tauri 应用图标属于源码资产。
- 同步和 AI 集成均属于后续工作。不要将服务商凭据写入源码或提交记录。

## 项目结构

```text
src/                    React 应用、视图、功能模块、主题和国际化
src-tauri/src/          Rust 领域层、命令层、持久化和桌面壳
src-tauri/migrations/   版本化 SQLite 模式迁移
src-tauri/capabilities/ Tauri 能力配置
public/                 前端静态资源
```

## 参与贡献

TaskDock 使用 MIT 协议发布。正式贡献流程仍在准备中，提交较大改动前请先通过 Issue 讨论。

贡献时请遵循：

1. 保持改动聚焦，并维护现有 TypeScript 与 Rust 的边界。
2. 修改行为前先新增或更新测试。
3. 运行上述质量检查。
4. 不要提交密钥、本地数据库、生成的安装包、`node_modules` 或 `src-tauri/target`。
5. 使用清晰且范围明确的提交说明，例如 `feat(calendar): add selected-day ledger`。

## 许可证

TaskDock 使用 [MIT 协议](LICENSE)。
