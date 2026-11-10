# ADR 0010：分开 dsh 的 API 参考版本和允许运行的版本范围

- 状态：已采纳
- 日期：2026-11-10
- 补充：[ADR 0002](0002-dsh-version-and-reference-source.md) 的「升级规则」和 [ADR 0007](0007-dsh-0-2-1-rc-2.md) 的决定 1–3。两条 ADR 的其余内容不变。

## 背景

2026-11-10，DeepSeek Harness Desktop 自动升级到 0.2.2-rc.1，左侧栏的灵感台和知识台再次消失。这是第二次。2026-10-18 升到 0.2.1-rc.2 时也是同样的原因，见 ADR 0007。

原因：`packages/dsh-plugin/package.json` 的 `peerDependencies` 把 `@deepseek-ai/dsh-tools` 写成精确版本 `0.2.1-rc.2`。dsh 的插件兼容检查发现宿主版本不满足要求，于是拒绝加载插件。同一 profile 里的 dshmarket、dsh-better-sidebar、@michengai/dsh-skills-manager 写的是版本范围，这两次都没受影响。

ADR 0007 把「每次升级都要显式核对」当成精确版本的好处，但这个假设不成立：

- Desktop 会自动升级，公开源码里找不到关闭自动更新的开关；
- 升级先发生，核对后补。精确版本没有让核对提前，只是让插件在核对完成前一直不可用；
- 两次升级后核对的结论都是插件代码不用改，只差版本声明。

在隔离 `DSH_HOME` 里给 0.2.2-rc.1 放行后，插件能加载，灵感台、知识台的嵌入框都正常（verified）；agent 工具未实测。

### dsh 0.2.2-rc.1 的兼容检查规则

`packages/boot/app-boot/src/plugin-compatibility.ts`（标签 `dsh-v0.2.2-rc.1`）：

- 插件 `package.json` 有 `engines.dsh` 时只看它，忽略 `peerDependencies`；
- 没有 `engines.dsh` 时，每个名字是 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` 的 peer 都要满足；
- 范围用 `semver.satisfies(runtime, range, { includePrerelease: true })` 判断，预发布版本参与匹配；
- 不满足时只能按「插件名@版本 + 精确 dsh 版本」放行（`compatibility.json`）。

0.2.1-rc.2 已有同样的规则（ADR 0007 的表格）。

## 上游变化（0.2.1-rc.2 → 0.2.2-rc.1，只看插件用到的部分）

对照提交 `d1b9c04067` 与 `2f97f60455`（`release(dsh): 0.2.2-rc.1`）。标签 `dsh-v0.2.2-rc.1` 指向合并提交 `66491b05e3`，两者文件内容完全相同。

| 插件用到的 | 变化 | 对插件的影响 |
|---|---|---|
| `sidebar.panellist`（ui-sidebar） | 插槽和元数据不变；新增 `sidebar.panellist.actions`（「更多」菜单）和入口隐藏状态（`entryPins`，插件重载前只存在内存里） | 不影响。用户可以在「更多」里隐藏灵感台、知识台入口，冒烟检查要用全新 profile |
| `sidebar.brand.mark` / `sidebar.brand.name` | 不变 | — |
| `main`（ui-layout） | 插槽不变；`AppFrame` 改了样式和列宽 | 不影响 |
| `sidebar.right.pane.tab` / `.title`（ui-sidebar-right） | 插槽不变；新增浮动面板（`destination: 'float'`、`panel.isFloating`），`replaceTab` 的说明扩展到浮动面板 | 不影响。插件没传 `destination`，仍落在停靠栏 |
| `sidebarRight` 服务 | `openTab`、`focus`、`mounted`、`openTabs`、`registerCloseHandler` 都还在，签名不变 | 不影响 |
| `sidebarRightTabs.register` | 不变 | — |
| `sessions.scope(id)` → `conversation.input.for(actx).setDraft()` | 签名不变；ui-session 新增 `whenAccess` | 「引用到对话」不受影响 |
| `tool.call.toolview`（ui-tool） | 插槽不变，只改注释；`ToolTreeProps` 多注入文件菜单 | 不影响；`block.argsRaw` 和 `call.argsRaw` 仍在 |
| `defineTool`（`@deepseek-ai/dsh-tools`） | `packages/core/tools` 重组较大（拆出 `contracts.ts`、`pipeline.ts`，删掉 PTC 相关文件）；`defineTool` 签名不变；`exec.signal`、`exec.callId` 仍在；新增 `projectToolSchema` | 插件用到的部分不变。参考版本升到 0.2.2-rc.1 后，以 `tsc` 通过为准 |
| Desktop 快捷键（`apps/desktop/src/preload-app.ts`） | 新增 `fileActions`、`fileDrag`；`iframe[data-html-preview]` 的匹配不变 | S5 的结论仍成立 |
| 插件开发指南（`cordis-plugin-development`） | 英文标签用句首大写；新增「插件不要改写 profile 的 `cordis.patch.yml`，改用 `configEditor`」 | 插件不写 profile 配置，不影响 |

npm 上 `@deepseek-ai/dsh` 的 `latest` 和 `next` 都是 0.2.2-rc.1；`@deepseek-ai/dsh-tools` 的 `next` 是 0.2.2-rc.1（它的 `latest` 是很早的 0.0.1-rc.1，不要用 `latest`）。

## 决定

1. **把两件事分开。**
   - **API 参考版本**：一个精确的上游提交。写插件、读文档、读源码时以它为准，开发依赖也装这个版本。
   - **允许运行的版本范围**：插件声明自己能在哪些 dsh 版本上运行。宿主在范围内时 dsh 直接加载插件，不需要放行。
2. **运行范围是 `>=0.2.1-rc.2 <0.3.0-0`**，写在 `packages/dsh-plugin/package.json` 的 `engines.dsh`。
   - 下限 0.2.1-rc.2：插件已在 0.2.1-rc.2 和 0.2.2-rc.1 上实际加载过。
   - 上限 `<0.3.0-0`：dsh 还在 0.x，次版本号变化可能有不兼容改动；写 `-0` 是为了把 0.3.0 的 alpha、rc 也挡在外面。
3. **选 `engines.dsh`，不用 `peerDependencies` 表达运行范围**，理由：
   - dsh 有 `engines.dsh` 时只看它，规则单一，不会因为以后多加一个 dsh peer 而被意外拒绝；
   - `peerDependencies` 还会被 pnpm 解读（`dsh plugin add` 把安装交给 pnpm），pnpm 判断范围时不包含预发布版本，`>=0.2.1-rc.2 <0.3.0-0` 在 pnpm 眼里不匹配 0.2.2-rc.1。同一个字段两套解释，容易误判；
   - `engines.dsh` 只用来回答「能在哪些 dsh 上运行」，和 API 参考版本互不干扰。
   `peerDependencies` 里仍保留 `@deepseek-ai/dsh-tools`：插件运行时需要由宿主 profile 提供这个包。它的值改成同一个范围 `>=0.2.1-rc.2 <0.3.0-0`，免得读的人以为插件只支持一个版本。dsh 会忽略它；pnpm 可能报 peer 不匹配的警告，但这个警告不会阻止安装。
4. **API 参考版本升到 0.2.2-rc.1**，参考源码改为上游提交 `2f97f60455`。本机参考分支是 `~/Developer/bluemanta-harness` 的 `ref/dsh-0.2.2-rc.1`；`ref/dsh-0.2.1-rc.2` 和 `ref/dsh-0.2.0-rc.2` 保留，用于对照旧版。理由：用户的 Desktop 已经是 0.2.2-rc.1，npm 的 `latest` 也是它；上表核对没有发现插件需要改的地方。`devDependencies` 的 `@deepseek-ai/dsh-tools` 和 `scripts/dev-dsh.mjs` 的 `DSH_VERSION` 随之改为 0.2.2-rc.1。
5. **每次升级后跑自检。** 新增 `npm run dsh:smoke`：用 Desktop 自带的 CLI 在临时 `DSH_HOME` 里装上插件并启动，检查插件没被拒载、左侧栏有「灵感台」「知识台」入口、两个嵌入框都能加载，结束后清理。Desktop 自动升级后先跑它，不用等用户发现入口消失。
6. **升级规则（替换 ADR 0002「升级规则」中针对小版本的部分）**：
   - **范围内的升级**（例如 0.2.2、0.2.3-rc.1）：Desktop 自动升级后跑 `npm run dsh:smoke`。通过就不用另写 ADR，也不用改插件；参考版本可以留在原处，等有需要时再升（升参考版本要新增 ADR，并按第 4 条的方式核对上游变化）。不通过时按 ADR 0002 的流程处理，并新增 ADR。
   - **超出范围的升级**（0.3.0 及其预发布版本）：插件会被拒载。按 ADR 0002 的流程核对上游变化，新增 ADR 修改范围或参考版本。
   - 范围以外的临时放行仍然要先征得用户同意（硬规则 7），修复合并后再撤掉。

## 后果

- 0.2.x 内的自动升级不会再让灵感台、知识台消失。代价是：范围内的升级如果带来不兼容改动，插件会照常加载但可能出错，只能靠 `dsh:smoke` 和使用中发现。`dsh:smoke` 只覆盖加载和嵌入框，不覆盖 agent 工具的调用，这部分仍需在验收时手动检查。
- 参考版本和运行版本可以不一致。写插件时以参考版本的源码为准，遇到只在新版本出现的问题，先升参考版本再改代码。
- 历史文档（ADR 0001、0007、spikes、阶段计划）里的版本号是当时的记录，不改写。
- 产品代码的改动按 ADR 0004 委派给 Cursor：`packages/dsh-plugin/package.json` 的版本声明、`dev-dsh.mjs` 的版本、测试中的版本断言、README 中的版本号、根 `package-lock.json`，以及新增的 `dsh:smoke`。
