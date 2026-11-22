# ADR 0012：PersonalOS 看板改由 Claude Code 实现

- 状态：已采纳
- 日期：2026-11-22
- 覆盖：[ADR 0011](0011-personalos-desk.md) 决定 9 中「实现者改为 Codex」一句。ADR 0011 的其余决定继续有效。

## 背景

PersonalOS 看板的迭代 1、2 由 Codex 按本地说明书实现，Claude Code 验收。迭代 2 验收后，Chris 决定不再把任务派给 Codex。

## 决定

1. 迭代 3 起，PersonalOS 看板由 Claude Code 自己实现，和阶段 3 知识台的做法一样（[ADR 0009](0009-knowledge-desk.md) 决定 10）。
2. 工作方式不变：
   - 在本机 worktree `~/Developer/bm-pos` 的 `codex/personalos-desk` 分支上开发（分支名保留，不改名）；
   - 规则写进 `docs/specs/personalos-ui.md`，任务和验收项写进 `docs/tasks/personalos-*.md`；
   - 每个任务一笔本地提交，验收项逐条标 `verified` / `failed` / `not-run`。
3. 实现者和验收者是同一方，所以每个迭代结束时，用真实 PersonalOS 的只读试跑和 Chris 的试用把关。真实试跑仍需 Chris 每次同意。
4. 推送、开 PR、合并到 `main`，仍由 Chris 决定（ADR 0011 决定 9 的这一部分不变）。

## 影响

- 不再需要写给 Codex 的提示词。说明书仍然要写，作为验收依据和以后的记录。
