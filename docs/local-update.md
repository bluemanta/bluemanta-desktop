# 本地更新流程

Claude Code 在每次合并后执行，让用户的 DeepSeek Harness Desktop 用上最新版本。

## 前提

用户的 Desktop 通过「插件 → 添加插件」安装了本地目录 `~/Developer/bluemanta-desktop/packages/dsh-plugin`（link 安装，指向工作目录，不复制代码）。

## 步骤

1. `git switch main && git pull --ff-only`
2. `npm ci && npm run build`
   - 网页（`packages/web`）的改动构建后立即生效：本地服务直接读 `dist`，刷新页面即可。
   - 本地服务、core 的改动：`npm run service -- restart`，让 launchd 用新代码重新拉起；`npm run service -- status` 确认健康检查通过。
3. **备份用户数据**：数据库结构有变化时，core 打开数据库前会自动备份到 `~/Library/Application Support/BluemantaDesktop/backups/<时间戳>/`。导入、批量修改等操作前另行手动备份。
4. **重启 Desktop**（只有 `packages/dsh-plugin` 有改动时需要）：菜单「DeepSeek Harness → 退出」后重新打开。只停用再启用插件、或刷新页面都不够——浏览器端模块按包名缓存，同名模块不会重新执行（2026-10-10 T2 验收时实测）。
5. 打开左侧栏对应面板，确认变化生效，再通知用户。

## 只读核对真实数据

本地服务运行时数据库处于 WAL 模式。只读查询用 `sqlite3 -readonly "file:<数据目录>/store.sqlite?mode=ro"`（能看到 WAL 里的最新写入）；服务停着、要求绝对不碰文件时用 `?immutable=1`。普通 `-readonly` 打开路径在部分环境会报错 14。

## 验证新版本时

验收阶段不要直接把用户 Desktop 指向未合并的代码。先用 `npm run dev:dsh`（隔离的 `DSH_HOME` 和数据目录，端口 3092）验证；必须在 Desktop 中验证时，验证完成后卸载、重启 Desktop，再从 `main` 重新安装。
