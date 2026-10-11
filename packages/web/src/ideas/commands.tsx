import type { IdeaRecord } from '@bluemanta/server/api-types';
import { useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useLocation } from 'wouter';
import { useAppNavigate } from '../app/context';
import { describeError } from '../api/client';
import {
  clearIdempotency,
  idempotencyId,
  purgeIdea,
  restoreIdea,
  starIdea,
  trashIdea,
} from '../api/writes';
import { useToast } from '../ui/Toast';
import { useIdeasState } from './IdeasState';
import { ideaIdFromPath } from './model/paths';
import { trashToastText } from './model/draft';

/** 写操作。失败时返回原因，调用方就地显示；成功返回 null。 */
export function useIdeaCommands() {
  const client = useQueryClient();
  const toast = useToast();
  const navigate = useAppNavigate();
  const [location] = useLocation();
  const { closeTab, discardSessions, bumpBaseRev } = useIdeasState();
  const busy = useRef(new Set<string>());

  const star = async (record: IdeaRecord): Promise<string | null> => {
    const scope = `star:${record.id}`;
    if (busy.current.has(scope)) return null;
    busy.current.add(scope);
    const starred = !record.starred;
    const requestId = idempotencyId(scope, JSON.stringify({ rev: record.rev, starred }));
    try {
      await starIdea(client, record.id, { requestId, rev: record.rev, starred }, (updated) => {
        bumpBaseRev(updated.id, updated.rev);
      });
      return null;
    } catch (error) {
      return describeError(error);
    } finally {
      busy.current.delete(scope);
    }
  };

  const trash = async (record: IdeaRecord): Promise<string | null> => {
    const scope = `trash:${record.id}`;
    if (busy.current.has(scope)) return null;
    busy.current.add(scope);
    const requestId = idempotencyId(scope, JSON.stringify({ rev: record.rev }));
    try {
      const next = await trashIdea(client, record.id, { requestId, rev: record.rev });
      const neighbor = closeTab(record.id);
      discardSessions([record.id]);
      if (ideaIdFromPath(location) === record.id) {
        navigate(neighbor ? `/ideas/${encodeURIComponent(neighbor)}` : '/ideas');
      }
      toast.show(trashToastText(record.title), {
        label: '撤销',
        onClick: () => {
          void restoreIdea(client, next.id, { requestId: crypto.randomUUID(), rev: next.rev }).catch((error: unknown) => {
            toast.show(`撤销失败：${describeError(error)}`);
          });
        },
      });
      return null;
    } catch (error) {
      return describeError(error);
    } finally {
      busy.current.delete(scope);
    }
  };

  const restore = async (record: IdeaRecord): Promise<string | null> => {
    const scope = `restore:${record.id}`;
    if (busy.current.has(scope)) return null;
    busy.current.add(scope);
    const requestId = idempotencyId(scope, JSON.stringify({ rev: record.rev }));
    try {
      await restoreIdea(client, record.id, { requestId, rev: record.rev });
      toast.show('已恢复');
      return null;
    } catch (error) {
      return describeError(error);
    } finally {
      busy.current.delete(scope);
    }
  };

  const purge = async (record: IdeaRecord): Promise<string | null> => {
    const scope = `purge:${record.id}`;
    if (busy.current.has(scope)) return null;
    busy.current.add(scope);
    const requestId = idempotencyId(scope, JSON.stringify({ rev: record.rev }));
    try {
      await purgeIdea(client, record.id, { requestId, rev: record.rev });
      clearIdempotency(scope);
      discardSessions([record.id]);
      closeTab(record.id);
      return null;
    } catch (error) {
      return describeError(error);
    } finally {
      busy.current.delete(scope);
    }
  };

  return { star, trash, restore, purge };
}
