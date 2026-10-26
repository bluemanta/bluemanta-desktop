import { join } from 'node:path';
import type { Core } from '@bluemanta/core';
import { KnowledgeIndex, defaultKnowledgeEnv, type IdeaDoc, type KnowledgeEnv } from '@bluemanta/knowledge';

/** Derived full-text index in the Desktop data dir (ADR 0009 decision 4); safe to delete. */
export const KNOWLEDGE_INDEX_FILE = 'knowledge-index.sqlite';

/** Active idea cards as index documents: body plus raw input (when different) and extensions. */
export function ideaDocsFrom(core: Pick<Core, 'listCards'>): IdeaDoc[] {
  return core.listCards({ cardType: 'idea', deleted: 'active' }).map((card) => {
    const extra: string[] = [];
    if (card.rawInput.status === 'present' && card.rawInput.text.trim() !== card.body.trim()) extra.push(card.rawInput.text);
    for (const extension of card.extensions) extra.push(extension.body);
    return {
      id: card.id,
      title: card.title,
      body: card.body,
      ...(extra.length > 0 ? { extraText: extra.join('\n\n') } : {}),
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };
  });
}

export type OpenKnowledgeIndexOptions = {
  dataDir: string;
  /** When given, active ideas are indexed alongside the libraries. */
  core?: Pick<Core, 'listCards'>;
  env?: KnowledgeEnv;
  refreshIntervalMs?: number;
};

export function openKnowledgeIndex(options: OpenKnowledgeIndexOptions): KnowledgeIndex {
  const core = options.core;
  return new KnowledgeIndex({
    env: options.env ?? defaultKnowledgeEnv(),
    dbPath: join(options.dataDir, KNOWLEDGE_INDEX_FILE),
    ...(core ? { ideas: () => ideaDocsFrom(core) } : {}),
    ...(options.refreshIntervalMs === undefined ? {} : { refreshIntervalMs: options.refreshIntervalMs }),
  });
}
