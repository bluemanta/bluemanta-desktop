import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCore, workbenchImportRequestId } from '@bluemanta/core';
import { parseArgs } from '../src/cli.js';
import { formatReport } from '../src/report.js';
import { runImport } from '../src/run.js';
import { loadConfig } from '../src/source.js';

const IDEA_BODY = '灵感正文不该出现在报告里紫藤';
const NOTE_BODY = '笔记正文不该出现在报告里青柿';
const RAW_TEXT = '机器人原话不进报告';
const EXTENSION_BODY = '第二天补的追记不进报告';
const NEW_BODY = '新的正文不该覆盖进去';

const LEARN_CREATED = '2024-01-02T03:04:05.000Z';
const LEARN_UPDATED = '2024-06-07T08:09:10.000Z';
const IDEA_CREATED = '2024-02-03T04:05:06.000Z';
const IDEA_UPDATED = '2024-03-04T05:06:07.000Z';
const TRASH_AT = '2024-08-09T10:11:12.000Z';

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeFixture(root: string, ideasExtra: Record<string, unknown>[] = []): { png: Buffer; pngSha: string } {
  const png = Buffer.from('虚构png字节');
  const pngSha = sha256(png);
  const media = join(root, 'media', 'inspiration-desk', 'inspiration_desk');
  mkdirSync(media, { recursive: true });
  writeFileSync(join(media, 'att_ok'), png);
  writeFileSync(join(media, 'att_ok.json'), JSON.stringify({ sha256: pngSha.toUpperCase(), note: '只给测试' }));
  writeFileSync(join(media, 'att_bad'), Buffer.from('对不上的字节'));
  writeFileSync(join(media, 'att_bad.json'), JSON.stringify({ sha256: 'ab'.repeat(32) }));

  const store = {
    projects: [
      {
        id: 'arc_learn',
        category: 'learning',
        title: '虚构学习档案',
        summary: '摘要只留在台账',
        background: '一段虚构背景',
        initial_positioning: '从零开始',
        current_positioning: '现在更清楚',
        status: '还在看',
        source: { kind: 'human', name: '虚构作者' },
        created_at: LEARN_CREATED,
        updated_at: LEARN_UPDATED,
        pinned: true,
        direction_map: { kept: true },
      },
      {
        id: 'arc_build',
        category: 'project',
        title: '虚构工具档案',
        background: '',
        source: { kind: 'agent', name: '虚构代理' },
        created_at: '2023-05-06T07:08:09.000Z',
        updated_at: '2023-05-06T07:08:09.000Z',
      },
      {
        id: 'arc_old',
        category: 'project',
        title: '虚构归档档案',
        archived: true,
        created_at: '2022-01-01T00:00:00.000Z',
        updated_at: '2022-02-02T00:00:00.000Z',
      },
      {
        id: 'arc_demo',
        category: 'project',
        title: '演示档案',
        demo: true,
        created_at: '2021-01-01T00:00:00.000Z',
        updated_at: '2021-01-01T00:00:00.000Z',
      },
    ],
    entries: [
      {
        id: 'note_full',
        project_id: 'arc_learn',
        kind: 'memo',
        title: '档案笔记',
        body: '可见的笔记',
        source: { kind: 'human', name: '虚构作者' },
        created_at: '2024-04-05T06:07:08.000Z',
        public_candidate: true,
      },
      {
        id: 'note_blank',
        project_id: 'arc_learn',
        title: '',
        body: NOTE_BODY,
        created_at: '2024-04-06T06:07:08.000Z',
      },
      {
        id: 'note_demo_child',
        project_id: 'arc_demo',
        title: '演示档案下的笔记',
        body: '不该导入',
        created_at: '2024-04-07T06:07:08.000Z',
      },
      {
        id: 'note_marked_demo',
        project_id: 'arc_learn',
        title: '标了演示的笔记',
        body: '也不该导入',
        demo: true,
        created_at: '2024-04-08T06:07:08.000Z',
      },
    ],
    module_data: {
      'inspiration-desk': {
        inspiration_desk: {
          schema_version: 6,
          data: {
            ideas: [
              {
                id: 'idea_legacy',
                title: '收藏的想法',
                titleOrigin: 'user',
                text: IDEA_BODY,
                rawInput: { status: 'legacy', kind: 'legacy_unknown' },
                organizationStatus: 'inbox',
                createdSource: { kind: 'human', name: '虚构作者' },
                updatedSource: { kind: 'agent', name: '虚构代理' },
                createdAt: IDEA_CREATED,
                updatedAt: IDEA_UPDATED,
                category: 'learning',
                categorySource: 'user',
                captureGroupId: 'group_fixture',
                starred: true,
                extensions: [{ id: 'old_ext', body: EXTENSION_BODY, createdAt: '2024-03-05T00:00:00.000Z' }],
              },
              {
                id: 'idea_bot',
                title: '已有兜底标题',
                titleOrigin: 'fallback',
                text: '晚饭后去散步',
                rawInput: { status: 'present', kind: 'bot', text: RAW_TEXT },
                createdSource: { kind: 'agent', name: '虚构代理' },
                createdAt: '2024-05-01T00:00:00.000Z',
                updatedAt: '2024-05-02T00:00:00.000Z',
                category: 'product',
                categorySource: 'auto',
                starred: false,
                attachments: [
                  {
                    id: 'att_ok',
                    path: 'media/inspiration-desk/inspiration_desk/att_ok',
                    mime: 'image/png',
                    width: 3,
                    height: 4,
                    byteSize: png.length,
                  },
                ],
              },
              {
                id: 'idea_trash',
                title: '丢掉的想法',
                titleOrigin: 'user',
                text: '在回收站里',
                rawInput: { status: 'present', kind: 'web', text: '网页原文' },
                createdSource: { kind: 'agent', name: '虚构代理' },
                createdAt: '2024-07-01T00:00:00.000Z',
                updatedAt: '2024-07-02T00:00:00.000Z',
                category: 'life',
                categorySource: 'user',
                starred: true,
                deletedAt: TRASH_AT,
              },
              {
                id: 'idea_badimg',
                title: '图坏了也要留下',
                titleOrigin: 'user',
                text: '正文还在',
                rawInput: { status: 'legacy', kind: 'legacy_unknown' },
                createdSource: { kind: 'human', name: '虚构作者' },
                createdAt: '2024-07-03T00:00:00.000Z',
                updatedAt: '2024-07-04T00:00:00.000Z',
                category: 'other',
                categorySource: 'auto',
                attachments: [
                  {
                    id: 'att_bad',
                    path: 'media/inspiration-desk/inspiration_desk/att_bad',
                    mime: 'image/png',
                    width: 1,
                    height: 1,
                    byteSize: Buffer.from('对不上的字节').length,
                  },
                  {
                    id: 'att_missing',
                    path: 'media/inspiration-desk/inspiration_desk/att_missing',
                    mime: 'image/png',
                    width: 1,
                    height: 1,
                    byteSize: 1,
                  },
                ],
              },
              ...ideasExtra,
            ],
            accounts: [{ id: 'account_skip', name: '不导入' }],
            topics: [{ id: 'topic_skip' }],
            outputs: [{ id: 'output_skip' }],
          },
        },
      },
    },
  };
  writeFileSync(join(root, 'store.json'), `${JSON.stringify(store, null, 2)}\n`);
  return { png, pngSha };
}

function ids(lines: Array<{ sourceId: string }>): string[] {
  return lines.map((item) => item.sourceId);
}

function backupCount(dataDir: string): number {
  const folder = join(dataDir, 'backups');
  if (!existsSync(folder)) return 0;
  return readdirSync(folder).filter((name) => name.includes('before-import')).length;
}

describe('workbench 导入', () => {
  it('映射、增量、来源变化、备份和来源只读', () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-src-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'wb-data-'));
    const configPath = join(root, 'areas.json');
    writeFileSync(configPath, JSON.stringify({ projectArea: { arc_build: 'family' } }));
    const { pngSha } = writeFixture(root);
    const sourcePath = join(root, 'store.json');
    const stamp = new Date('2020-01-01T00:00:00.000Z');
    utimesSync(sourcePath, stamp, stamp);
    const before = readFileSync(sourcePath);
    const beforeMtime = statSync(sourcePath).mtimeMs;

    const first = runImport({ sourcePath, dataDir, configPath, dryRun: false });
    const printed = formatReport(first);
    expect(printed).not.toContain(IDEA_BODY);
    expect(printed).not.toContain(NOTE_BODY);
    expect(printed).not.toContain(RAW_TEXT);
    expect(printed).not.toContain(EXTENSION_BODY);
    expect(printed).toContain('虚构学习档案');
    expect(ids(first.sections.project.created)).toEqual(['arc_learn', 'arc_build', 'arc_old']);
    expect(ids(first.sections.project.skipped)).toEqual(['arc_demo']);
    expect(first.sections.project.failed).toEqual([]);
    expect(ids(first.sections.entry.created)).toEqual(['note_full', 'note_blank']);
    expect(ids(first.sections.entry.skipped)).toEqual(['note_demo_child', 'note_marked_demo']);
    expect(ids(first.sections.idea.created)).toEqual(['idea_legacy', 'idea_bot', 'idea_trash', 'idea_badimg']);
    expect(ids(first.sections.attachment.created)).toEqual(['att_ok']);
    expect(first.sections.attachment.failed.map((item) => [item.sourceId, item.reason])).toEqual([
      ['att_bad', 'sha256 不一致'],
      ['att_missing', '附件文件缺失'],
    ]);
    expect(first.backupDir).toBeTruthy();
    expect(backupCount(dataDir)).toBe(1);
    expect(readFileSync(sourcePath).equals(before)).toBe(true);
    expect(statSync(sourcePath).mtimeMs).toBe(beforeMtime);

    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const backupDb = new DatabaseSync(join(first.backupDir ?? '', 'store.sqlite'), { readOnly: true });
    const backupProjects = backupDb.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number };
    const backupCards = backupDb.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number };
    backupDb.close();
    expect(Number(backupProjects.n)).toBe(0);
    expect(Number(backupCards.n)).toBe(0);

    const core = openCore({ dataDir });
    try {
      expect(core.schemaVersion).toBe(3);
      const learn = core.listProjects().find((project) => project.title === '虚构学习档案');
      expect(learn).toMatchObject({
        area: 'growth',
        status: 'active',
        pinned: true,
        background: '一段虚构背景',
        positioning: '初始定位：从零开始\n\n当前定位：现在更清楚\n\n当前说明：还在看',
        createdAt: LEARN_CREATED,
        updatedAt: LEARN_UPDATED,
        createdBy: { kind: 'human', name: '虚构作者' },
        updatedBy: { kind: 'human', name: '虚构作者' },
      });
      expect(learn).not.toHaveProperty('direction_map');
      expect(learn).not.toHaveProperty('summary');
      const build = core.listProjects().find((project) => project.title === '虚构工具档案');
      expect(build).toMatchObject({
        area: 'family',
        status: 'active',
        pinned: false,
        createdBy: { kind: 'agent', name: '虚构代理' },
      });
      const archived = core.listProjects({ status: 'archived' });
      expect(archived).toHaveLength(1);
      expect(archived[0]).toMatchObject({
        title: '虚构归档档案',
        area: 'product',
        positioning: '',
        createdBy: { kind: 'human', name: 'legacy_unknown' },
        updatedBy: { kind: 'human', name: 'legacy_unknown' },
      });
      expect(core.listProjects({ deleted: 'all' }).map((project) => project.title)).not.toContain('演示档案');

      const notes = core.listCards({ cardType: 'note', deleted: 'all' });
      expect(notes).toHaveLength(2);
      const full = notes.find((card) => card.title === '档案笔记');
      expect(full).toMatchObject({
        titleOrigin: 'user',
        body: '可见的笔记',
        rawInput: { status: 'legacy' },
        projectId: learn?.id,
        createdAt: '2024-04-05T06:07:08.000Z',
        updatedAt: '2024-04-05T06:07:08.000Z',
        createdBy: { kind: 'human', name: '虚构作者' },
      });
      const blank = notes.find((card) => card.title === NOTE_BODY);
      expect(blank).toMatchObject({ titleOrigin: 'fallback', projectId: learn?.id });
      expect(notes.map((card) => card.title)).not.toContain('演示档案下的笔记');
      expect(notes.map((card) => card.title)).not.toContain('标了演示的笔记');

      const legacy = core.listCards({ starred: true }).find((card) => card.title === '收藏的想法');
      expect(legacy?.cardType).toBe('idea');
      if (legacy?.cardType === 'idea') {
        expect(legacy).toMatchObject({
          titleOrigin: 'user',
          body: IDEA_BODY,
          rawInput: { status: 'legacy' },
          createdAt: IDEA_CREATED,
          updatedAt: IDEA_UPDATED,
          createdBy: { kind: 'human', name: '虚构作者' },
          updatedBy: { kind: 'agent', name: '虚构代理' },
          fields: { category: 'learning', categorySource: 'user', captureGroupId: 'group_fixture' },
        });
        expect(legacy.extensions).toEqual([
          {
            id: expect.stringMatching(/^ext_[0-9A-HJKMNP-TV-Z]{26}$/),
            body: EXTENSION_BODY,
            createdAt: '2024-03-05T00:00:00.000Z',
          },
        ]);
        expect(legacy.extensions[0]?.id).not.toBe('old_ext');
      }

      const bot = core.listCards().find((card) => card.title === '已有兜底标题');
      expect(bot?.cardType).toBe('idea');
      if (bot?.cardType === 'idea') {
        expect(bot).toMatchObject({
          titleOrigin: 'fallback',
          body: '晚饭后去散步',
          rawInput: { status: 'present', channel: 'bot', text: RAW_TEXT },
          fields: { category: 'product', categorySource: 'auto', captureGroupId: null },
          createdBy: { kind: 'agent', name: '虚构代理' },
        });
        expect(bot.attachmentIds).toHaveLength(1);
        const attachment = core.getAttachment(bot.attachmentIds[0] ?? '');
        expect(attachment).toMatchObject({
          mime: 'image/png',
          byteSize: Buffer.from('虚构png字节').length,
          width: 3,
          height: 4,
          sha256: pngSha,
          createdAt: '2024-05-01T00:00:00.000Z',
          updatedAt: '2024-05-02T00:00:00.000Z',
        });
        expect(attachment?.path).toBe(`media/${attachment?.id}.png`);
        const stored = readFileSync(join(dataDir, attachment?.path ?? ''));
        expect(sha256(stored)).toBe(pngSha);
        expect(readdirSync(join(dataDir, 'media'))).toEqual([`${attachment?.id}.png`]);
      }

      const trash = core.listCards({ deleted: 'trash' });
      expect(trash.map((card) => card.title)).toEqual(['丢掉的想法']);
      expect(trash[0]).toMatchObject({ starred: true, deletedAt: TRASH_AT, createdBy: { kind: 'agent', name: '虚构代理' } });
      expect(core.listCards().map((card) => card.title)).not.toContain('丢掉的想法');

      const bad = core.listCards().find((card) => card.title === '图坏了也要留下');
      expect(bad?.attachmentIds).toEqual([]);

      const ledger = core.listImportSources();
      expect(ledger.find((row) => row.sourceId === 'arc_learn')?.raw).toMatchObject({
        direction_map: { kept: true },
        summary: '摘要只留在台账',
      });
      expect(ledger.find((row) => row.sourceId === 'idea_legacy')?.raw).toMatchObject({ organizationStatus: 'inbox' });
      expect(ledger.find((row) => row.sourceId === 'note_full')?.raw).toMatchObject({ public_candidate: true });
      expect(core.listHistory().map((entry) => entry.requestId)).toContain(workbenchImportRequestId('project', 'arc_learn'));
      expect(core.listHistory().map((entry) => entry.command)).toEqual(
        expect.arrayContaining([
          'import.workbench.project',
          'import.workbench.entry',
          'import.workbench.idea',
          'import.workbench.attachment',
        ]),
      );
    } finally {
      core.close();
    }

    const second = runImport({ sourcePath, dataDir, configPath, dryRun: false });
    expect(second.backupDir).toBeNull();
    expect(backupCount(dataDir)).toBe(1);
    for (const type of ['project', 'entry', 'idea', 'attachment'] as const) {
      expect(second.sections[type].created).toEqual([]);
      expect(second.sections[type].changed).toEqual([]);
      expect(second.sections[type].failed).toEqual([]);
    }
    expect(ids(second.sections.project.skipped)).toEqual(['arc_learn', 'arc_build', 'arc_old', 'arc_demo']);
    expect(ids(second.sections.idea.skipped)).toEqual(['idea_legacy', 'idea_bot', 'idea_trash', 'idea_badimg']);
    expect(readFileSync(sourcePath).equals(before)).toBe(true);

    const store = JSON.parse(readFileSync(sourcePath, 'utf8')) as {
      module_data: { 'inspiration-desk': { inspiration_desk: { data: { ideas: Record<string, unknown>[] } } } };
    };
    store.module_data['inspiration-desk'].inspiration_desk.data.ideas.push({
      id: 'idea_new',
      title: '后加的一条',
      titleOrigin: 'user',
      text: '新增正文',
      rawInput: { status: 'legacy', kind: 'legacy_unknown' },
      createdSource: { kind: 'human', name: '虚构作者' },
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      category: 'work',
      categorySource: 'user',
    });
    writeFileSync(sourcePath, `${JSON.stringify(store, null, 2)}\n`);
    const third = runImport({ sourcePath, dataDir, configPath, dryRun: false });
    expect(ids(third.sections.idea.created)).toEqual(['idea_new']);
    expect(third.sections.project.created).toEqual([]);
    expect(third.sections.entry.created).toEqual([]);
    expect(third.sections.attachment.created).toEqual([]);
    expect(third.sections.idea.failed).toEqual([]);
    expect(backupCount(dataDir)).toBe(2);

    const changedStore = JSON.parse(readFileSync(sourcePath, 'utf8')) as {
      module_data: { 'inspiration-desk': { inspiration_desk: { data: { ideas: Array<Record<string, unknown>> } } } };
    };
    const legacy = changedStore.module_data['inspiration-desk'].inspiration_desk.data.ideas.find((idea) => idea.id === 'idea_legacy');
    if (!legacy) throw new Error('缺少 idea_legacy');
    legacy.updatedAt = '2026-01-01T00:00:00.000Z';
    legacy.title = '改过的标题';
    legacy.text = NEW_BODY;
    writeFileSync(sourcePath, `${JSON.stringify(changedStore, null, 2)}\n`);
    const fourth = runImport({ sourcePath, dataDir, configPath, dryRun: false });
    expect(ids(fourth.sections.idea.changed)).toEqual(['idea_legacy']);
    expect(fourth.sections.idea.created).toEqual([]);
    expect(formatReport(fourth)).not.toContain(NEW_BODY);
    expect(backupCount(dataDir)).toBe(2);
    const after = openCore({ dataDir });
    try {
      expect(after.listCards({ deleted: 'all' }).find((card) => card.title === '收藏的想法')).toMatchObject({
        body: IDEA_BODY,
        updatedAt: IDEA_UPDATED,
      });
      expect(after.listCards({ deleted: 'all' }).map((card) => card.title)).not.toContain('改过的标题');
      expect(after.listCards().find((card) => card.title === '后加的一条')?.cardType).toBe('idea');
    } finally {
      after.close();
    }

    rmSync(root, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('dry-run 不写数据库、附件和备份，来源字节不变', () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-dry-src-'));
    const dataDir = join(tmpdir(), `wb-dry-data-${Date.now()}`);
    writeFixture(root);
    const sourcePath = join(root, 'store.json');
    const before = readFileSync(sourcePath);
    utimesSync(sourcePath, new Date('2020-02-02T00:00:00.000Z'), new Date('2020-02-02T00:00:00.000Z'));
    const mtime = statSync(sourcePath).mtimeMs;
    const report = runImport({ sourcePath, dataDir, dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.backupDir).toBeNull();
    expect(existsSync(dataDir)).toBe(false);
    expect(ids(report.sections.project.created)).toEqual(['arc_learn', 'arc_build', 'arc_old']);
    expect(ids(report.sections.attachment.failed).sort()).toEqual(['att_bad', 'att_missing']);
    expect(readFileSync(sourcePath).equals(before)).toBe(true);
    expect(statSync(sourcePath).mtimeMs).toBe(mtime);
    expect(formatReport(report)).toContain('dry-run');
    expect(formatReport(report)).not.toContain(IDEA_BODY);

    const dataDir2 = mkdtempSync(join(tmpdir(), 'wb-dry-live-'));
    runImport({ sourcePath, dataDir: dataDir2, dryRun: false });
    const dbPath = join(dataDir2, 'store.sqlite');
    const hash = sha256(readFileSync(dbPath));
    const backups = backupCount(dataDir2);
    const again = runImport({ sourcePath, dataDir: dataDir2, dryRun: true });
    expect(again.sections.idea.created).toEqual([]);
    expect(again.sections.attachment.failed).toEqual([]);
    expect(sha256(readFileSync(dbPath))).toBe(hash);
    expect(backupCount(dataDir2)).toBe(backups);
    expect(existsSync(join(dataDir2, 'media'))).toBe(true);

    rmSync(root, { recursive: true, force: true });
    rmSync(dataDir2, { recursive: true, force: true });
  });

  it('一条失败不影响其他记录，下次只重试失败的', () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-bad-src-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'wb-bad-data-'));
    const store = {
      projects: [
        {
          id: 'arc_good',
          category: 'learning',
          title: '好档案',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 'arc_bad',
          category: 'nope',
          title: '坏档案',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      ],
      entries: [
        {
          id: 'note_bad_parent',
          project_id: 'arc_bad',
          title: '挂不上',
          body: '正文',
          created_at: '2024-01-02T00:00:00.000Z',
        },
      ],
      module_data: {
        'inspiration-desk': {
          inspiration_desk: {
            schema_version: 6,
            data: { ideas: [], accounts: [], topics: [], outputs: [] },
          },
        },
      },
    };
    const sourcePath = join(root, 'store.json');
    writeFileSync(sourcePath, JSON.stringify(store));
    const first = runImport({ sourcePath, dataDir, dryRun: false });
    expect(ids(first.sections.project.created)).toEqual(['arc_good']);
    expect(first.sections.project.failed.map((item) => item.sourceId)).toEqual(['arc_bad']);
    expect(first.sections.entry.failed[0]?.reason).toBe('所属档案未导入');
    const second = runImport({ sourcePath, dataDir, dryRun: false });
    expect(second.sections.project.created).toEqual([]);
    expect(ids(second.sections.project.skipped)).toEqual(['arc_good']);
    expect(second.sections.project.failed.map((item) => item.sourceId)).toEqual(['arc_bad']);
    const core = openCore({ dataDir });
    try {
      expect(core.listProjects().map((project) => project.title)).toEqual(['好档案']);
    } finally {
      core.close();
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('解析命令行参数，并接受示例配置', () => {
    expect(parseArgs([])).toMatchObject({ dryRun: false });
    expect(parseArgs([]).sourcePath).toContain('BluemantaOPC');
    expect(parseArgs([]).dataDir).toContain('BluemantaDesktop');
    expect(
      parseArgs(['--source', '/tmp/store.json', '--data-dir', '/tmp/data', '--config', '/tmp/map.json', '--dry-run']),
    ).toEqual({
      sourcePath: '/tmp/store.json',
      dataDir: '/tmp/data',
      configPath: '/tmp/map.json',
      dryRun: true,
    });
    expect(() => parseArgs(['--unknown'])).toThrow(/未知参数/);
    const example = loadConfig(
      readFileSync(new URL('../workbench-import.example.json', import.meta.url), 'utf8'),
    );
    expect(example).toEqual({
      projectArea: { 'example-learning': 'growth', 'example-project': 'product' },
    });
  });
});
