# ADR 0013：PersonalOS 看板新增「接入」页

- 状态：已采纳
- 日期：2026-11-23
- 补充：[ADR 0011](0011-personalos-desk.md)（PersonalOS 看板）、[ADR 0012](0012-personalos-desk-claude-implements.md)（由 Claude Code 实现）

## 背景

PersonalOS 的内容越来越多来自外部：已经接了微信本机副本、生财有术 MCP、各处文档，以后还会接 Twitter 和第三方开源数据。现在有三个问题：

- 来源卡分散在各领域的「去哪查」里，没有一张总表；
- 定时任务分散在 launchd、Codex 自动化和 Claude 定时任务三处；
- 副本型来源（如微信）新不新，没有地方能看到。

2026-11-22 盘点时发现，微博超话签到的三个 LaunchAgent 从 2026-08-17 建好起每次运行都失败，三个多月没人发现。

方案和决策题见 [personalos-sources-plan.md](../personalos-sources-plan.md)。2026-11-23，Chris 同意了全部建议答案。

## 决定

1. **知识台新增「接入」页**，放在「资料」之后，页内分「来源 | 定时任务」两段。今天页在有异常时显示提醒行。任务数量以后多到一页放不下时，再拆成独立模块，只改显示名和路由。
2. **来源登记表放在 PersonalOS 的 `我/数据源.md`**，格式参照 `资料登记.md`，包含「来源」和「定时任务」两张表。表里只写来源卡里没有的结构化字段（方式、刷新任务、预期间隔、新鲜度探针、成功标记）；用法、授权和核对方式仍然只写在来源卡里。按 ADR 0011 决定 3，这个文件格式要写进 PersonalOS 蓝图 v0.4。
3. **定时任务的正本是执行方**（launchd plist、Codex `automation.toml`、Claude 定时任务目录），Desktop 每次读取时发现，不复制、不另存。页面显示登记过的全部任务，并把「未登记的自建任务」折叠列出，提示去登记。不显示厂商更新器。
4. **后台任务分两类。** 数据副本刷新（机械执行、不调用模型、不改 PersonalOS 文件）允许做；上下文自动改写（agent 定时改 `状态.md` 等）仍然不做。这一条写进 PersonalOS 蓝图 v0.4，用来修正 v0.3「不建后台任务」的说法。
5. **第一版只读。** 第二步（S2）再加 `bluemanta_sources_status` agent 工具，以及 launchd 任务的「立即运行」「暂停 / 恢复」。这些操作每次都要预览命令、经用户确认后执行（AGENTS.md 硬规则 7）。
6. **由 Claude Code 实现**，方式同 ADR 0012。排在迭代 4（[PR #37](https://github.com/bluemanta/bluemanta-desktop/pull/37)）合并之后。规格写在 [specs/personalos-sources.md](../specs/personalos-sources.md)，任务和验收记录写在 `docs/tasks/personalos-sources-*.md`。

## 不做

- Desktop 不当调度器，不在网页里新建或编辑任务。
- 不显示来源的内容，只显示元数据（路径是否存在、时间、退出码）。
- 不做通用连接器框架。每个新来源按规划第 7 节的接入清单单独接入。

## 后果

- 好处：
  - 失败和过期会自己显示出来；
  - 回答「最新」「今天」类问题前，agent 能查到副本截至什么时间；
  - 接入新来源有统一的清单可循。
- 代价：
  - 要解析三种执行方的格式，Codex 和 Claude 的格式不归我们管，可能会变；
  - 登记表和执行方之间可能对不上（任务改名、删除），页面要把「登记了但找不到」显示出来。
