<!-- Linear issue 描述模板。issue 标题即任务标题；状态、负责人、标签在 Linear 中维护。见 ADR 0004。 -->

- 负责实现：Cursor
- 负责验收：Claude Code
- 关联：<阶段、ADR、上游 issue>

## 背景

为什么要做，解决什么问题。只写实现者需要知道的内容。

## 范围

- 要做：
- 不做：

## 必读

- [AGENTS.md](../../AGENTS.md)
- <相关 ADR>
- <dsh 文档路径，如 `~/Developer/bluemanta-harness/packages/client/ui-sidebar/README.zh.md`>
- <要复用或参考的现有代码路径>

## 约束

- 允许修改的路径：
- 不允许碰的路径和数据：
- 依赖和版本：

## 验收

每条都要能实际操作。验收时逐条标注 `verified` / `failed` / `not-run`，并附命令和结果。

1.
2.
3.

## 交付物

- 一个 PR，只包含本任务的文件，描述中链接本 issue；首个可审查提交完成后及时开 PR，返工更新原 PR
- issue 中的结果评论：做了什么、偏离说明书之处及原因、已知问题、PR URL、目标分支、GitHub 上的完整 head SHA
- 交付前在任务分支或 worktree 运行 `npm run check:pr`，附实际结果。验收者可用 `npm run check:pr -- <PR号> <预期完整SHA>` 独立复核。此检查只证明提交已发布，不代表产品验收通过
- 云端只能生成 PR 元数据、拿不到 GitHub URL 或 head SHA 时，标记“待发布”并保留补丁，不声称已更新 PR

验收结论由 Claude Code 写在 issue 和 PR 的评论里。
