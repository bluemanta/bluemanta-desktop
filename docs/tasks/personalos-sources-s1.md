# PersonalOS 看板 · 接入页 S1 说明书（只读接入页）

- 实现与自查：Claude Code（[ADR 0013](../decisions/0013-personalos-sources-page.md) 决定 6，做法同 [ADR 0012](../decisions/0012-personalos-desk-claude-implements.md)）
- 规则：[specs/personalos-sources.md](../specs/personalos-sources.md)
- 前置：迭代 4（[PR #37](https://github.com/bluemanta/bluemanta-desktop/pull/37)）已合并到 `main`
- 分支：从合并后的 `main` 新开 `claude/personalos-sources-s1`，在本机 worktree `~/Developer/bm-pos` 开发；开 PR 按 AGENTS.md 的 2026-10-24 授权执行，合并由 Chris 决定

## 任务

| 编号 | 内容 | 允许修改的路径 |
|---|---|---|
| S0 | PersonalOS 侧的准备（**每一步都先给 Chris 看改动再写**）：在蓝图 v0.4 中写进 ADR 0013 决定 2 和决定 4（登记表格式、两类后台任务）；新建 `我/数据源.md`，登记微信来源和本机现有的自建任务；在 `README.md` 根导航加链接；按 PersonalOS 协议写日志并提交。开工前先看 PersonalOS 的 `git status`，别人未存档的改动不碰。 | `~/Documents/PersonalOS/` 下的上述文件 |
| S1a | 数据层：登记表解析、新鲜度、launchd / Codex / Claude 三种任务发现、`launchctl list` 解析、自建判断、参数脱敏；fixture 和单测 | `packages/knowledge/src/personalos/sources/**`、`packages/knowledge/test/**` |
| S1b | 接口：`GET /api/v1/personalos/sources` 和日志接口；接口测试 | `packages/server/src/**`、`packages/server/test/**` |
| S1c | 网页：「接入」页两段、详情卡片、今天页提醒行；走查和截图 | `packages/web/src/**`、`packages/web/e2e/**` |
| S1d | 真实环境只读试跑（需 Chris 同意），写验收记录 | 本文件 |

每个任务一笔提交。

## 验收项

| 项 | 结果 | 命令与结果 |
|---|---|---|
| 构建、类型、单测 | verified | 用 `env -u BLUEMANTA_TODAY -u BLUEMANTA_KNOWLEDGE_HOME npm run build && npm run check && npm test` 模拟 CI，全部退出 0，单测合计 493 项。新增：数据层 27 项，在 UTC、纽约、上海三个时区都通过；接口 4 项。 |
| 走查 | verified | `BLUEMANTA_PW_CHANNEL=chrome npm run walkthrough`，194 项全部通过，含接入页新用例 8 条。第二次运行 193 项通过、1 项失败，是迭代 3 已记录的 `personalos-refresh.spec.ts`「新提交在十秒内出现」高负载偶发超时。第一次全量运行另有 4 项 Git 视图用例和 1 项接入页用例在并发下失败，单独运行都通过。接入页那一项是测试时序问题（关闭详情后下一帧才重新聚焦），已改用例。 |
| 截图 | verified | `packages/web/screenshots/personalos-sources-{cards,task,today}-{1440,720}-{light,dark}.png`，不提交。抽看了来源卡片 1440 浅色、任务详情 1440 深色、今天页 720 浅色：卡片、圆点、详情、提醒行都清楚；720 宽没有横向溢出。抽看时发现详情卡里「配置」二字被挤成两行，已修。 |
| 只读 | verified | 单测「只读」一项：运行汇总和读日志前后，fixture 副本的文件哈希和修改时间都不变。服务端只有 `runLaunchctlList` 一处子进程调用；测试和走查都改读 `BLUEMANTA_LAUNCHCTL_LIST_FILE`，不执行真实命令。 |
| 隐私 | verified | 单测和接口测试都断言 Codex 的 `prompt` 不出现在返回值里；日志接口对未登记为可显示的任务返回 403；参数里像密钥的长串显示为 `•••`；fixture 全是虚构标识。 |
| 真实环境试跑 | verified | 2026-11-24 经 Chris 同意，只读，见下一节 |
| 交付检查 | 见 PR 评论 | `npm run check:pr`，每次推送后运行 |

## S0 记录（2026-11-24）

Chris 先看过草稿，同意后才写入。仓库是公开的，下面只写做了什么，不写具体的任务标识和路径。

| 项 | 结果 | 核对结果 |
|---|---|---|
| `我/数据源.md` | verified | 新建。来源表登记 2 个来源：1 个副本型，成功标记含两个状态词；1 个查询型。定时任务表登记本机的 launchd 定时任务、Codex 自动化（含已暂停的）、Claude 定时任务（标为忽略）和 4 个常驻服务。有一个来历不明的 LaunchAgent 故意没登记，留给页面的「未登记」组去发现。 |
| 根导航 | verified | `README.md`「使用入口」加了一行，链接到数据源。 |
| 蓝图 | verified | v0.4 输入稿第 6 节加了「2026-11-23 补充决定：后台任务与数据源登记」，第 7 节相应一行改写。输入稿里本来就有别人未存档的改动，所以没有单独提交，留给晨间存档。 |
| 提交 | verified | PersonalOS 本地提交一笔，只包含 3 个文件：数据源、README、当月日志。提交说明为 `[我] 新建数据源登记表，根导航加入口`。收件箱和输入稿仍在工作区，没有被带进提交。 |

## 实现记录（S1a–S1c，2026-11-24）

- 提交：S1a `3c629b9`、S1b `822225b`、S1c `590f6f1`；草稿 PR #40。
- 偏离说明书的地方：
  - fixture 放在 `packages/knowledge/fixtures/sources/`，与现有 fixture 同级，已写回规格；
  - 为复用表格解析，导出了 `packages/knowledge/src/personalos/parse.ts` 的 `tables`；
  - 在 `packages/knowledge/src/types.ts` 新增错误码 `forbidden`，接口映射为 403。
- 规格补充（已写回）：
  - 无法读取的 plist 放进「未登记」；
  - 脱敏要求长串同时含字母和数字；
  - 任务段路由为 `/knowledge/sources/tasks/<编码后的标识>`；
  - 今天页提醒在只有任务失败时直接进入任务段。
- 已知问题：
  - 登记表里写错执行方的标识（如缺少 `launchd:`）在列表里显示为 launchd，状态为「找不到」；
  - Codex 和 Claude 任务的上次结果一律显示「运行记录未接入」。

## 真实环境只读试跑（S1d，2026-11-24）

做法：用临时数据目录在 4391 端口起服务，不设任何测试用的环境变量，读本机真实的 home。用接口读数据，用 Playwright 截图（截图放在 /tmp，不入库）。试跑前后各给 PersonalOS 和三个任务目录拍一次快照，对比是否有改动。仓库是公开的，下面不写具体的任务标识和路径。

| 项 | 结果 | 核对结果 |
|---|---|---|
| 副本来源为绿 | verified | 唯一的副本型来源显示「正常」，最后同步时间与它运行日志的最后一行一致。这个来源的运行日志每一行都是告警状态词，登记表把它列为成功标记，所以判为成功。 |
| 签到任务 | verified | 主签到显示「失败（退出码 1）」，排在第一行；今天页提醒行显示「1 个任务失败」。原因是登录凭据失效，正在另一个会话里处理。 |
| Codex 时间 | verified | 4 个启用任务的中文时间都和配置一致。其中隔周任务的配置里没有起点，下次运行时间按规格留空。2 个早期任务显示「已结束」：一个过了 UNTIL，一个是已执行过的一次性任务。 |
| 未登记组 | verified | 只有 2 项：一个来历不明的自建守护进程；一个厂商 plist，因为文件权限不可读，显示「无法读取」，按规格放进未登记组。没有出现厂商更新器。登记为「忽略」的 Claude 任务没有出现。 |
| 常驻服务 | verified | 5 项都显示「运行中」。其中副本刷新任务已在 2026-11-23 改为常驻进程，由脚本每小时自己刷新一次，所以出现在「常驻服务」组；它和来源的关联、新鲜度照常显示。 |
| 只读 | verified | 快照包含 PersonalOS 的 HEAD、工作区状态、全部文件哈希，以及三个任务目录里配置文件的修改时间和大小，试跑前后完全一致。没有残留临时文件。正式服务（4310）不受影响。 |

试跑发现的已知问题（不阻塞）：

- launchd 对重新加载后还没运行过的任务也报退出码 0，页面因此显示「上次正常」。两个晚间签到任务就是这样，它们今天还没到点。以后可以结合「最近输出时间」改成「还没运行过」。
