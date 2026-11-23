# PersonalOS 看板 · 「接入」页规格（S1：只读）

- v1：2026-11-23。决定见 [ADR 0013](../decisions/0013-personalos-sources-page.md)，方案见 [personalos-sources-plan.md](../personalos-sources-plan.md)。
- 外壳、导航、详情卡片、阅读器、视觉沿用 [PersonalOS 看板规格](personalos-ui.md)，本文只写「接入」页特有的部分。冲突时：设计规范 > 本文 > PersonalOS 看板规格。
- 网页只经 `/api/v1/personalos/sources*` 访问数据。
- S1 全部只读：服务端不写任何文件，只执行第 3.2 节列出的那一条只读命令。

## 1. 登记表 `我/数据源.md`

### 1.1 来源表

表头含「来源」「方式」「位置」「刷新任务」「预期间隔」「新鲜度探针」「成功标记」「来源卡」的表格。列的顺序不固定，缺少的列按空值处理，多出的列忽略。

| 列 | 解析 |
|---|---|
| 来源 | 名称，必填。为空的行跳过 |
| 方式 | `查询`、`副本`、`登记`、`推入`；其他值原样显示，按「登记」处理新鲜度 |
| 位置 | 同 personalos-ui 1.6：本机路径（反引号里以 `~/` 或 `/` 开头，只 `stat`）、链接、其他 |
| 刷新任务 | 一个或多个任务引用，用 `、` 或 `,` 分隔，每个都是反引号包着的 `执行方:标识`，执行方为 `launchd`、`codex`、`claude`。`—` 或空表示没有 |
| 预期间隔 | `N 分钟`、`N 小时`、`N 天`、`N 周`（N 为正整数，空格可省）；认不出时为空 |
| 新鲜度探针 | 反引号里的本机路径，见第 2 节 |
| 成功标记 | 运行日志中算作成功的状态词，用 `、` 分隔；为空时默认 `成功` |
| 来源卡 | Markdown 链接，相对路径按 `我/` 解析，带 `#锚点`；点击在阅读器里打开并滚动到对应标题 |

### 1.2 定时任务表

表头含「任务」「标识」「用途」「日志」「日志可显示」的表格。

- 标识：同上，`执行方:标识`。
- 日志：反引号里的本机路径，可为空。
- 日志可显示：`是` 时详情里显示日志尾部，其他值一律视为否。
- 用途为 `忽略` 的行：任务不显示，也不算「未登记」。

### 1.3 容错

- 文件不存在：两段都显示空状态「还没有 `我/数据源.md`」，并附接入清单的链接；发现的任务全部归入「未登记」。
- 同一个标识在两张表里都出现：以定时任务表的名称为准，来源表照常关联。
- 登记了但在执行方那里找不到的任务：显示为「找不到」（灰色），不报错。

## 2. 新鲜度

只对方式为「副本」且填了探针的来源计算。

1. 探针路径不存在：状态为「探针不存在」，显示红点。
2. 探针是文件，且最后 200 行里有符合 `^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?)\s+(\S.*)$` 的行：按**运行日志**处理。
   - 最后运行：最后一条匹配行的时间和状态文字。
   - 最后成功：状态文字以任一成功标记开头的最后一行的时间。
   - 时间不带时区，按本机时区解释。
3. 其他情况（普通文件或目录）：最后成功时间取修改时间；目录取它本身和直接子项中最晚的修改时间。不递归。
4. 设预期间隔为 I，距最后成功的时长为 d：`d ≤ 1.5I` 为正常（绿），`d ≤ 3I` 为偏旧（黄），超过 3I 为过期（红）。没有找到成功记录也算过期。没填预期间隔时只显示时间，不着色。
5. 服务端只读探针文件的最后 64 KB，不读其他任何来源内容。

## 3. 任务发现

返回的任务统一成以下结构：`{ ref, runner, label, name, schedule, nextRun, lastResult, lastExit, lastOutputAt, running, kind, selfBuilt, registered, sourceNames, configPath, logPath, logVisible }`。其中 `ref` 形如 `launchd:标识`，`kind` 取 `定时`、`常驻`、`其他`。

### 3.1 launchd

- 扫描 `~/Library/LaunchAgents/*.plist`（只看用户域，不看 `/Library`）。目录可由 `BLUEMANTA_LAUNCHAGENTS_DIR` 覆盖，供测试使用。
- 自己解析 XML plist，只需支持 `dict`、`array`、`string`、`integer`、`real`、`true`、`false`、`date`。二进制 plist 或读取失败（如权限不足）时，任务名用文件名，标「无法读取」。
- 时间翻成中文：
  - `StartCalendarInterval`（dict，或 dict 数组）中，Minute / Hour / Day / Weekday / Month 组合为「每小时第 5 分」「每天 9:00」「每周一 9:00」「每月 1 日 9:00」，数组用「；」连接。Weekday 中 0 和 7 都是周日。
  - `StartInterval` 显示为「每 N 分钟」「每 N 小时」。
  - 没有时间、但有 `KeepAlive` 或 `RunAtLoad` 的，`kind` 为常驻，显示「常驻」或「开机启动」。
  - `WatchPaths` 显示「文件变化时」。
- 下次运行：只对 `StartCalendarInterval` 计算（本机时区）；`StartInterval` 不计算。
- **自建判断**：满足任一条件即为自建，否则视为厂商程序，不进「未登记」：
  - `ProgramArguments[0]`（或 `Program`）的文件名是常见解释器：`python`、`python3`、`node`、`bun`、`deno`、`ruby`、`sh`、`bash`、`zsh`、`uv`（含版本后缀和带路径的写法）；
  - 程序路径在 `~/Developer/`、`~/Documents/`、`~/bin/`，或 home 下以 `.` 开头的目录里。
  
  **不能按标识前缀判断**：本机的微博签到任务就用了 `com.apple.` 前缀。

### 3.2 launchd 运行状态

- 唯一允许执行的命令是 `launchctl list`：不带参数，用 `execFile` 调用，超时 3 秒，读取每行的 PID、Status、Label。
- 测试和非 macOS 环境用 `BLUEMANTA_LAUNCHCTL_LIST_FILE` 指向一个文本文件代替。两者都拿不到时，所有任务的状态为「未知」。
- 状态判断：
  - 在列表里、有 PID：运行中。
  - 在列表里、没有 PID：Status 为 0 时显示「上次正常」，非 0 时显示「失败（退出码 N）」，负数显示「被信号 N 终止」。
  - plist 存在但不在列表里：未加载。
- 最近输出时间：`StandardOutPath`、`StandardErrorPath` 和登记的日志中最晚的修改时间。

### 3.3 Codex 自动化

- 扫描 `~/.codex/automations/*/automation.toml`。目录可由 `BLUEMANTA_CODEX_AUTOMATIONS_DIR` 覆盖。
- 只读顶层的 `id`、`name`、`kind`、`status`、`rrule`、`execution_environment`，按单行 `key = "..."` 解析。**其他键一律不读、不返回**（提示词等内容可能涉及私人信息）。
- `status` 为 `ACTIVE` 时显示「启用」，`PAUSED` 时显示「已暂停」。
- rrule 支持以下子集：`FREQ`（HOURLY / DAILY / WEEKLY / MONTHLY）、`INTERVAL`、`BYDAY`、`BYMONTHDAY`、`BYHOUR`、`BYMINUTE`、`UNTIL`、`COUNT`，前面的 `RRULE:` 可有可无，另支持 `DTSTART;TZID=…:` 行。翻成中文并计算下次运行时间。超出这个子集时原样显示，不计算。已过 `UNTIL` 的显示「已结束」。
- 上次结果在 S1 显示「运行记录未接入」。
- 全部算自建。

### 3.4 Claude 定时任务

- 扫描 `~/.claude/scheduled-tasks/*/SKILL.md`。目录可由 `BLUEMANTA_CLAUDE_TASKS_DIR` 覆盖。
- 只读 frontmatter 里的 `name` 和 `description`，不读正文。
- 时间显示「由 Claude 应用管理」，上次结果显示「运行记录未接入」。全部算自建。

## 4. 接口

| 接口 | 返回 |
|---|---|
| `GET /api/v1/personalos/sources` | `{ sources: [...], tasks: [...], unregistered: [...], services: [...], summary: { failedTasks, staleSources, unregistered }, generatedAt }` |
| `GET /api/v1/personalos/sources/tasks/:ref/log` | 日志最后 20 行（只读最后 64 KB）；只对登记为「日志可显示」的任务开放，否则返回 403 |

- 路径一律由服务端从登记表和执行方配置得到，不接受请求里的路径。
- 返回的路径把 home 缩写成 `~`。
- 页面打开时请求一次，之后每 60 秒刷新一次；刷新按钮可手动刷新。不监听文件变化。

## 5. 页面

导航在「资料」之后加「接入」，路由 `/knowledge/sources`。页内分两段：**来源 | 定时任务**，默认显示来源。

### 5.1 来源段

- 卡片网格，每张卡片包含：
  - 名称；
  - 方式标签；
  - 位置（本机路径不存在时加警示点，可复制路径）；
  - 新鲜度：圆点加「最后同步 11-22 22:28」，悬停显示「最后运行：时间 状态」；
  - 刷新任务：可点击，跳到定时任务段并展开该任务；
  - 来源卡链接。
- 筛选胶囊：方式（多选）、「只看异常」（过期、偏旧、探针不存在、位置不存在、刷新任务失败）。右侧显示计数。
- 空状态见 1.3。

### 5.2 定时任务段

- 分组依次为：
  - **定时任务**：登记过的，以及登记表里找不到的；
  - **常驻服务**：只显示自建或登记过的；
  - **未登记的自建任务**：默认折叠，标题带条数。
- 行内容：状态圆点、名称、执行方标签、时间、下次运行、上次结果、关联来源。排序：失败在前，然后是未加载、找不到，其余按名称。
- 点击行，右侧打开详情卡片：
  - ref；
  - 配置文件路径（可复制）；
  - launchd 任务显示程序和参数（home 缩写；参数中看起来像密钥的值，即长度 ≥ 24 的连续字母、数字或 `_-`，显示为 `•••`）；
  - 日志路径；
  - 「日志可显示」的任务显示最后 20 行；
  - 未登记的任务给一段可复制的登记表行，方便贴进 `我/数据源.md`。

### 5.3 今天页提醒

`summary` 里 `failedTasks + staleSources > 0` 时，今天页顶部显示一行警示「N 个任务失败 · M 个来源过期」，点击进入接入页并打开「只看异常」。都为 0 时不显示。未登记任务不触发提醒。

## 6. 虚构 fixture

放在 `packages/knowledge/test/fixtures/personalos-sources/`（随测试数据一起，不含真实标识）：

- `我/数据源.md`：一个副本型来源（运行日志探针，带成功标记）、一个目录探针来源、一个查询型来源、一个探针不存在的来源、一行 `忽略`、一个找不到的任务。
- `LaunchAgents/`：定时任务（`StartCalendarInterval` 为单个 dict 和数组各一个）、`StartInterval` 任务、常驻服务、用 `com.apple.` 前缀的自建任务、一个厂商更新器、一个二进制或损坏的 plist。
- `launchctl-list.txt`：运行中、上次正常、失败、被信号终止、未加载各一个。
- `codex-automations/`：启用、暂停、已过 UNTIL、带 DTSTART 和 TZID、超出 rrule 子集各一个；toml 里放一个 `prompt` 键，用来验证它不会被返回。
- `claude-scheduled-tasks/`：一个任务。
- 运行日志：混有成功、告警、失败的行。

## 7. 测试与走查

- 单测：
  - 登记表解析（列顺序、缺列、多张表、忽略、重复标识）；
  - 新鲜度：三档边界、没有成功记录、探针不存在、目录探针、日志只读尾部；
  - plist 解析（含损坏）；中文时间和下次运行（含跨月、周日 0 和 7）；
  - 自建判断（含 `com.apple.` 前缀的自建任务）；
  - `launchctl list` 解析；
  - Codex 字段白名单（`prompt` 不出现在返回值里）和 rrule 子集；
  - 日志接口：未登记为可显示时返回 403；
  - 参数脱敏。
- 走查（fixture 加 `BLUEMANTA_TODAY`）：两段切换、筛选、点击刷新任务跳转、详情卡片、未登记折叠组、今天页提醒和点击跳转。截图 1440 和 720 宽、深浅色。
- **真实环境只读试跑**（需 Chris 同意）：检查微信来源为绿、微博签到三个任务标红（或已被修好）、Codex 的四个启用任务时间正确、未登记组里没有厂商程序。记录中不写私人内容。
