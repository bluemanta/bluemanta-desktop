# `@bluemanta/skills`

Skill 台的只读数据与规则包。它读取用户的 `manifest.yaml` 和 skill 文件，检查安装软链，验证与 dsh
0.2.1-rc.2 相同的 frontmatter 规则，并计算 dsh 用户级目录的发现与覆盖结果。

```ts
import { defaultSkillEnv, listIssues, listSkills } from '@bluemanta/skills';

const env = defaultSkillEnv();
const skills = listSkills(env);
const issues = listIssues(env);
```

所有入口都接收完整的 `SkillEnv`。测试和开发应注入临时 home；不要指向真实用户目录。读取失败通过
`ReadResult` 返回，不会越过公开 API 抛出 manifest 解析错误。本包不会创建目录、软链或改写登记表。

## 返回数据

- `listSkills(env)`：登记内 skill、安装目标状态、未登记安装，以及 dsh 的加载/覆盖视角。
- `getSkill(env, name)`：登记内 skill 的 frontmatter、正文和源目录一级文件名。
- `listIssues(env)`：安装、内容和 dsh 覆盖问题的扁平列表。
- `abbreviateHome(path, home)`：供 HTTP 层把绝对 home 前缀显示为 `~`；数据层仍保留绝对路径。
