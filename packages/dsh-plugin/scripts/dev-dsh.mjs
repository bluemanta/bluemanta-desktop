#!/usr/bin/env node
/**
 * 在仓库内的 .dsh-dev/ 启动隔离的 dsh，不碰用户的 ~/.dsh 和真实数据目录。
 *
 * dsh 锁定为 @deepseek-ai/dsh@0.2.0-rc.2，装在 .dsh-dev/cli，不写进仓库依赖。
 * profile 用 web 模板初始化（--dump-config 只建配置、不启动服务），装上本插件后再监听 3092。
 * 数据目录是 .dsh-dev/data。插件拉起的本地服务用 4311，避开用户本机的 4310。
 * 数据目录还没有 store.sqlite 时，写入网页包的虚构种子。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDirNeedsSeed, DEV_SERVER_PORT, pluginNeedsAdd, profileNeedsCreate } from '../src/dev-dsh-plan.js';

const DSH_PACKAGE = '@deepseek-ai/dsh@0.2.0-rc.2';
// 脚本在 packages/dsh-plugin/scripts/，向上四级才是仓库根。
const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const devRoot = join(root, '.dsh-dev');
const home = join(devRoot, 'home');
const dataDir = join(devRoot, 'data');
const cliDir = join(devRoot, 'cli');
const dshBin = join(cliDir, 'node_modules', '.bin', 'dsh');

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} 退出 ${signal ?? code}`));
    });
  });
}

function ensurePnpm() {
  const probe = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
  if (probe.status === 0) return;
  console.error('dev:dsh 需要 pnpm 在 PATH 上：dsh plugin 会把安装转交给 pnpm。');
  process.exit(1);
}

function ensureDsh(env) {
  if (existsSync(dshBin)) {
    const pkgPath = join(cliDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
    if (existsSync(pkgPath)) {
      const installed = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
      if (installed === '0.2.0-rc.2') return;
    }
  }
  mkdirSync(cliDir, { recursive: true });
  return run('npm', ['install', '--prefix', cliDir, DSH_PACKAGE], env);
}

const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (rootManifest.name !== 'bluemanta-desktop') {
  console.error(`dev:dsh 找不到仓库根目录，当前解析为 ${root}`);
  process.exit(1);
}

const baseEnv = { ...process.env };
mkdirSync(home, { recursive: true });
mkdirSync(dataDir, { recursive: true });
ensurePnpm();

const devEnv = {
  ...baseEnv,
  DSH_HOME: home,
  DSH_TELEMETRY_DISABLED: '1',
  BLUEMANTA_DATA_DIR: dataDir,
  BLUEMANTA_SERVER_PORT: DEV_SERVER_PORT,
};

function dependencyNames(profileDir) {
  const manifestPath = join(profileDir, 'package.json');
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
}

await run('npm', ['run', 'build'], baseEnv);
if (dataDirNeedsSeed(existsSync(dataDir) ? readdirSync(dataDir) : [])) {
  await run('node', ['packages/web/scripts/seed-cli.ts', '--data-dir', dataDir], baseEnv);
} else {
  console.error('dev:dsh 数据目录已有 store.sqlite，跳过虚构数据');
}
await ensureDsh(baseEnv);
const profileDir = join(home, 'profiles', 'bluemanta-dev');
if (profileNeedsCreate(existsSync(profileDir))) {
  await run(dshBin, ['--profile', 'bluemanta-dev', '--from-default-profile', 'web', '--dump-config'], devEnv);
} else {
  console.error('dev:dsh profile 已存在，跳过创建');
}
if (pluginNeedsAdd(dependencyNames(profileDir))) {
  await run(dshBin, ['plugin', '--profile', 'bluemanta-dev', 'add', './packages/dsh-plugin'], devEnv);
} else {
  console.error('dev:dsh 插件已安装，跳过 plugin add');
}
await run(dshBin, ['--profile', 'bluemanta-dev', '--port', '3092', '--no-open'], devEnv);
