# TaskDock

[English](README.md) | [简体中文](README.zh-CN.md)

TaskDock is a local-first desktop task manager for personal work, software delivery, and everyday planning. It is being built as a small Windows desktop application first, with a React workspace, a Rust/Tauri shell, and SQLite-backed local data.

> Project status: pre-release. The data model and user interface may change before a stable release.

## What Is Available

- Create, edit, complete, restore, search, and review tasks.
- Work from Inbox, Today, Upcoming, Completed, Project, and Calendar views.
- Create, rename, archive, and select projects.
- Inspect scheduled tasks by month and by selected day.
- Use English or Simplified Chinese, and switch between the included themes.
- Open a movable quick panel for lightweight desktop task access.
- Keep application data local in SQLite; the current release does not require an account or cloud service.

## Planned, Not Yet Delivered

- WebDAV synchronization, with compatibility guidance for providers such as Nutstore.
- An extensible AI service boundary based on OpenAPI-compatible services.
- A local web portal that works with the Windows application on the same computer.
- Android and broader cross-platform support.
- Attachments, comments, and richer project collaboration workflows.

## Screens And Naming

The repository is named **TaskDock**. The current pre-release UI and bundle configuration still use the legacy names `Todo` and `todo-app`; product branding will be unified in a separate change.

## Technology

| Layer              | Choice                                                |
| ------------------ | ----------------------------------------------------- |
| Desktop shell      | Tauri 2                                               |
| Frontend           | React 19, TypeScript, Vite                            |
| Native application | Rust 2021                                             |
| Local storage      | SQLite via `rusqlite` with the bundled SQLite library |
| Tests              | Vitest and React Testing Library; Rust unit tests     |
| UI assets          | Lucide React icons and CSS custom properties          |

## Prerequisites

TaskDock currently targets Windows development and packaging.

- Node.js supported by Vite 7: Node 20.19+ or 22.12+.
- pnpm, enabled through Corepack or installed separately.
- Rust stable with the `x86_64-pc-windows-msvc` toolchain.
- Visual Studio Build Tools with the Desktop development with C++ workload.
- Microsoft Edge WebView2 Runtime, included with supported Windows installations.

Check the local tools with:

```powershell
node --version
pnpm --version
rustc --version
cargo --version
```

## Get Started

```powershell
git clone https://github.com/lylyuanliang/taskdock.git
Set-Location taskdock
corepack enable
pnpm install
```

SSH is also supported when your GitHub key is configured:

```powershell
git clone git@github.com:lylyuanliang/taskdock.git
```

Run the Vite frontend for static layout and visual work:

```powershell
pnpm dev
```

The browser server has no task/project data adapter, so task and project operations require the Tauri desktop shell. Run the functional Windows application with:

```powershell
pnpm tauri dev
```

Create a production bundle:

```powershell
pnpm tauri build
```

The Tauri build outputs are generated under `src-tauri/target/` and are intentionally excluded from Git.

## Quality Checks

Run these checks before opening a pull request:

```powershell
pnpm test
pnpm lint
pnpm format:check
pnpm build
```

For Rust changes, also run:

```powershell
Set-Location src-tauri
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

## Architecture

```text
React workspace
  -> Tauri IPC commands
  -> Rust domain and application services
  -> SQLite repository and migrations
```

The frontend owns view state, localization, themes, and interaction feedback. Rust owns validation, task/project operations, database migrations, and persistence. IPC DTOs form the boundary between the two layers.

Calendar membership is driven only by a task's `scheduledAt` value. A due date is not treated as a scheduled calendar event.

## Data And Privacy

- TaskDock is local-first: the current application persists task and project data in SQLite under the operating system's application-data directory.
- Do not commit local databases, environment files, build artifacts, test reports, or handoff notes. Store local UI captures under `artifacts/screenshots/`; that dedicated directory is ignored. Do not ignore all `*.png` files because Tauri application icons are source assets.
- Synchronization and AI integrations are future work. Do not place provider credentials in source files or commits.

## Project Structure

```text
src/                    React application, views, features, themes, and i18n
src-tauri/src/          Rust domain, commands, persistence, and desktop shell
src-tauri/migrations/   Versioned SQLite schema migrations
src-tauri/capabilities/ Tauri capability configuration
public/                 Static frontend assets
```

## Contributing

TaskDock is released under the MIT License. The formal contribution process is still being prepared, so please discuss substantial work in an issue before opening a pull request.

When contributing:

1. Keep changes focused and preserve the existing TypeScript and Rust boundaries.
2. Add or update tests before changing behavior.
3. Run the quality checks listed above.
4. Do not commit secrets, local databases, generated bundles, `node_modules`, or `src-tauri/target`.
5. Use clear, scoped commit messages such as `feat(calendar): add selected-day ledger`.

## License

TaskDock is licensed under the [MIT License](LICENSE).

## Roadmap

The near-term focus is completing the desktop interaction model, forms, search and state polish, then preparing WebDAV synchronization and the extension boundaries required for a future AI service. Milestones and implementation handoffs are maintained locally and are not part of the public repository.
