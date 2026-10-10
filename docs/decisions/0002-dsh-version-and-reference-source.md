# ADR 0002：dsh 版本锁定与参考源码位置

- 状态：已采纳
- 日期：2026-10-10

## 背景

2026-10-10 盘点时，三处 dsh 版本不一致：

| 位置 | 版本 |
|---|---|
| `/Applications/DeepSeek Harness.app` | 0.2.0-rc.2 |
| 全局 CLI（`dsh --version`） | 0.1.1-rc.2 |
| fork `~/Documents/CodeProjects/bluemanta-harness` | 0.1.7-rc.1 |

npm 上 `latest` 和 `next` 都指向 0.2.0-rc.2；`alpha` 是 0.2.1-alpha.2。

fork 位于 iCloud 同步的 `~/Documents` 下，没有本地改动，也没有未推送的提交，提交作者全部来自上游，是一份纯镜像。当时 iCloud 正卡在另一个项目的 `node_modules` 上。

## 决定

1. **版本锁定 0.2.0-rc.2**，和已安装的 Desktop App 保持一致，不追 alpha。全局 CLI 已升级到 0.2.0-rc.2。
2. **参考源码放在 `~/Developer/bluemanta-harness`**，和 `bluemanta-desktop` 并列，不放进它里面：
   - 嵌套的 git 仓库会让 Desktop 仓库的提交和审查变复杂；
   - 它有 1.3 万个文件，Desktop 仓库只应包含自己的代码；
   - 插件依赖的是 npm 上发布的包，不依赖 fork 的源码构建。
3. 参考仓库的 remote：`origin` 是 `bluemanta/bluemanta-harness`，`upstream` 是 `deepseek-ai/deepseek-harness`。本地分支 `ref/dsh-0.2.0-rc.2` 指向上游提交 `c1b47e41fc`（`release(dsh): 0.2.0-rc.2`）。阅读 API 和文档时以这个分支为准。
4. **不修改 fork 的源码。** 需要定制时，写成外部插件、profile patch 或 skill。

## 升级规则

升级 dsh 是一个单独的任务：先在 `ref/` 新分支对照变更日志，再在隔离的 `DSH_HOME` 中跑通全部插件验收，最后才升级 Desktop App，并同步修改本 ADR 引用的版本号（新增一条 ADR 记录升级）。

## 待办

- ~~旧目录 `~/Documents/CodeProjects/bluemanta-harness`（约 368 MB）由用户确认后删除。~~ 2026-10-10 已由用户移入废纸篓（`~/.Trash/bluemanta-harness-old`）。
- GitHub 上 fork 的 `master` 还停在 0.1.7-rc.1；是否同步到上游由用户决定。本地参考不依赖它。
