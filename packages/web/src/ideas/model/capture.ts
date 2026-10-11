import type { IdeaCategory } from '@bluemanta/server/api-types';
import type { ImageSlot } from '../images/slots';

export type CaptureDraft = {
  requestId: string;
  title: string;
  body: string;
  category: IdeaCategory | null;
  slots: ImageSlot[];
  error: string | null;
};

export function emptyCapture(): CaptureDraft {
  return { requestId: crypto.randomUUID(), title: '', body: '', category: null, slots: [], error: null };
}
