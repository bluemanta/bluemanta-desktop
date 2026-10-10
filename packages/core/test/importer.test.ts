import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  readImportLedger,
  workbenchImportRequestId,
  type ImportAttachmentInput,
  type ImportEntryInput,
  type ImportIdeaInput,
  type ImportProjectInput,
} from '../src/index.js';
import { agent, human, must, withCore } from './helpers.js';

const createdAt = '2024-01-02T03:04:05.000Z';
const updatedAt = '2024-06-07T08:09:10.000Z';
const sourceUpdatedAt = updatedAt;

function projectInput(overrides: Partial<ImportProjectInput> = {}): ImportProjectInput {
  return {
    sourceId: 'arc_learn',
    sourceUpdatedAt,
    raw: { id: 'arc_learn', direction_map: { kept: true } },
    createdAt,
    updatedAt,
    createdBy: human,
    updatedBy: { kind: 'human', name: '后来的人' },
    title: '虚构学习档案',
    area: 'growth',
    status: 'active',
    background: '背景原文',
    positioning: '初始定位：从零开始\n\n当前说明：还在看',
    pinned: true,
    ...overrides,
  };
}

function ideaInput(attachmentIds: string[] = [], overrides: Partial<ImportIdeaInput> = {}): ImportIdeaInput {
  return {
    sourceId: 'idea_legacy',
    sourceUpdatedAt,
    raw: { id: 'idea_legacy', organizationStatus: 'inbox' },
    createdAt,
    updatedAt,
    createdBy: agent,
    updatedBy: human,
    title: '收藏的想法',
    titleOrigin: 'user',
    body: '晚饭后的产品念头',
    rawInput: { status: 'present', channel: 'bot', text: 'bot 原文' },
    category: 'product',
    categorySource: 'auto',
    captureGroupId: 'group_keep',
    starred: true,
    deletedAt: null,
    extensions: [{ body: '第二天补了一句', createdAt: '2024-06-08T01:02:03.000Z' }],
    attachmentIds,
    ...overrides,
  };
}

describe('导入写入', () => {
  it('保留原始时间、来源、标题来源、分类、收藏、追记和回收站', () => {
    withCore((core) => {
      const project = must(core.importer.importProject(projectInput()));
      expect(project).toMatchObject({
        title: '虚构学习档案',
        area: 'growth',
        status: 'active',
        background: '背景原文',
        positioning: '初始定位：从零开始\n\n当前说明：还在看',
        pinned: true,
        createdAt,
        updatedAt,
        createdBy: human,
        updatedBy: { kind: 'human', name: '后来的人' },
        deletedAt: null,
        rev: 1,
      });
      expect(project).not.toHaveProperty('direction_map');

      const entryInput: ImportEntryInput = {
        sourceId: 'note_1',
        sourceUpdatedAt,
        raw: { id: 'note_1', kind: 'memo' },
        createdAt,
        updatedAt,
        createdBy: human,
        updatedBy: human,
        projectId: project.id,
        title: '档案笔记',
        titleOrigin: 'user',
        body: '笔记正文',
      };
      const note = must(core.importer.importEntry(entryInput));
      expect(note.cardType).toBe('note');
      expect(note).toMatchObject({
        title: '档案笔记',
        titleOrigin: 'user',
        body: '笔记正文',
        rawInput: { status: 'legacy' },
        projectId: project.id,
        createdAt,
        updatedAt,
        fields: {},
      });

      const idea = must(core.importer.importIdea(ideaInput()));
      expect(idea.cardType).toBe('idea');
      if (idea.cardType !== 'idea') return;
      expect(idea).toMatchObject({
        title: '收藏的想法',
        titleOrigin: 'user',
        body: '晚饭后的产品念头',
        rawInput: { status: 'present', channel: 'bot', text: 'bot 原文' },
        starred: true,
        deletedAt: null,
        createdAt,
        updatedAt,
        createdBy: agent,
        updatedBy: human,
        fields: { category: 'product', categorySource: 'auto', captureGroupId: 'group_keep' },
      });
      expect(idea.extensions).toEqual([
        { id: expect.stringMatching(/^ext_[0-9A-HJKMNP-TV-Z]{26}$/), body: '第二天补了一句', createdAt: '2024-06-08T01:02:03.000Z' },
      ]);
      expect(idea.extensions[0]?.id).not.toBe('ext_old');
      expect(core.listCards({ starred: true })).toEqual([idea]);

      const trashed = must(
        core.importer.importIdea(
          ideaInput([], {
            sourceId: 'idea_trash',
            title: '丢掉的想法',
            body: '在回收站',
            starred: true,
            deletedAt: '2024-07-01T00:00:00.000Z',
            extensions: [],
            captureGroupId: null,
            rawInput: { status: 'legacy' },
            titleOrigin: 'fallback',
            category: 'life',
            categorySource: 'user',
          }),
        ),
      );
      expect(trashed.deletedAt).toBe('2024-07-01T00:00:00.000Z');
      expect(trashed.starred).toBe(true);
      expect(trashed.titleOrigin).toBe('fallback');
      if (trashed.cardType === 'idea') {
        expect(trashed.fields).toEqual({ category: 'life', categorySource: 'user', captureGroupId: null });
      }
      expect(core.listCards().map((card) => card.id)).not.toContain(trashed.id);
      expect(core.listCards({ deleted: 'trash' }).map((card) => card.id)).toContain(trashed.id);

      const history = core.listHistory();
      expect(history.map((entry) => entry.command)).toEqual([
        'import.workbench.project',
        'import.workbench.entry',
        'import.workbench.idea',
        'import.workbench.idea',
      ]);
      expect(history.map((entry) => entry.requestId)).toEqual([
        workbenchImportRequestId('project', 'arc_learn'),
        workbenchImportRequestId('entry', 'note_1'),
        workbenchImportRequestId('idea', 'idea_legacy'),
        workbenchImportRequestId('idea', 'idea_trash'),
      ]);
      expect(history[2]).toMatchObject({ source: agent, revBefore: null, revAfter: 1, objectId: idea.id });

      const ledger = core.listImportSources();
      expect(ledger.map((row) => [row.sourceType, row.sourceId, row.targetId])).toEqual([
        ['project', 'arc_learn', project.id],
        ['entry', 'note_1', note.id],
        ['idea', 'idea_legacy', idea.id],
        ['idea', 'idea_trash', trashed.id],
      ]);
      expect(ledger[0]?.raw).toEqual({ id: 'arc_learn', direction_map: { kept: true } });
      expect(ledger[2]?.raw).toEqual({ id: 'idea_legacy', organizationStatus: 'inbox' });
      expect(readImportLedger(core.dbPath).map((row) => row.sourceId)).toEqual([
        'arc_learn',
        'note_1',
        'idea_legacy',
        'idea_trash',
      ]);
    });
  });

  it('相同来源重复执行不新增历史，内容不同则拒绝且不覆盖', () => {
    withCore((core) => {
      const first = must(core.importer.importProject(projectInput()));
      const again = must(core.importer.importProject(projectInput()));
      expect(again).toEqual(first);
      expect(core.listHistory()).toHaveLength(1);
      expect(core.listImportSources()).toHaveLength(1);

      const changed = core.importer.importProject(projectInput({ title: '被改过的标题' }));
      expect(changed.ok).toBe(false);
      if (!changed.ok) expect(changed.code).toBe('duplicate_request_mismatch');
      expect(core.getProject(first.id)?.title).toBe('虚构学习档案');
      expect(core.listHistory()).toHaveLength(1);
    });
  });

  it('校验失败不写台账，附件复制后能按 sha256 读回', () => {
    withCore((core, dir) => {
      const rejected = core.importer.importProject(projectInput({ area: 'not-an-area' }));
      expect(rejected.ok).toBe(false);
      expect(core.listProjects({ deleted: 'all' })).toEqual([]);
      expect(core.listImportSources()).toEqual([]);
      expect(core.listHistory()).toEqual([]);

      const tooLong = core.importer.importIdea(ideaInput([], { title: '字'.repeat(81) }));
      expect(tooLong.ok).toBe(false);
      expect(core.listCards({ deleted: 'all' })).toEqual([]);

      const bytes = Buffer.from('虚构图片字节');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const sourceFile = join(dir, 'source.bin');
      writeFileSync(sourceFile, bytes);
      const attachmentInput: ImportAttachmentInput = {
        sourceId: 'att_ok',
        sourceUpdatedAt,
        raw: { id: 'att_ok' },
        createdAt,
        updatedAt,
        createdBy: human,
        updatedBy: human,
        mime: 'image/png',
        byteSize: bytes.length,
        width: 12,
        height: 8,
        sha256: sha256.toUpperCase(),
      };
      const attachment = must(core.importer.importAttachment(attachmentInput, sourceFile));
      expect(attachment).toMatchObject({
        mime: 'image/png',
        byteSize: bytes.length,
        width: 12,
        height: 8,
        sha256,
        createdAt,
        updatedAt,
        path: `media/${attachment.id}.png`,
      });
      const stored = readFileSync(join(dir, attachment.path));
      expect(createHash('sha256').update(stored).digest('hex')).toBe(sha256);
      expect(readdirSync(join(dir, 'media'))).toEqual([`${attachment.id}.png`]);

      const again = must(core.importer.importAttachment(attachmentInput, sourceFile));
      expect(again.id).toBe(attachment.id);
      expect(readdirSync(join(dir, 'media'))).toEqual([`${attachment.id}.png`]);

      mkdirSync(join(dir, 'media'), { recursive: true });
      const missing = core.importer.importAttachment(
        { ...attachmentInput, sourceId: 'att_missing' },
        join(dir, '没有这个文件'),
      );
      expect(missing.ok).toBe(false);
      expect(core.listImportSources().map((row) => row.sourceId)).toEqual(['att_ok']);
      expect(readdirSync(join(dir, 'media'))).toEqual([`${attachment.id}.png`]);
    });
  });

  it('导入前备份不含即将写入的记录', () => {
    withCore((core, dir) => {
      const folder = core.backupBeforeImport();
      expect(folder).toContain('before-import');
      const imported = must(core.importer.importProject(projectInput()));
      expect(core.getProject(imported.id)?.title).toBe('虚构学习档案');
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
      const backupDb: DatabaseSync = new DatabaseSync(join(folder, 'store.sqlite'), { readOnly: true });
      const count = backupDb.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number };
      backupDb.close();
      expect(Number(count.n)).toBe(0);
      expect(readdirSync(join(dir, 'backups')).some((name) => name.includes('before-import'))).toBe(true);
    });
  });

  it('不存在的库读台账得到空列表', () => {
    expect(readImportLedger(join('/tmp', 'bluemanta-missing-ledger.sqlite'))).toEqual([]);
  });
});
