export const IDEA_TAB_KIND: 'bluemanta.idea';

export const IDEA_TAB_ID: '@bluemanta/dsh-plugin/idea';

export const IDEA_CAPTURE_NAME: 'bluemanta_idea_capture';

export const IDEA_SEARCH_NAME: 'bluemanta_idea_search';

export const IDEA_GET_NAME: 'bluemanta_idea_get';

export interface IdeaNavParams {
  id: string;
  title: string;
}

export function ideaParams(navigation: { params?: unknown } | null | undefined): IdeaNavParams;

export interface SidebarMounted {
  getSnapshot?: () => unknown;
  subscribe?: (listener: () => void) => (() => void) | void;
}

export interface SidebarRightLike {
  mounted?: SidebarMounted | null;
  openTab?: (kind: string, options: { params: { id: string; title?: string } }) => void;
}

export function sidebarIsMounted(sidebarRight: SidebarRightLike | null | undefined): boolean;

export function subscribeSidebarMounted(
  sidebarRight: SidebarRightLike | null | undefined,
  listener: () => void,
): () => void;

export function openIdeaTab(
  sidebarRight: SidebarRightLike | null | undefined,
  params: { id?: string; title?: string } | null | undefined,
): boolean;

export function parseToolArgs(raw: unknown): Record<string, unknown> | null;

export function toolResultText(block: { content?: unknown } | null | undefined): string;

export interface IdeaSearchCardItem {
  id: string;
  title: string;
  category: string;
  date: string;
  excerpt: string;
}

export type IdeaToolCardModel =
  | { kind: 'pending'; label: string }
  | { kind: 'error'; message: string }
  | { kind: 'capture'; title: string; category: string; id: string }
  | { kind: 'search'; items: IdeaSearchCardItem[]; empty: boolean }
  | { kind: 'get'; id: string; title: string; excerpt: string };

export function ideaToolCard(
  toolName: string,
  phase: string,
  args: Record<string, unknown> | null,
  resultText: string,
  isError: boolean,
): IdeaToolCardModel;

export interface RailOpenTab {
  sessionId?: string;
  tabId?: string;
}

export function tabIsOpen(
  openTabs: readonly RailOpenTab[] | null | undefined,
  sessionId: string,
  tabId: string,
): boolean;

export type RailOpenPlan = { action: 'focus'; tabId: string } | { action: 'open' };

export function planRailOpen(
  knownTabId: string,
  openTabs: readonly RailOpenTab[] | null | undefined,
  sessionId: string,
): RailOpenPlan;

export type RailClaimPlan = { action: 'focus-existing'; tabId: string } | { action: 'keep'; tabId: string };

export function planRailClaim(
  knownTabId: string,
  openTabs: readonly RailOpenTab[] | null | undefined,
  sessionId: string,
  tabId: string,
): RailClaimPlan;

export function planRailClose(
  entry: { dirty?: boolean; allow?: boolean } | null | undefined,
): 'allow' | 'confirm';
