# ADR 0003：产品核心用 TypeScript 重写

- 状态：已采纳
- 日期：2026-10-10

## 背景

灵感台现有的业务核心是 Python（`bluemanta-workbench/modules/inspiration_desk/core/`），workbench 的本地服务也是 Python。Desktop 的界面是 dsh 插件，dsh 插件和宿主都是 TypeScript / Node。

两种选择：

- 保留 Python 核心：现有代码和测试可以直接沿用，但 dsh 插件不能直接调用 Python，需要额外挂一个本地服务或命令行包装，全栈要维护两种语言。
- 用 TypeScript 重写：全栈只有一种语言，dsh 宿主插件可以直接调用核心；代价是要重做灵感台核心的校验和写入保护。

## 决定

Desktop 的产品核心（数据正本层和能力层）用 TypeScript 重写。

- 灵感台 Python 核心不迁移代码，只作为**规格来源**：它的数据结构（业务 schema 6）、校验规则、写入协议（来源、版本冲突、幂等 `request_id`）和测试用例，整理进任务说明书，由实现者用 TypeScript 重写并通过等价测试。
- workbench 的冻结数据通过一次性导入进入 Desktop，不保留 Python 运行时。
- 跨模块的公共对象（任务、项目、人、卡片）放在同一个 TypeScript 核心里，见 vision.md。

## 后果

- 好处：一种语言；dsh 宿主插件和 MCP 服务直接复用核心；公共对象只有一处定义。
- 代价：重写的工作量；要确认重写后的行为与 Python 版一致，靠移植过来的测试用例保证。
- 遵循 `CodeProjects/AGENTS.md` 的默认栈（TypeScript、npm），具体工程模板在阶段 1 开工前确定。
