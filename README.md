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
- Keep application data local in SQLite; the current development branch also implements WebDAV two-way sync with default end-to-end encryption, conflict handling, and pause/resume controls.

## Planned, Not Yet Delivered

- An extensible AI service boundary based on OpenAPI-compatible services.
- A local web portal that works with the Windows application on the same computer.
- Android and broader cross-platform support.
- Attachments, comments, and richer project collaboration workflows.
- Remote WebDAV history browsing and rollback.

M4 WebDAV synchronization is not included in the published `v0.2.0` installer yet. The current development branch supports one WebDAV configuration and one current remote snapshot; a real WebDAV service and a Windows installer still need manual acceptance before release.

## Documentation

- [Architecture](docs/architecture.md): runtime boundaries, data ownership, and extension strategy. The primary project documents are maintained in Simplified Chinese.
- [Roadmap](docs/roadmap.md): delivery milestones, current phase, and exit criteria.
- [Known issues and release risks](docs/known-issues.md): confirmed issues, validation gaps, and expected repair milestones.
- [M4 WebDAV E2E verification](tests/e2e/sync-flow.md): the automated coverage boundary for sync settings, conflicts, and pause/resume.

## Screens And Naming

The user-facing product and bundle name is **TaskDock**. Internal compatibility names, including the Rust package and the local `todo-app.sqlite3` database filename, intentionally remain unchanged so existing local task data is not migrated solely for branding.

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

The browser server has no task/project data adapter, so task and project operations require the Tauri desktop shell. For daily development, double-click `start-dev.bat` in the repository root, or run:

```powershell
pnpm tauri dev
```

This command uses the production application identifier `io.github.lylyuanliang.taskdock`, so the source run reads the installed build's data directory for validation with real tasks. Close the installed TaskDock app and any other process using this identifier before starting, and never run both builds concurrently. Before the first source validation, back up `todo-app.sqlite3` together with `todo-app.sqlite3-wal` and `todo-app.sqlite3-shm` when present.

To create Windows installers, double-click `package-release.bat` in the repository root, or run:

```powershell
pnpm tauri build
```

The script does not close running development processes automatically; stop every `pnpm tauri dev` instance first. Installers are generated under `src-tauri/target/release/bundle/nsis/` and `src-tauri/target/release/bundle/msi/`, which are ignored by Git.

## Windows Release Build

The following process is for maintainers creating a manual Windows release, not for normal development. You can also double-click `package-release.bat` in the repository root to start packaging. Stop every `pnpm tauri dev` instance before starting. The Tauri build command runs the configured frontend production build automatically.

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

The Windows installers are generated under these Git-ignored directories:

```text
src-tauri/target/release/bundle/nsis/
src-tauri/target/release/bundle/msi/
```

Upload the NSIS setup executable as the primary release asset. The MSI installer is optional, primarily for managed Windows environments. Do not commit either generated installer.

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
- The current development branch uses WebDAV as its only synchronization protocol. WebDAV and encryption credentials are stored through Windows Credential Manager and are not written to source files, SQLite, remote snapshots, or commits.
- AI integration remains future work. Do not place any provider credentials in source files or commits.

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
