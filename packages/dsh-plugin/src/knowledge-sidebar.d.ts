export const KNOWLEDGE_PANEL_ID: string;
export const KNOWLEDGE_TAB_KIND: string;
export const KNOWLEDGE_TAB_ID: string;
export const KNOWLEDGE_ROUTE_NAME: string;
export const KNOWLEDGE_SEARCH_NAME: string;
export const KNOWLEDGE_READ_NAME: string;

export type KnowledgeTabParams = { library: string; path: string; kind: 'topic' | 'file' | ''; title: string };

export function knowledgeParams(navigation: unknown): KnowledgeTabParams;
export function knowledgeWebPath(params: Partial<KnowledgeTabParams> | null | undefined): string;
export function knowledgeFrameUrl(baseUrl: string, token: string, parentOrigin: string, embed: string, webPath: string): string;
export function knowledgeFrameName(embed: string, tabId?: string): string;
export function openKnowledgeTab(sidebarRight: unknown, params: Partial<KnowledgeTabParams>): boolean;

export type KnowledgeCardModel =
  | { kind: 'pending'; label: string }
  | { kind: 'error'; message: string }
  | { kind: 'route'; empty: boolean; items: Array<{ name: string; library: string; path: string; matched: string }> }
  | {
      kind: 'search';
      empty: boolean;
      items: Array<{ source: 'library' | 'idea'; title: string; ideaId: string; library: string; path: string; excerpt: string }>;
    }
  | { kind: 'read'; library: string; path: string; topic: boolean; title: string };

export function knowledgeToolCard(toolName: string, phase: string, args: unknown, resultText: string, isError: boolean): KnowledgeCardModel;
