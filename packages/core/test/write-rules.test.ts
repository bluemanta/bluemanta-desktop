import { describe, expect, it } from 'vitest';
import { openCore } from '../src/index.js';
import { agent, human, idea, must, removeDir, req, tempDir, withCore } from './helpers.js';

describe('写入规则', () => {
  it('相同 requestId 且内容相同（含字段顺序不同）返回首次结果，且不重复写历史', () => {
    const dir = tempDir();
    const core = openCore({ dataDir: dir });
    try {
      const requestId = 'same-request';
      const first = must(
        core.project.create({
          requestId,
          source: human,
          title: '甲',
          area: 'content',
        }),
      );
      const replay = core.project.create({
        area: 'content',
        title: '甲',
        source: { name: human.name, kind: human.kind },
        requestId,
      });
      expect(replay).toEqual({ ok: true, record: first });
      expect(core.listHistory()).toHaveLength(1);
      core.close();

      const reopened = openCore({ dataDir: dir });
      try {
        const afterRestart = reopened.project.create({
          requestId,
          source: human,
          title: '甲',
          area: 'content',
        });
        expect(afterRestart).toEqual({ ok: true, record: first });
        expect(reopened.listHistory()).toHaveLength(1);
      } finally {
        reopened.close();
      }
    } finally {
      try {
        core.close();
      } catch {
        // 成功路径里已经关闭过一次。
      }
      removeDir(dir);
    }
  });

  it('相同 requestId 但内容不同时拒绝，且不改数据、不写历史', () => {
    withCore((core) => {
      const created = must(
        core.project.create({ requestId: 'fixed', source: human, title: '甲', area: 'work' }),
      );
      const before = core.listHistory();
      const mismatch = core.project.create({
        requestId: 'fixed',
        source: human,
        title: '乙',
        area: 'work',
      });
      expect(mismatch).toMatchObject({ ok: false, code: 'duplicate_request_mismatch' });
      expect(core.getProject(created.id)?.title).toBe('甲');
      expect(core.listHistory()).toEqual(before);
    });
  });

  it('版本冲突拒绝且不改数据、不写历史；失败后同一 requestId 可以改对再成功', () => {
    withCore((core) => {
      const created = must(core.project.create({ requestId: req(), source: human, title: '旧标题', area: 'product' }));
      const updated = must(
        core.project.update({
          requestId: req(),
          source: human,
          id: created.id,
          rev: created.rev,
          title: '新标题',
        }),
      );
      const before = core.getProject(created.id);
      const history = core.listHistory();
      const conflict = core.project.update({
        requestId: 'retry-me',
        source: human,
        id: created.id,
        rev: created.rev,
        title: '被拒绝的标题',
      });
      expect(conflict).toMatchObject({ ok: false, code: 'version_conflict' });
      expect(core.getProject(created.id)).toEqual(before);
      expect(core.listHistory()).toEqual(history);
      expect(updated.rev).toBe(2);

      const retried = must(
        core.project.update({
          requestId: 'retry-me',
          source: human,
          id: created.id,
          rev: updated.rev,
          title: '重试成功',
        }),
      );
      expect(retried.title).toBe('重试成功');
      expect(retried.rev).toBe(3);
    });
  });

  it('agent 不能收藏或彻底删除，可以新建', () => {
    withCore((core) => {
      const card = must(core.card.create(idea({ source: agent, title: '代理记下的' })));
      const task = must(core.task.create({ requestId: req(), source: agent, title: '代理任务' }));
      const beforeCard = core.getCard(card.id);
      const beforeTask = core.getTask(task.id);
      const history = core.listHistory();

      expect(
        core.card.setStar({ requestId: req(), source: agent, id: card.id, rev: card.rev, starred: true }),
      ).toMatchObject({ ok: false, code: 'forbidden_source' });
      expect(core.card.purge({ requestId: req(), source: agent, id: card.id, rev: card.rev })).toMatchObject({
        ok: false,
        code: 'forbidden_source',
      });
      expect(core.task.purge({ requestId: req(), source: agent, id: task.id, rev: task.rev })).toMatchObject({
        ok: false,
        code: 'forbidden_source',
      });
      expect(core.card.create(idea({ source: agent, starred: true }))).toMatchObject({
        ok: false,
        code: 'forbidden_source',
      });

      expect(core.getCard(card.id)).toEqual(beforeCard);
      expect(core.getTask(task.id)).toEqual(beforeTask);
      expect(core.listHistory()).toEqual(history);
    });
  });

  it('软删除后默认列表不含、回收站含，按 id 仍能读到；恢复后回到默认列表', () => {
    withCore((core) => {
      const card = must(core.card.create(idea()));
      const task = must(core.task.create({ requestId: req(), source: human, title: '待删任务' }));

      const deletedCard = must(core.card.delete({ requestId: req(), source: human, id: card.id, rev: card.rev }));
      const deletedTask = must(core.task.delete({ requestId: req(), source: human, id: task.id, rev: task.rev }));
      expect(deletedCard.deletedAt).toEqual(expect.any(String));
      expect(core.listCards().map((item) => item.id)).not.toContain(card.id);
      expect(core.listCards({ deleted: 'trash' }).map((item) => item.id)).toContain(card.id);
      expect(core.getCard(card.id)?.deletedAt).toBe(deletedCard.deletedAt);
      expect(core.listTasks().map((item) => item.id)).not.toContain(task.id);
      expect(core.listTasks({ deleted: 'trash' }).map((item) => item.id)).toContain(task.id);

      const restored = must(
        core.card.restore({ requestId: req(), source: human, id: card.id, rev: deletedCard.rev }),
      );
      expect(restored.deletedAt).toBeNull();
      expect(core.listCards().map((item) => item.id)).toContain(card.id);
      expect(core.listCards({ deleted: 'trash' }).map((item) => item.id)).not.toContain(card.id);
      const restoredTask = must(
        core.task.restore({ requestId: req(), source: human, id: task.id, rev: deletedTask.rev }),
      );
      expect(restoredTask.deletedAt).toBeNull();
      expect(core.listTasks().map((item) => item.id)).toContain(task.id);
    });
  });

  it('彻底删除级联删除 links 和追记', () => {
    withCore((core) => {
      const card = must(core.card.create(idea({ title: '要删的卡' })));
      const task = must(core.task.create({ requestId: req(), source: human, title: '关联任务' }));
      const forward = must(
        core.link.create({ requestId: req(), source: human, from: card.id, to: task.id, rel: 'related' }),
      );
      const backward = must(
        core.link.create({ requestId: req(), source: human, from: task.id, to: card.id, rel: 'material' }),
      );
      const withNote = must(
        core.card.addExtension({ requestId: req(), source: human, id: card.id, rev: card.rev, body: '还没想完' }),
      );
      expect(withNote.extensions).toHaveLength(1);
      const soft = must(
        core.link.create({ requestId: req(), source: human, from: card.id, to: task.id, rel: 'related' }),
      );
      const softDeleted = must(core.link.delete({ requestId: req(), source: human, id: soft.id, rev: soft.rev }));
      expect(softDeleted.deletedAt).not.toBeNull();

      const cardTrashed = must(
        core.card.delete({ requestId: req(), source: human, id: card.id, rev: withNote.rev }),
      );
      const purged = must(core.card.purge({ requestId: req(), source: human, id: card.id, rev: cardTrashed.rev }));
      expect(purged).toEqual({ id: card.id, attachmentIds: [] });
      expect(core.getCard(card.id)).toBeNull();
      expect(core.getLink(forward.id)).toBeNull();
      expect(core.getLink(backward.id)).toBeNull();
      expect(core.getLink(soft.id)).toBeNull();
      expect(core.listLinks({ deleted: 'all' })).toEqual([]);
      expect(core.getTask(task.id)?.id).toBe(task.id);

      const another = must(
        core.link.create({ requestId: req(), source: human, from: task.id, to: task.id, rel: 'related' }),
      );
      const taskTrashed = must(core.task.delete({ requestId: req(), source: human, id: task.id, rev: task.rev }));
      must(core.task.purge({ requestId: req(), source: human, id: task.id, rev: taskTrashed.rev }));
      expect(core.getTask(task.id)).toBeNull();
      expect(core.getLink(another.id)).toBeNull();
    });
  });

  it('每条成功命令写一条历史，失败命令不写', () => {
    withCore((core) => {
      const project = must(core.project.create({ requestId: req(), source: human, title: '项目', area: 'work' }));
      const projectUpdated = must(
        core.project.update({
          requestId: req(),
          source: human,
          id: project.id,
          rev: project.rev,
          background: '背景',
        }),
      );
      const projectStatus = must(
        core.project.setStatus({
          requestId: req(),
          source: human,
          id: project.id,
          rev: projectUpdated.rev,
          status: 'paused',
        }),
      );
      const task = must(
        core.task.create({ requestId: req(), source: human, title: '任务', projectId: project.id }),
      );
      const taskUpdated = must(
        core.task.update({ requestId: req(), source: human, id: task.id, rev: task.rev, notes: '说明' }),
      );
      const taskStatus = must(
        core.task.setStatus({
          requestId: req(),
          source: human,
          id: task.id,
          rev: taskUpdated.rev,
          status: 'doing',
        }),
      );
      const card = must(core.card.create(idea({ projectId: project.id })));
      const cardUpdated = must(
        core.card.update({ requestId: req(), source: human, id: card.id, rev: card.rev, body: '整理后' }),
      );
      const withExt = must(
        core.card.addExtension({
          requestId: req(),
          source: human,
          id: card.id,
          rev: cardUpdated.rev,
          body: '追记一条',
        }),
      );
      const extensionId = withExt.extensions[0]?.id;
      expect(extensionId).toEqual(expect.any(String));
      const withoutExt = must(
        core.card.deleteExtension({
          requestId: req(),
          source: human,
          id: card.id,
          rev: withExt.rev,
          extensionId: extensionId ?? '',
        }),
      );
      const starred = must(
        core.card.setStar({ requestId: req(), source: human, id: card.id, rev: withoutExt.rev, starred: true }),
      );
      const link = must(
        core.link.create({ requestId: req(), source: human, from: card.id, to: task.id, rel: 'related' }),
      );
      must(core.link.delete({ requestId: req(), source: human, id: link.id, rev: link.rev }));
      const cardDeleted = must(
        core.card.delete({ requestId: req(), source: human, id: card.id, rev: starred.rev }),
      );
      const cardRestored = must(
        core.card.restore({ requestId: req(), source: human, id: card.id, rev: cardDeleted.rev }),
      );
      const taskDeleted = must(
        core.task.delete({ requestId: req(), source: human, id: task.id, rev: taskStatus.rev }),
      );
      const taskRestored = must(
        core.task.restore({ requestId: req(), source: human, id: task.id, rev: taskDeleted.rev }),
      );
      const linkAgain = must(
        core.link.create({ requestId: req(), source: human, from: card.id, to: task.id, rel: 'related' }),
      );
      const noted = must(
        core.card.addExtension({
          requestId: req(),
          source: human,
          id: card.id,
          rev: cardRestored.rev,
          body: '删除前的追记',
        }),
      );
      const cardTrashed = must(core.card.delete({ requestId: req(), source: human, id: card.id, rev: noted.rev }));
      must(core.card.purge({ requestId: req(), source: human, id: card.id, rev: cardTrashed.rev }));
      const taskTrashed = must(
        core.task.delete({ requestId: req(), source: human, id: task.id, rev: taskRestored.rev }),
      );
      must(core.task.purge({ requestId: req(), source: human, id: task.id, rev: taskTrashed.rev }));

      expect(core.listHistory()[0]).toMatchObject({ command: 'project.create', revBefore: null, revAfter: 1 });
      const commands = core.listHistory().map((entry) => entry.command);
      expect(commands).toEqual([
        'project.create',
        'project.update',
        'project.setStatus',
        'task.create',
        'task.update',
        'task.setStatus',
        'card.create',
        'card.update',
        'card.addExtension',
        'card.deleteExtension',
        'card.setStar',
        'link.create',
        'link.delete',
        'card.delete',
        'card.restore',
        'task.delete',
        'task.restore',
        'link.create',
        'card.addExtension',
        'card.delete',
        'card.purge',
        'task.delete',
        'task.purge',
      ]);
      expect(core.getLink(linkAgain.id)).toBeNull();
      expect(core.listHistory().find((entry) => entry.command === 'card.purge')).toMatchObject({
        objectId: card.id,
        revAfter: null,
      });

      const historyBeforeFailure = core.listHistory();
      expect(core.project.create({ requestId: req(), source: human, title: '', area: 'work' })).toMatchObject({
        ok: false,
        code: 'invalid_input',
      });
      expect(core.task.update({ requestId: req(), source: human, id: 'task_missing', rev: 1, title: '无' })).toMatchObject({
        ok: false,
        code: 'not_found',
      });
      expect(core.listHistory()).toEqual(historyBeforeFailure);
      expect(projectStatus.status).toBe('paused');
      expect(core.getProject(project.id)?.status).toBe('paused');
    });
  });

  it('卡片标题、正文、追记有长度上限，按字数而不是字节数', () => {
    withCore((core) => {
      const title = '想'.repeat(80);
      const card = must(core.card.create(idea({ title, body: '正'.repeat(8000) })));
      expect(card.title).toBe(title);
      expect(card.body).toHaveLength(8000);
      const noted = must(
        core.card.addExtension({
          requestId: req(),
          source: human,
          id: card.id,
          rev: card.rev,
          body: '追'.repeat(8000),
        }),
      );
      expect(noted.extensions[0]?.body).toHaveLength(8000);

      const history = core.listHistory();
      expect(core.card.create(idea({ title: '想'.repeat(81) }))).toMatchObject({ ok: false, code: 'invalid_input' });
      expect(core.card.create(idea({ body: '正'.repeat(8001) }))).toMatchObject({ ok: false, code: 'invalid_input' });
      expect(
        core.card.update({
          requestId: req(),
          source: human,
          id: card.id,
          rev: noted.rev,
          body: '正'.repeat(8001),
        }),
      ).toMatchObject({ ok: false, code: 'invalid_input' });
      expect(
        core.card.addExtension({
          requestId: req(),
          source: human,
          id: card.id,
          rev: noted.rev,
          body: '追'.repeat(8001),
        }),
      ).toMatchObject({ ok: false, code: 'invalid_input' });
      expect(core.listHistory()).toEqual(history);
      expect(core.getCard(card.id)?.body).toHaveLength(8000);
    });
  });

  it('未知领域 id 被拒绝', () => {
    withCore((core) => {
      expect(core.project.create({ requestId: req(), source: human, title: '越界', area: 'secret' })).toMatchObject({
        ok: false,
        code: 'invalid_input',
      });
      const project = must(core.project.create({ requestId: req(), source: human, title: '产品', area: 'product' }));
      const history = core.listHistory();
      expect(
        core.project.update({
          requestId: req(),
          source: human,
          id: project.id,
          rev: project.rev,
          area: 'nope',
        }),
      ).toMatchObject({ ok: false, code: 'invalid_input' });
      expect(core.getProject(project.id)?.area).toBe('product');
      expect(core.listProjects()).toHaveLength(1);
      expect(core.listHistory()).toEqual(history);
    });
  });
});
