# PersonalOS 看板 · 迭代 1 实现记录

日期：2026-11-21。工作区：`~/Developer/bm-pos`，分支：`codex/personalos-desk`。起点：`b46e411d9bf08d6a1ae8b298decacb98afc76506`。

仅使用本 worktree 的虚构 fixture；未访问真实 PersonalOS / Knowledge / Shuyun。未推送、开 PR、合并、改写提交、添加依赖或安装浏览器。各任务提交产生之后再补记 SHA，避免在提交内容中自引用自己的哈希。

## P1 PersonalOS 解析与 fixture

### 实现与兼容

新增只读 PersonalOsReader、路由/状态/待办/分组/资料/收件箱/日志解析、安全文件读取、iCloud 逻辑文件状态及事项/知识发现；34 项测试；26 个原创林舟 fixture 文件。所有响应每次现读。未知 Markdown 节与缩进保留；资料引用只 stat、不读正文。

默认配置新增 personalos，LibraryConfig.kind 明确区分结构。为满足“现有调用方行为不变”，KnowledgeEnv 输入兼容旧的无 kind 定义，规范化为 arsenal；旧库列表及默认索引暂时过滤 personalos，P4 再单独启用网页搜索。此为兼容实现选择，未修改允许范围外文件。没有其它偏离。

### 验收

所有 npm 命令在 bm-pos 执行，环境固定：

```sh
export BLUEMANTA_KNOWLEDGE_HOME="$PWD/packages/knowledge/fixtures/home"
export BLUEMANTA_SKILL_HOME="$PWD/packages/knowledge/fixtures/home"
export BLUEMANTA_TODAY=2026-11-21
npm run build && npm run check && npm test
```

1. **verified**：上述最终命令退出 0，9 workspace 构建和类型检查通过；15 个 PR 检查器单测（本地 mock，未调用远端交付检查）+ 378 个 workspace 单测通过，合计 393。knowledge 72（旧 38 + 新 34）、server 77、CLI 18、MCP 5、dsh 73。
2. **verified**：`npm run test -w @bluemanta/knowledge -- test/personalos.test.ts`，34 tests passed；第 9 节映射见下表。
3. **verified**：测试打印及 `node --input-type=module` 导入 dist 的 PersonalOsReader 对 fixture 调用 today()，得到 `overdue=2, dueToday=1, next7=2, waiting=1, undated.total=5, later.count=1, inbox=3`。无日期仅返回前 3 条。等待与周期标签不重复计数。
4. **verified**：`git grep --no-index -n -E '/Users/|Chris|apple|数云|SalesOS|SolutionLoop|FDE' -- packages/knowledge/fixtures/home/Documents/PersonalOS`，退出 1、无命中。内容由本次独立编写，人物林舟/秦遥/夏禾均为虚构；没有读取真实文字进行比对（按禁止读取的要求）。
5. **verified**：全仓测试中的原有 knowledge library 17 + search 21 全通过，旧 server 知识接口 10 项全通过，Arsenal 行为保持。
6. **not-run**（通用走查）：通过 `node --input-type=module` 查询 `chromium.executablePath()` 和 `existsSync`，当前 Playwright 要求缓存 `chromium-1248/.../Google Chrome for Testing` 不存在。按说明书不下载、不换浏览器，`npm run walkthrough` 未运行。

### fixture / 测试对应

以下均在 `packages/knowledge/test/personalos.test.ts`，均 verified：

| 规格第 9 节情形 | 测试名称 |
|---|---|
| 9 行路由、未登记、缺目录 | 九行路由按表格顺序，财务标目录不存在，园艺追加为未登记 |
| 六组数量与去重 | 今天分组为 2 / 1 / 2 / 1 / 5 / 1，每件事只出现一次且无日期只显示前三条 |
| 完成日期、周期、未知标签、非法 due、链接、行号 | 待办保存完成日期、周期、未知标签、无效日期警告、Markdown 链接和原文件行号 |
| 3 个过期、1 个缺日期、暂无/待补充空节 | 三份状态超过十四天，缺日期单独标记，暂无与待补充为空节 |
| 小标题/加粗/非标准节/2 挂接卡/缺口词 | 非标准节、小标题、加粗、变化备注和两张挂接卡片不丢失 |
| 3 领域/9 资料/2 表/三种位置/存在与缺失 | 三个领域九条资料登记包含两张表、本机存在与缺失、链接、其他及未知状态 |
| 收件箱3条、两月日志、无领域与交付说明 | 收件箱三条；跨月日志保留无领域条目和两份交付说明，支持更早与领域筛选 |
| 事项文件/目录、知识、协议/蓝图/CLAUDE一行 | 事项文件、事项目录入口、知识文件以及协议和蓝图按需发现 |
| iCloud、.claude、.DS_Store | iCloud 占位使用逻辑名称且明确未下载，隐藏文件不列出也不能读 |

另测 +7/+8 与等待优先级、14/15 天、同日领域顺序、stat 注入、日期覆盖与本地时区、每次重新读、缺库、11 种非法路径、库外/隐藏/断裂/循环软链、下载恢复，以及未知节/挂接卡/日志首行缩进保留。

### 已知边界

缺目录的财务同时没有更新日期，按规格纳入 staleDomains；现存领域中 3 个超过 14 天、园艺无日期。iCloud 以逻辑文件名返回 availability=icloud，不暴露隐藏占位路径。fixture 的 .DS_Store 是纯文本排除测试哨兵，按具体路径强制加入（未改 .gitignore）。真实库验收不在本轮范围。

提交 SHA：提交完成后补记于下方。

P1 提交 SHA：`2cc750fe36a399fbc5d668323baf8add4658d441`。

## P2 本地服务 PersonalOS 只读接口

### 实现与偏离

六个 GET 接口接入共享 Bearer / Host 校验，响应均 no-store；公共响应类型位于 api-types.ts。错误区分 library_missing / invalid_path / not_found / read_error；普通文件仅元信息，iCloud 明确未下载。

为支持规格 4.3 的入口说明/协议/蓝图导航，概览增加只读 `documents` 列表（加法字段，不改变原字段）。文件接口保留 v1 的 library/file/displayPath 形状，领域详情按规格顶层平铺。

knowledge/src 两处小改均为接口所需：旧 getLibrary 拒绝 PersonalOS，阻断旧 HTTP 与 agent 文件通道绕过新隐藏路径规则；文件路径探测区分真实权限/I/O 故障与非法路径。没有改允许范围外文件。权限回归先实际复现旧实现误返回400，修复后为500。

### 验收

1. **verified**：与 P1 相同 fixture 环境下执行 `npm run build && npm run check && npm test`，最终退出 0。15 个 PR 检查器单测 + 400 个 workspace 单测全通过，合计415。server 99（新增 PersonalOS 22）、knowledge 72；两条真实 chmod 权限测试在当前普通用户实际执行，无跳过。用例各自在 finally 恢复临时目录权限。
2. **verified**：运行 `node --input-type=module` 启动构建产物 `startServer`，BLUEMANTA_KNOWLEDGE_HOME 指向 fixture、BLUEMANTA_TODAY=2026-11-21，数据目录由 mkdtemp 创建在 bm-pos/packages/server/dist，随机127.0.0.1端口。逐条执行 `curl --silent --show-error --fail-with-body --max-time 10 -H 'Authorization: Bearer <临时口令>' http://127.0.0.1:<临时端口>/api/v1/<路径>`，以下均200；口令未打印，finally关闭服务并清理本次临时目录。

| curl 路径 | 实际结果摘要 |
|---|---|
| personalos | exists=true，10领域，inbox=3，root=~/Documents/PersonalOS |
| personalos/today | 2 / 1 / 2 / 1 / 5 / 1 |
| personalos/domains/工作（URL编码） | id=工作，todos=3，mounts=2 |
| personalos/registry | items=9 |
| personalos/log | items=6，hasMore=true |
| personalos/files/我/状态.md（分段URL编码） | kind=markdown，availability=available，path为库内相对路径 |

3. **verified**：全仓命令中的旧 `test/knowledge-api.test.ts` 10项全部通过；新增测试也验证personal/arsenal仍可读、旧personalos文件入口404拒读。
4. **verified**：`npm run test -w @bluemanta/server -- test/personalos-api.test.ts`（agent局部验证）22项通过：六接口鉴权/Host/no-store/形状、缺库、非法/隐藏/越界路径、缺文件、日期覆盖、每次重读、iCloud、资料路径、日志筛选、读取异常脱敏与真实EACCES分支。
5. **not-run**：Playwright走查，原因同P1（所需chromium-1248未缓存），未下载浏览器。

已知问题：没有剩余单元测试或类型失败；真实库与Desktop运行验收未执行，属于用户保留的后续验收范围。

提交 SHA：提交完成后补记于下方。

P2 提交 SHA：`bf79f88c8148029e7947b9e3d840234bdf012ad0`。

## P3 网页外壳、今天页、领域页

### 实现与偏离

五段导航、侧栏到期计数、命令面板与旧路径重定向已接入。今天页显示重点、六组事项、过期领域与收件箱；领域页提供网格、键盘移动、状态/资料/事项/知识/文件详情，复用现有详情宽度、列表样式、Banner、EmptyState 和 Markdown 阅读器。状态正文保留未知 Markdown；挂接卡片、缺口词高亮、相对链接、锚点、文件列表和 iCloud 提示已实现。资料与动态按本任务要求为占位。

开发和走查固定 fixture home 与 2026-11-21；Skill/DSH 的沙盒环境也指向 fixture，避免继承父 shell 的个人目录配置。新增行为与截图用例，改写已移除的旧个人库页面用例。没有改允许范围外文件，没有新增依赖。新增 CSS 复用 tokens.css 与既有 local.css 的边框/表格尺寸变量，没有新增全局变量。

实现期间发现显式文件列表与正文状态链接需要区分：文件列表直达阅读器，正文状态链接进入领域详情。首次全量 check 在两组件 onReadFile 参数尚未接齐时失败；补齐后已通过。随后补齐今天行内纯锚点跳转回退，并单独重验网页包。

### 验收

1. **verified**：与 P1 相同 fixture 环境运行 `npm run build && npm run check && npm test`，最终退出0。15个 PR 检查器单测 + 408个 workspace 单测，共423项通过；web 56项（新增路由3项、Markdown/详情/阅读器5项）。行内锚点最后修正后再执行 `npm run build -w @bluemanta/web && npm run check -w @bluemanta/web && npm run test -w @bluemanta/web`，三项通过、web56项通过。
2. **verified（只收集）**：`npm run walkthrough -w @bluemanta/web -- --list`，退出0，151 tests in 10 files。包含20条PersonalOS行为测试和8条截图测试。
3. **failed（命令启动） / not-run（浏览器验收）**：误用根命令 `npm run walkthrough -- --list` 时，根 npm 脚本没有继续转发参数，实际启动完整走查并退出1；浏览器启动报所需 Chromium 1248 可执行文件不存在，页面断言未执行。未下载、升级或替代浏览器。后续仅执行上一项正确的收集命令。缺失路径为 `~/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`（existsSync=false）。
4. **not-run**：今天页、领域网格、含挂接卡片领域详情的1440/720深浅色截图，以及1280/1024扩展截图。没有生成截图，不能提供已生成路径；脚本实际运行后约定输出 `packages/web/screenshots/personalos-{today|domains|domain-detail}-{宽}x{高}-{light|dark}.png`，24张，不提交。
5. **verified（静态/单测） / not-run（走查）**：灵感台源文件未修改，既有灵感与外壳单测通过；灵感/嵌入/模块切换走查仍在151条收集结果中，但浏览器未执行。仓库本身没有Skill网页走查，不能声称其视觉回归通过。
6. **verified**：`git diff --check`，无空白错误。新增路径/组件及脚本均在允许范围。

### 设计规范第10节逐项自查

| 项 | 状态与证据 |
|---|---|
| 1 变量、颜色、字号 | verified（静态）：Python正则扫描新增两份PersonalOS CSS，没有原始颜色或字号；所用变量均可在tokens.css或既有local.css查到。未改tokens.css或local.css。 |
| 2 数据状态 | verified（单测）：SSR验证未知原文、多个标签、挂接卡片、高亮与HTML转义、iCloud无正文；not-run（浏览器）：正常、空库、读取失败缓存、长标题/正文、筛选无结果等交互。原文重复、legacy原文、未保存修改属于灵感功能，现有用例保留但未运行。 |
| 3 尺寸/主题/嵌入 | not-run：四档尺寸、深浅色、main/sidebar用例已编写并收集，未启动浏览器，未在真实dsh中验收。 |
| 4 键盘与焦点 | verified（静态/路由单测）：命令与路由配置、J/K/H/L逻辑和详情定位已实现；not-run：实际快捷键、Tab顺序、焦点可见性与返回焦点。 |
| 5 200%文字放大 | not-run：无浏览器视觉验收。 |
| 6 结果与截图基线 | verified：本节逐项记录；没有截图或用户认可，不登记基线。 |

已知问题：浏览器验收、截图与200%文字放大待匹配版本浏览器可用后执行；没有剩余构建、类型或单元测试失败。P3的资料/动态占位与旧搜索保留由P4继续替换。

提交 SHA：提交完成后补记于下方。
