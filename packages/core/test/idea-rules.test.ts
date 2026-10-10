import { describe, expect, it } from 'vitest';
import { agent, human, idea, must, req, withCore } from './helpers.js';

const otherHuman = { kind: 'human' as const, name: '另一人' };

describe('灵感规则', () => {
  it('没给标题时用正文生成兜底标题，修改时不带 title 不重算', () => {
    withCore((core) => {
      const folded = must(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'idea',
          title: '',
          body: '  你好\n\n世界  \t',
          fields: {},
        }),
      );
      expect(folded.title).toBe('你好 世界');
      expect(folded.titleOrigin).toBe('fallback');
      expect(folded.body).toBe('  你好\n\n世界  \t');

      const longBody = `开头${'字'.repeat(100)}`;
      const truncated = must(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'idea',
          body: longBody,
          fields: {},
        }),
      );
      expect(Array.from(truncated.title)).toHaveLength(80);
      expect(truncated.title).toBe(Array.from('开头' + '字'.repeat(100)).slice(0, 80).join(''));
      expect(truncated.titleOrigin).toBe('fallback');

      const renamed = must(
        core.card.update({
          requestId: req(),
          source: human,
          id: folded.id,
          rev: folded.rev,
          body: '晚饭散步',
        }),
      );
      expect(renamed.title).toBe(folded.title);
      expect(renamed.titleOrigin).toBe('fallback');

      const explicit = must(
        core.card.update({
          requestId: req(),
          source: human,
          id: folded.id,
          rev: renamed.rev,
          title: '用户标题',
        }),
      );
      expect(explicit.title).toBe('用户标题');
      expect(explicit.titleOrigin).toBe('user');

      const reset = must(
        core.card.update({
          requestId: req(),
          source: human,
          id: folded.id,
          rev: explicit.rev,
          title: '',
          body: '  重新\t生成  ',
        }),
      );
      expect(reset.title).toBe('重新 生成');
      expect(reset.titleOrigin).toBe('fallback');
    });
  });

  it('没有实质内容时拒绝，未命名灵感只在正文为空且有附件时出现', () => {
    withCore((core) => {
      const emptyCases = [
        { title: '', body: '   ' },
        { title: '', body: '' },
        { body: ' \n\t ' },
        { title: '   ', body: '' },
        {},
      ];
      for (const patch of emptyCases) {
        const result = core.card.create({
          requestId: req(),
          source: human,
          cardType: 'idea',
          ...patch,
        });
        expect(result, JSON.stringify(patch)).toMatchObject({ ok: false, code: 'invalid_input' });
        if (!result.ok) expect(result.message, JSON.stringify(patch)).toContain('至少');
      }
      expect(core.listCards({ deleted: 'all' })).toEqual([]);
      expect(core.listHistory()).toEqual([]);

      const unnamed = must(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'idea',
          title: '',
          body: '',
          attachmentIds: ['attachment_only'],
        }),
      );
      expect(unnamed.title).toBe('未命名灵感');
      expect(unnamed.titleOrigin).toBe('fallback');
      expect(unnamed.attachmentIds).toEqual(['attachment_only']);

      const whitespaceBody = must(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'idea',
          title: '',
          body: '   ',
          attachmentIds: ['attachment_space'],
        }),
      );
      expect(whitespaceBody.title).toBe('未命名灵感');
      expect(whitespaceBody.titleOrigin).toBe('fallback');

      const rejected = core.card.update({
        requestId: req(),
        source: human,
        id: unnamed.id,
        rev: unnamed.rev,
        title: '',
        body: ' \n ',
        attachmentIds: [],
      });
      expect(rejected).toMatchObject({ ok: false, code: 'invalid_input' });
      expect(core.getCard(unnamed.id)).toEqual(unnamed);

      const stillNamed = must(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'idea',
          title: '原标题',
          body: '原正文',
          attachmentIds: ['attachment_keep'],
        }),
      );
      const cleared = core.card.update({
        requestId: req(),
        source: human,
        id: stillNamed.id,
        rev: stillNamed.rev,
        title: '   ',
        body: '',
        attachmentIds: [],
      });
      expect(cleared).toMatchObject({ ok: false, code: 'invalid_input' });
      expect(core.getCard(stillNamed.id)).toEqual(stillNamed);
    });
  });

  it('新建 idea 可以不传 fields，省略则自动分类且 captureGroupId 为 null', () => {
    withCore((core) => {
      const card = must(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'idea',
          title: '读书笔记',
        }),
      );
      expect(card.cardType).toBe('idea');
      if (card.cardType === 'idea') {
        expect(card.fields).toEqual({ category: 'learning', categorySource: 'auto', captureGroupId: null });
      }
    });
  });

  it('省略 rawInput 时按来源生成，显式传入的 bot 保持不变', () => {
    withCore((core) => {
      const web = must(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'idea',
          title: '标题',
          body: '正文甲',
          fields: {},
        }),
      );
      expect(web.rawInput).toEqual({ status: 'present', channel: 'web', text: '正文甲' });

      const fromAgent = must(
        core.card.create({
          requestId: req(),
          source: agent,
          cardType: 'idea',
          title: '只有标题',
          body: '',
          fields: {},
        }),
      );
      expect(fromAgent.rawInput).toEqual({ status: 'present', channel: 'agent', text: '只有标题' });

      const bot = must(
        core.card.create(
          idea({
            rawInput: { status: 'present', channel: 'bot', text: '机器人原话' },
          }),
        ),
      );
      expect(bot.rawInput).toEqual({ status: 'present', channel: 'bot', text: '机器人原话' });
    });
  });

  it('用户指定分类后不再自动覆盖，未指定时随内容重算', () => {
    withCore((core) => {
      const chosen = must(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'idea',
          title: '读书笔记',
          body: '今天听了播客',
          fields: { category: 'product' },
        }),
      );
      expect(chosen.fields).toEqual({ category: 'product', categorySource: 'user', captureGroupId: null });
      const stillChosen = must(
        core.card.update({
          requestId: req(),
          source: human,
          id: chosen.id,
          rev: chosen.rev,
          body: '晚饭散步',
        }),
      );
      expect(stillChosen.cardType).toBe('idea');
      if (stillChosen.cardType === 'idea') {
        expect(stillChosen.fields.category).toBe('product');
        expect(stillChosen.fields.categorySource).toBe('user');
      }

      const auto = must(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'idea',
          title: '读书笔记',
          fields: { captureGroupId: 'group_1' },
        }),
      );
      expect(auto.cardType).toBe('idea');
      if (auto.cardType === 'idea') {
        expect(auto.fields).toEqual({ category: 'learning', categorySource: 'auto', captureGroupId: 'group_1' });
      }
      const recategorized = must(
        core.card.update({
          requestId: req(),
          source: human,
          id: auto.id,
          rev: auto.rev,
          title: '生活随想',
          body: '晚饭',
        }),
      );
      if (recategorized.cardType === 'idea') {
        expect(recategorized.fields.category).toBe('life');
        expect(recategorized.fields.categorySource).toBe('auto');
        expect(recategorized.fields.captureGroupId).toBe('group_1');
      }

      expect(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'idea',
          title: '不该带来源',
          fields: { category: 'work', categorySource: 'auto' },
        } as never),
      ).toMatchObject({ ok: false, code: 'invalid_input' });
    });
  });

  it('回收站中的卡片不能修改、追记或收藏；不在回收站不能彻底删除', () => {
    withCore((core) => {
      const card = must(core.card.create(idea({ attachmentIds: ['attachment_a', 'attachment_b'] })));
      const task = must(core.task.create({ requestId: req(), source: human, title: '还在的任务' }));
      const noted = must(
        core.card.addExtension({ requestId: req(), source: human, id: card.id, rev: card.rev, body: '一条追记' }),
      );
      const extensionId = noted.extensions[0]?.id ?? '';
      expect(core.card.purge({ requestId: req(), source: human, id: card.id, rev: noted.rev })).toMatchObject({
        ok: false,
        code: 'invalid_input',
      });
      const trashed = must(core.card.delete({ requestId: req(), source: human, id: card.id, rev: noted.rev }));

      for (const result of [
        core.card.update({ requestId: req(), source: human, id: card.id, rev: trashed.rev, body: '改不了' }),
        core.card.addExtension({ requestId: req(), source: human, id: card.id, rev: trashed.rev, body: '再记' }),
        core.card.deleteExtension({
          requestId: req(),
          source: human,
          id: card.id,
          rev: trashed.rev,
          extensionId,
        }),
        core.card.setStar({ requestId: req(), source: human, id: card.id, rev: trashed.rev, starred: true }),
      ]) {
        expect(result).toMatchObject({ ok: false, code: 'invalid_input' });
        if (!result.ok) expect(result.message).toContain('先恢复');
      }
      expect(core.card.purge({ requestId: req(), source: human, id: card.id, rev: card.rev })).toMatchObject({
        ok: false,
        code: 'version_conflict',
      });
      expect(core.task.purge({ requestId: req(), source: human, id: task.id, rev: task.rev })).toMatchObject({
        ok: false,
        code: 'invalid_input',
      });
      expect(core.getCard(card.id)?.extensions).toHaveLength(1);
      expect(core.getTask(task.id)?.deletedAt).toBeNull();

      const purged = must(core.card.purge({ requestId: req(), source: human, id: card.id, rev: trashed.rev }));
      expect(purged).toEqual({ id: card.id, attachmentIds: ['attachment_a', 'attachment_b'] });
      expect(core.getCard(card.id)).toBeNull();
    });
  });

  it('收藏不改 updatedAt 和 updatedBy，但 rev 加 1', () => {
    withCore((core) => {
      const card = must(core.card.create(idea()));
      const starred = must(
        core.card.setStar({
          requestId: req(),
          source: otherHuman,
          id: card.id,
          rev: card.rev,
          starred: true,
        }),
      );
      expect(starred.starred).toBe(true);
      expect(starred.updatedAt).toBe(card.updatedAt);
      expect(starred.updatedBy).toEqual(card.updatedBy);
      expect(starred.rev).toBe(card.rev + 1);
      expect(core.listHistory({ objectId: card.id }).at(-1)).toMatchObject({
        command: 'card.setStar',
        revBefore: card.rev,
        revAfter: card.rev + 1,
      });
    });
  });

  it('agent 不能追加或删除追记', () => {
    withCore((core) => {
      const card = must(core.card.create(idea()));
      const noted = must(
        core.card.addExtension({ requestId: req(), source: human, id: card.id, rev: card.rev, body: '人写的' }),
      );
      const extensionId = noted.extensions[0]?.id ?? '';
      expect(
        core.card.addExtension({ requestId: req(), source: agent, id: card.id, rev: noted.rev, body: '代理追记' }),
      ).toMatchObject({ ok: false, code: 'forbidden_source' });
      expect(
        core.card.deleteExtension({
          requestId: req(),
          source: agent,
          id: card.id,
          rev: noted.rev,
          extensionId,
        }),
      ).toMatchObject({ ok: false, code: 'forbidden_source' });
      expect(core.card.addExtension({ requestId: req(), source: human, id: card.id, rev: noted.rev, body: '' })).toMatchObject({
        ok: false,
        code: 'invalid_input',
      });
      expect(core.getCard(card.id)?.extensions.map((item) => item.body)).toEqual(['人写的']);
    });
  });

  it('搜索是多关键词 AND、不区分大小写，能按分类中文名命中，默认不含回收站', () => {
    withCore((core) => {
      const older = must(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'idea',
          title: 'Alpha 记录',
          body: '这里有 Beta',
          rawInput: { status: 'present', channel: 'web', text: '原始 GAMMA' },
          fields: { category: 'other' },
        }),
      );
      const newer = must(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'idea',
          title: 'zzzz',
          body: '没有那些词',
          rawInput: { status: 'legacy' },
          fields: { category: 'product' },
        }),
      );
      const hidden = must(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'idea',
          title: 'Alpha Beta 在回收站',
          fields: { category: 'other' },
        }),
      );
      const trashed = must(core.card.delete({ requestId: req(), source: human, id: hidden.id, rev: hidden.rev }));

      const both = core.searchCards('alpha beta');
      expect(both.map((hit) => hit.card.id)).toEqual([older.id]);
      expect(both[0]?.field).toBe('title');

      const byCategory = core.searchCards('产品想法');
      expect(byCategory.map((hit) => hit.card.id)).toEqual([newer.id]);
      expect(byCategory[0]?.field).toBe('category');
      expect(byCategory[0]?.excerpt).toBe('产品想法');

      const raw = core.searchCards('gamma');
      expect(raw.map((hit) => hit.card.id)).toEqual([older.id]);
      expect(raw[0]?.field).toBe('rawInput');

      expect(core.searchCards('alpha').map((hit) => hit.card.id)).toEqual([older.id]);
      expect(core.searchCards('alpha', { deleted: 'trash' }).map((hit) => hit.card.id)).toEqual([trashed.id]);
      expect(core.searchCards('   ')).toEqual([]);

      const prefix = '前'.repeat(100);
      const suffix = '后'.repeat(100);
      const longCard = must(
        core.card.create({
          requestId: req(),
          source: human,
          cardType: 'idea',
          title: '短标题',
          body: `${prefix}关键词${suffix}`,
          fields: { category: 'other' },
        }),
      );
      const excerpt = core.searchCards('关键词', { cardType: 'idea' }).find((hit) => hit.card.id === longCard.id);
      expect(excerpt?.field).toBe('body');
      expect(Array.from(excerpt?.excerpt ?? '')).toHaveLength(120);
      expect(excerpt?.excerpt).toContain('关键词');
      expect(excerpt?.excerpt.startsWith('前'.repeat(100))).toBe(false);
    });
  });
});
