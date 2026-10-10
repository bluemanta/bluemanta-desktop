import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultDataDir, type CardUpdateInput } from '../src/index.js';
import { human, idea, must, req, withCore } from './helpers.js';

describe('命令与读取', () => {
  it('默认数据目录指向 BluemantaDesktop', () => {
    expect(defaultDataDir()).toBe(join(homedir(), 'Library', 'Application Support', 'BluemantaDesktop'));
  });

  it('创建后按 id 读回同一条记录，并带上信封', () => {
    withCore((core) => {
      const project = must(
        core.project.create({
          requestId: req(),
          source: human,
          title: '交付',
          area: 'work',
          background: '背景',
          positioning: '定位',
          pinned: true,
          locations: [{ label: '仓库', path: '/tmp/example' }],
        }),
      );
      expect(project.id).toMatch(/^project_[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(project.module).toBe('core');
      expect(project.rev).toBe(1);
      expect(project.createdAt).toBe(project.updatedAt);
      expect(project.createdBy).toEqual(human);
      expect(project.deletedAt).toBeNull();
      expect(core.getProject(project.id)).toEqual(project);
      expect(core.listProjects({ area: 'work', status: 'active' })).toEqual([project]);

      const task = must(
        core.task.create({
          requestId: req(),
          source: human,
          title: '跟进',
          projectId: project.id,
          due: '2026-10-10',
          priority: 'high',
          blocked: true,
          blockedReason: '等材料',
          origin: { module: 'core', objectId: project.id },
          notes: '说明',
          ext: { salesos: { stage: 'demo' } },
        }),
      );
      expect(task.id).toMatch(/^task_[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(core.getTask(task.id)).toEqual(task);
      expect(core.listTasks({ projectId: project.id, status: 'todo' })).toEqual([task]);
      expect(core.listTasks({ projectId: null })).toEqual([]);

      const card = must(core.card.create(idea({ projectId: project.id, tags: ['虚构'] })));
      expect(card.cardType).toBe('idea');
      expect(core.getCard(card.id)).toEqual(card);
      expect(core.listCards({ cardType: 'idea', category: 'product', starred: false })).toEqual([card]);

      const link = must(
        core.link.create({ requestId: req(), source: human, from: card.id, to: task.id, rel: 'related' }),
      );
      expect(core.getLink(link.id)).toEqual(link);
      expect(core.listLinks({ from: card.id, rel: 'related' })).toEqual([link]);
      const removed = must(core.link.delete({ requestId: req(), source: human, id: link.id, rev: link.rev }));
      expect(core.listLinks()).toEqual([]);
      expect(core.listLinks({ deleted: 'trash' })).toEqual([removed]);
      expect(core.getAttachment('attachment_missing')).toBeNull();
      expect(core.listAttachments()).toEqual([]);
    });
  });

  it('scene 和 note 只有类型位，idea 必须带 fields，原始输入不能改', () => {
    withCore((core) => {
      const scene = must(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'scene',
          title: '场景占位',
          rawInput: { status: 'legacy' },
        }),
      );
      const note = must(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'note',
          title: '',
          body: '笔记',
          rawInput: { status: 'present', channel: 'bot', text: '原话' },
        }),
      );
      expect(scene.fields).toEqual({});
      expect(note.fields).toEqual({});
      expect(note.title).toBe('');

      const incomplete = idea();
      delete (incomplete as { fields?: unknown }).fields;
      expect(core.card.create(incomplete)).toMatchObject({ ok: false, code: 'invalid_input' });
      expect(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'scene',
          title: '不该有字段',
          rawInput: { status: 'legacy' },
          fields: { category: 'work' },
        } as never),
      ).toMatchObject({ ok: false, code: 'invalid_input' });

      const card = must(core.card.create(idea({ rawInput: { status: 'present', channel: 'web', text: '原始' } })));
      const touched = {
        requestId: req(),
        source: human,
        id: card.id,
        rev: card.rev,
        body: '新正文',
        rawInput: { status: 'legacy' },
      } as CardUpdateInput;
      expect(core.card.update(touched)).toMatchObject({ ok: false, code: 'invalid_input' });
      expect(core.getCard(card.id)?.rawInput).toEqual(card.rawInput);

      const recategorized = must(
        core.card.update({
          requestId: req(),
          source: human,
          id: card.id,
          rev: card.rev,
          fields: { category: 'learning' },
        }),
      );
      expect(recategorized.cardType).toBe('idea');
      if (recategorized.cardType === 'idea') {
        expect(recategorized.fields).toEqual({
          category: 'learning',
          categorySource: 'user',
          captureGroupId: null,
        });
      }

      const starred = must(
        core.card.setStar({
          requestId: req(),
          source: human,
          id: card.id,
          rev: recategorized.rev,
          starred: true,
        }),
      );
      expect(starred.starred).toBe(true);
      expect(core.listCards({ starred: true }).map((item) => item.id)).toEqual([card.id]);
    });
  });

  it('关联的对象不存在时拒绝，截止日期格式不对时拒绝', () => {
    withCore((core) => {
      const card = must(core.card.create(idea()));
      expect(
        core.link.create({ requestId: req(), source: human, from: card.id, to: 'task_missing', rel: 'related' }),
      ).toMatchObject({ ok: false, code: 'not_found' });
      expect(
        core.task.create({ requestId: req(), source: human, title: '坏日期', due: '2026-13-40' }),
      ).toMatchObject({ ok: false, code: 'invalid_input' });
      expect(core.listLinks({ deleted: 'all' })).toEqual([]);
      expect(core.listTasks({ deleted: 'all' })).toEqual([]);
      expect(core.listHistory()).toHaveLength(1);
    });
  });
});
