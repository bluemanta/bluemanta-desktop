#!/usr/bin/env node
// 验收用冒烟脚本。先在仓库根目录执行 npm run build。
// ELECTRON_RUN_AS_NODE=1 "<DeepSeek Harness>" packages/core/scripts/smoke.mjs <数据目录>
import { openCore } from '../dist/index.js';

const dataDir = process.argv[2];
if (!dataDir) {
  console.error('用法: node packages/core/scripts/smoke.mjs <数据目录>');
  process.exit(1);
}

const source = { kind: 'human', name: 'smoke' };
const core = openCore({ dataDir });
let exitCode = 0;

try {
  const project = unwrap(
    core.project.create({
      requestId: 'smoke-project',
      source,
      title: '冒烟项目',
      area: 'product',
      background: '虚构样例',
    }),
    'project.create',
  );
  const task = unwrap(
    core.task.create({
      requestId: 'smoke-task',
      source,
      title: '冒烟任务',
      projectId: project.id,
    }),
    'task.create',
  );
  const card = unwrap(
    core.card.create({
      requestId: 'smoke-card',
      source,
      cardType: 'idea',
      title: '冒烟灵感',
      body: '虚构正文',
      rawInput: { status: 'present', channel: 'agent', text: '冒烟' },
      fields: { category: 'product', captureGroupId: null },
      projectId: project.id,
    }),
    'card.create',
  );
  const link = unwrap(
    core.link.create({
      requestId: 'smoke-link',
      source,
      from: card.id,
      to: task.id,
      rel: 'related',
    }),
    'link.create',
  );
  const summary = {
    dataDir,
    schemaVersion: core.schemaVersion,
    areas: core.listAreas().map((area) => area.id),
    project: project.id,
    task: task.id,
    card: card.id,
    link: link.id,
    history: core.listHistory().length,
  };
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.message : error);
} finally {
  core.close();
}

if (exitCode !== 0) process.exit(exitCode);

function unwrap(result, command) {
  if (!result.ok) {
    throw new Error(`${command} 失败: ${result.code} ${result.message}`);
  }
  return result.record;
}
