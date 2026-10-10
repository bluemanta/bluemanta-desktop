export const LIST_WIDTH_DEFAULT: 380;

export const LIST_WIDTH_MIN: 280;

export const LIST_WIDTH_RATIO: 0.6;

export const LIST_WIDTH_KEY: 'bluemanta.ideas.listWidth';

export const TAB_LIMIT: 8;

export const CREATE_TAB_ID: 'create';

export const TAB_LIMIT_MESSAGE: string;

export function clampListWidth(preferred: number, appWidth: number): number;

export interface WidthStorage {
  getItem?(key: string): string | null;
  setItem?(key: string, value: string): void;
}

export function readStoredListWidth(storage: WidthStorage | null | undefined): number;

export function writeStoredListWidth(storage: WidthStorage | null | undefined, width: number): void;

export interface IdeaTab {
  id: string;
  kind: 'create' | 'detail';
  dirty: boolean;
  openedAt: number;
  generation: number;
}

export interface OpenTabRequest {
  id: string;
  kind: 'create' | 'detail';
  openedAt: number;
}

export interface OpenTabPlan {
  tabs: IdeaTab[];
  activeId: string | null;
  blocked: boolean;
  droppedId: string | null;
}

export interface CloseTabPlan {
  tabs: IdeaTab[];
  activeId: string | null;
}

export function planOpenTab(tabs: readonly IdeaTab[], request: OpenTabRequest): OpenTabPlan;

export function planCloseTab(tabs: readonly IdeaTab[], activeId: string | null, id: string): CloseTabPlan;

export function planReplaceCreate(tabs: readonly IdeaTab[], activeId: string | null, cardId: string): CloseTabPlan;
