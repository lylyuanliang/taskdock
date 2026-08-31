# 项目规则

## 数据库命名

- 所有新增业务数据表使用 `todo_` 前缀。
- `schema_migrations` 是迁移元数据表，不属于业务表。
- 任何新业务表均需在迁移和测试中使用同一前缀。

## 代码质量

- TypeScript 保持严格类型检查；禁止使用 `any`，跨 IPC、存储和用户输入边界必须定义明确 DTO 或类型守卫。
- React 组件、状态和副作用按职责拆分；优先使用 React、Tauri 与项目已有的稳定模式，不引入技巧性抽象、隐式全局状态或未经需求支持的通用框架。
- Rust 使用显式错误传播和小而职责单一的模块；不使用 `unwrap` 或 `expect` 处理生产路径中可恢复的失败。
- 新增或修改 TypeScript、React、CSS、SQL 和配置后，必须通过 `pnpm lint`、`pnpm format:check`、类型构建及覆盖该变更的测试；Rust 至少执行 `cargo fmt --check` 与 `cargo clippy -- -D warnings`。
- 命名应表达业务意图，避免缩写和难以维护的技巧性写法；仅为非显而易见的决策添加简洁中文注释。
