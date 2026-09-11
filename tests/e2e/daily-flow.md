# TaskDock 每日流程端到端验收

本文件的自动化入口是 [daily_flow.py](daily_flow.py)。它是浏览器内受控 mock 验收：证明主窗口 DOM 和 Tauri IPC 参数契约，不执行 Rust command、不连接 SQLite，也不证明真实 Tauri WebView、安装包行为或 Windows 原生通知。

## 自动浏览器验收

### 前置条件

1. 安装仓库的 Node 依赖，并能在项目根目录执行 `pnpm`。
2. 当前 Python 环境已安装 Playwright；本仓库不自动安装 Python 包或下载浏览器。
3. 默认浏览器是 `D:\soft\playwright-chrome-win64\chrome-win64\chrome.exe`。另一位置可设置 `TASKDOCK_PLAYWRIGHT_CHROME` 为可执行文件的绝对路径。

运行：

```powershell
pnpm test:e2e
```

脚本以随机可用端口启动 `pnpm vite --host 127.0.0.1 --port <port> --strictPort`，只允许 loopback 访问。端口竞争会使本次运行明确失败，不会回退到其他端口、连接已有 listener 或把它误判为本 runner 残留。只有本次 Vite 子进程输出所选的精确 loopback URL 后，脚本才连接该 URL 并启动浏览器。

`finally` 会等待并验证清理：Windows 仅对本次 `pnpm` PID 使用 `taskkill /T`；POSIX 在启动后立即保存该独立 session 的 PGID，即使 `pnpm` 根进程已退出仍先对保存的组发 TERM、轮询整个组消失，超时才对同一组发 KILL 并再次确认组已消失，最后 reap 根进程。仅当本 runner 已从 child 输出确认拥有该端口时，两种平台才在等待后确认本次分配端口已关闭；strict-port 竞争会刻意跳过该连接探测。不保存报告、截图或服务日志。命令成功仅表示当次脚本检查通过，后续变更应重新执行此命令。

### 覆盖契约

`daily_flow.py` 在导航前通过 `page.add_init_script` 注入 session 内 `window.__TAURI_INTERNALS__`、event callback 注册和 IPC task store。React Strict Mode 可重复只读请求，脚本不依赖其次数；mock 会拒绝同一目标的重复 mutation，并在 desktop flow 的 React settle 后精确比对完整 mutation 序列：create=1、父任务 update=1、complete=1、子任务 update=1。

| 编号 | 浏览器操作                      | DOM 断言                                        | IPC 断言                                                              |
| ---- | ------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| A1   | 打开收件箱                      | 收件箱标题和初始任务可见                        | `list_inbox({})`                                                      |
| A2   | 切换今天、已完成、月历          | 每个视图标题可见                                | 对应完整 `list_tasks({ view })`；月历带 `YYYY-MM`                     |
| A3   | 新建、编辑、完成任务            | 新标题出现，完成后从收件箱消失                  | 精确 payload；完整序列中 create=1、父任务 update=1、complete=1        |
| A4   | 搜索初始任务                    | 搜索结果区显示匹配任务                          | `list_tasks({ view: { kind: "search", query: "initial" } })`          |
| A5   | 桌面与移动视口                  | `1440x900`、`360x800` 无 document/body 水平溢出 | console error 与 page error 均为空                                    |
| A6   | 编辑器收到外部 `task://mutated` | 无草稿 editor 显示新标题、标签和子任务 DTO      | 事件通过 Tauri event internals 注册；`get_task_editor` 再次请求       |
| A7   | 编辑子任务                      | 项目字段禁用并显示继承提示                      | 序列中唯一子任务 `update_task_editor` 的 `patch` 完全省略 `projectId` |

### 自动化边界

- 不启动真实 Tauri WebView，不连接 SQLite，也不验证断网写入或进程重启持久化。
- mock 中的 `create_task_editor`、`update_task_editor`、`complete_task` 仅是当前 UI 的 IPC 契约；不能替代 Rust command、数据库或安装版编辑保存验收。
- 受控事件证明主窗口的订阅与无草稿 editor 重载路径，不证明真实多窗口 Tauri dispatch、SQLite 读取或安装版窗口调度。
- 不覆盖快速面板真实窗口行为、Windows notification、AppUserModelID、通知中心、专注助手或系统通知关闭状态。
- 不从 UI 真实验证子任务创建、重复规则和提醒排期；安装版没有对应入口时，应记录为产品缺口，不得以数据库操作替代用户流程。

## Windows 安装版人工清单

### 前置条件

1. 使用本轮 `pnpm tauri build --debug` 生成的 debug MSI 或 NSIS 安装包；MSI 与 NSIS 的通知归属分别验收。
2. 准备可识别的任务标题，例如 `M2 人工通知 20260909-01`，并记录安装方式、Windows 版本和测试时间。
3. 需要验证“离线”的步骤先断开网络，再启动应用；验收期间不要清理应用数据。
4. 若应用当前没有子任务、重复或排期入口，实际结果填写“未通过：缺少入口”，不要直接操作数据库代替用户流程。

| 编号 | 操作                                                                     | 预期                                                                                                                | 人工实际结果                                     |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| M1   | 断开网络，启动已安装应用，新建一项任务；关闭并重新打开对应视图           | 无网络时创建成功，任务立即出现在列表，业务操作不依赖外部服务                                                        | `待人工`                                         |
| M2   | 编辑 M1 的标题和备注，保存后切换视图再返回                               | 编辑成功；新标题和备注保持，不出现重复任务                                                                          | `待人工`                                         |
| M3   | 通过产品入口创建父任务和至少一个子任务，分别完成子任务和父任务           | 父子关系与完成计数正确，完成操作不会丢失或重复子任务                                                                | `待人工`；若无子任务入口，记录“未通过：缺少入口” |
| M4   | 创建每日重复任务并完成当前实例，再尝试对同一实例重复完成                 | 首次完成仅生成一个下一实例；第二次完成被拒绝，不再生成额外实例                                                      | `待人工`；若无重复入口，记录“未通过：缺少入口”   |
| M5   | 创建/编辑一项安排在今天的任务，查看“今天”和当月“月历”                    | 今天视图和对应月历日期均显示任务；完成状态与主列表一致                                                              | `待人工`；浏览器 mock 仅证明导航和查询契约       |
| M6   | 展开快速面板，在面板中完成一项今天任务，再查看主窗口                     | 快速面板调用完成操作；任务从面板刷新，主窗口显示相同完成状态                                                        | `待人工`                                         |
| M7   | 创建一项即将到点的提醒任务，保持应用运行并等待到点                       | 只出现一次 toast；超过一个 30 秒轮询周期后不重复通知                                                                | `待人工`                                         |
| M8   | M7 通知成功后退出并重启应用，等待至少两个 30 秒轮询周期                  | M1/M2 等任务数据仍保持；已通知任务不再重复 toast                                                                    | `待人工`                                         |
| M9   | 安装 debug MSI，触发唯一标题的提醒，并打开 Windows 通知中心              | toast/通知中心归属为已安装的 TaskDock；标题为 `TaskDock`，正文为任务标题；通知中心可定位同一条通知                  | `待人工`                                         |
| M10  | 卸载 MSI 后安装 debug NSIS，使用另一唯一标题重复 M9                      | NSIS 安装版的归属、标题、正文和通知中心记录同样正确，不归属到终端或浏览器                                           | `待人工`                                         |
| M11  | 关闭该应用的系统通知，或开启 Windows 专注助手；分别执行创建、编辑和完成  | toast 可以被系统抑制，但 `create_task_editor`、`update_task_editor`、`complete_task` 对应操作仍成功，页面无业务错误 | `待人工`                                         |
| M12  | 创建一项稍后到点任务，完全退出应用，等待超过到点时间和至少一个 30 秒周期 | 退出后不再弹出 toast，任务仍保持未完成；再次启动后仅按当前持久化状态处理                                            | `待人工`                                         |

## 全量质量门禁

本节只记录同一工作树上的 fresh 运行结果。

| 门禁                                                               | 实际结果                                                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `pnpm test -- --maxWorkers=1 --no-file-parallelism --reporter=dot` | 退出码 0；18 个测试文件、178 个测试通过                                                                         |
| `pnpm test:e2e`                                                    | 退出码 0；`PASS A1-A7`，并确认受控 Vite 子进程和其已确认拥有的端口均已清理                                      |
| `pnpm lint`                                                        | 退出码 0；ESLint 无 warning                                                                                     |
| `pnpm format:check`                                                | 首次发现本文档格式不匹配；使用仓库 Prettier 格式化后 fresh 重跑退出码 0，所有匹配文件通过                       |
| `pnpm build`                                                       | 退出码 0；TypeScript 构建和 Vite 构建通过，转换 1844 个模块                                                     |
| `cargo fmt --check`                                                | 退出码 0                                                                                                        |
| `cargo test --jobs 1`                                              | 退出码 0；lib 171/171、main 0/0、doc tests 0/0；仅有 MSVC 创建 import library 的 linker message                 |
| `cargo clippy --jobs 1 -- -D warnings`                             | 退出码 0                                                                                                        |
| `pnpm tauri build --debug`                                         | 最终退出码 0；生成 `src-tauri/target/debug/todo-app.exe`，并在 MSI 与 NSIS 目录生成显示名称为 TaskDock 的安装包 |
| `git diff --check`                                                 | 退出码 0                                                                                                        |

## 阶段判定

自动浏览器验收已覆盖主窗口交互与 Tauri IPC 契约。M2 只有在全量质量门禁通过，并完成上述 Windows 安装版人工项目或明确接受其缺口后，才可判定阶段完全收口。
