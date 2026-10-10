# S2 技术验证：替换 dsh 侧栏品牌

- 日期：2026-10-10
- 执行：Claude Code
- dsh 版本：0.2.0-rc.2（CLI；隔离 `DSH_HOME`，web profile）
- 结论：**可行**。不改 dsh 源码，一个组合包即可把侧栏和新会话首屏的 DeepSeek 标志换成 bluemanta；web 版已验证，Desktop App 内未验证

## 要回答的问题

左上角的「deepseek HARNESS」标志能不能换成 bluemanta？

## dsh 的机制

- 侧栏 `ui-sidebar` 声明了两个 single slot：`sidebar.brand.mark`（图标，收起时的轨道也用它）和 `sidebar.brand.name`（名称）。新会话首屏 `ui-conversation` 声明了 `conversation.hero.brand.mark`。
- 官方标志由 `ui-brand-official` 填入，它在 `@deepseek-ai/dsh-web-app` 组合包里是一行 `id: ui-brand-official`。该包 README 写明：自有品牌的部署应不组合它，另用一个包占据同样的 slot；没有品牌配置项。
- single slot 只能有一个占位者，第二个注册会抛错 `single slot "..." already has a registration`（`packages/client/ui-slots/src/index.ts`）。所以必须先停用官方那一行。

## 做法

纯 JS 组合包 `plugin/`，不需要构建：

| 文件 | 作用 |
|---|---|
| `package.json` | 声明 `dsh.bundle` 和 `dsh.client`（`platform: web`，`immediately: true`） |
| `cordis.patch.yml` | 用 `- id: ui-brand-official` + `disabled: true` 停用官方品牌行，再插入本包 |
| `index.js` | 宿主端空座位 |
| `client.js` | 浏览器端：占位图标（蓝底白字 b）填 `sidebar.brand.mark` 和 `conversation.hero.brand.mark`，文字「bluemanta」填 `sidebar.brand.name`；写法照搬 `ui-brand-official` 的 `ctx.slots.inject` 嵌套 |

## 复现

```bash
cd spikes/s2-brand
export DSH_HOME="$PWD/.dsh-home" DSH_TELEMETRY_DISABLED=1
dsh --profile s2 --from-default-profile web --dump-config > /dev/null
dsh plugin --profile s2 add ./plugin
dsh --profile s2 --port 3093 --no-open
```

也可以用仓库 `.claude/launch.json` 中的 `spike-s2-brand` 配置启动。

## 验收记录

| # | 检查项 | 结果 | 证据 |
|---|---|---|---|
| 1 | patch 停用官方品牌行并插入本包 | verified | `dsh --profile s2 --dump-config` 出现 `# == @deepseek-ai/dsh-web-app, patched by @bluemanta/spike-s2-brand` 下的 `ui-brand-official` + `disabled: true`，以及 `# == @bluemanta/spike-s2-brand` 层 |
| 2 | 侧栏显示占位图标和「bluemanta」 | verified | 截图；DOM 中 `[data-bluemanta-brand]` 分别位于 `data-slot="sidebar.brand.mark"` 和 `sidebar.brand.name` |
| 3 | 新会话首屏的鱼换成占位图标 | verified | 截图；第三个 `[data-bluemanta-brand]` 位于 `conversation.hero.brand.mark` |
| 4 | 侧栏收起后轨道显示占位图标 | verified | 截图；`[data-slot="sidebar.brand.mark"] [data-bluemanta-brand]` 计数为 1 |
| 5 | 深色主题 | verified | 初版用 `--dsw-alias-brand-primary` 做底色，深色下它是白色，白字消失；改为固定色 `#1f6feb` 后深浅两种主题都清楚 |
| 6 | 控制台无报错 | verified | `read_console_messages` 只看错误：无 |
| 7 | 卸载后恢复官方标志 | verified | `dsh plugin --profile s2 remove @bluemanta/spike-s2-brand` 后 `--dump-config` 中 `ui-brand-official` 不再带 `disabled`；重启后侧栏显示「deepseek HARNESS」，`[data-bluemanta-brand]` 计数为 0 |
| 8 | 在 Desktop App 内生效 | not-run | 需要往用户的 Desktop profile 装插件，待授权 |

## 发现

1. **换品牌必须先停用 `ui-brand-official`**，靠组合包 patch 里覆盖这一行的 `disabled` 即可，卸载组合包后自动恢复。
2. **浏览器标签页标题仍是「DeepSeek Harness」。** 标题由构建期变量 `DSH_CLIENT_TITLE` 决定，不走 slot，插件改不了。Desktop 的窗口标题、Dock 图标同理，不在本次范围内。
3. **新会话首屏的「探索未至之境」和「预览版」标签、首次启动的「预览版说明」弹窗**文字仍提到 DeepSeek Harness，它们不是品牌 slot，本次未处理。
4. **品牌图标不要用 `--dsw-alias-brand-primary` 做底色。** 它在深色主题下是白色，要么用固定色，要么正式 logo 本身自带对比。

## 正式实现建议

把这两段逻辑并入 `packages/dsh-plugin`：patch 里停用 `ui-brand-official`，浏览器端填三个品牌 slot。拿到正式 logo（SVG）后替换占位图标。
