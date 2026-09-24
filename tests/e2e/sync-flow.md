# M4 WebDAV 同步 E2E 验证

## 覆盖范围

`sync_flow.py` 使用模拟 Tauri IPC 和本地浏览器页面验证同步设置主流程，不连接真实 WebDAV 服务，也不读取用户本机数据。当前覆盖：

- 从设置入口进入同步设置；
- 填写 WebDAV endpoint、目录、账户和加密口令；
- 不保存设置，直接使用当前表单草稿测试 WebDAV 连接并确认成功反馈；
- 模拟认证失败并确认显示账户/第三方应用密码错误，且密码不出现在页面文本中；
- 选择首次同步策略，触发首次同步并确认合并结果；
- 查看冲突、选择冲突决策并确认列表更新；
- 暂停和恢复同步；
- 断言密码不会出现在页面文本或无关 IPC 载荷中。

## 运行

在仓库根目录执行：

```powershell
python tests/e2e/sync_flow.py
```

预期输出：

```text
PASS M4-SYNC: settings, WebDAV configuration, initial sync, conflicts, and pause/resume.
```

该结果只能证明前端页面、IPC 载荷和模拟状态流转符合预期。发布 M4 前还必须使用测试 WebDAV 账户完成真实网络连接、首次上传/下载、认证失败、离线重试、暂停/恢复和冲突决策验收，并将结果记录在[已知问题与发布风险](../../docs/known-issues.md)中。
