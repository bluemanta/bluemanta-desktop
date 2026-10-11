import type { IdeaCategory, IdeaRecord } from '@bluemanta/server/api-types';
import type { ImageSlot } from '../images/slots';
import { slotsFromRecord } from '../images/slots';
import { isSessionDirty } from './draft';

export type EditSession = {
  baseRev: number;
  title: string;
  body: string;
  category: IdeaCategory;
  slots: ImageSlot[];
  conflict: boolean;
  keptDraft: string | null;
  error: string | null;
  saveRequest: { hash: string; id: string } | null;
  dirty: boolean;
};

export type EditorActions = { save: () => void; cancel: () => void };

export function sessionFrom(record: IdeaRecord): EditSession {
  const slots = slotsFromRecord(record);
  return {
    baseRev: record.rev,
    title: record.title,
    body: record.body,
    category: record.category,
    slots,
    conflict: false,
    keptDraft: null,
    error: null,
    saveRequest: null,
    dirty: false,
  };
}

export function withDirty(session: EditSession, record: IdeaRecord | undefined): EditSession {
  const dirty = record
    ? isSessionDirty(record, session.slots, session)
    : session.slots.some((slot) => slot.phase !== 'ready') || session.title !== '' || session.body !== '';
  return session.dirty === dirty ? session : { ...session, dirty };
}
