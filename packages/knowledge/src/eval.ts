import type { KnowledgeIndex, SearchHit } from './search-index.js';
import { extractKeywords } from './text.js';

/**
 * One real question from the user (phase-3 acceptance). Stored only on the user's machine.
 * `expect` lists what counts as found: a library path fragment, an idea id, or a phrase from the text.
 */
export interface EvalCase {
  question: string;
  expect: string[];
  /** Keyword variants an agent would try; defaults to the question itself plus extracted keywords. */
  queries?: string[];
}

export interface EvalCaseResult {
  question: string;
  queries: string[];
  found: boolean;
  /** 1-based rank of the first matching hit within the top K, or null. */
  rank: number | null;
  top: Array<{ title: string; where: string; excerpt: string }>;
}

export interface EvalReport {
  total: number;
  found: number;
  topK: number;
  results: EvalCaseResult[];
}

function matches(index: KnowledgeIndex, hit: SearchHit, expect: readonly string[]): boolean {
  const body = (index.chunkText(hit.chunkId) ?? '').toLowerCase();
  const haystack = `${hit.title}\n${hit.headings.join('\n')}\n${body}`.toLowerCase();
  return expect.some((raw) => {
    const needle = raw.trim().toLowerCase();
    if (needle === '') return false;
    if (hit.ideaId !== null && hit.ideaId.toLowerCase() === needle) return true;
    if (hit.path !== null && hit.path.toLowerCase().includes(needle)) return true;
    return haystack.includes(needle);
  });
}

/** Runs each question the way an agent would (as typed, then as keywords) and checks the merged top K. */
export function evaluate(index: KnowledgeIndex, cases: readonly EvalCase[], topK = 5): EvalReport {
  const results = cases.map((item): EvalCaseResult => {
    const queries = [...new Set((item.queries ?? [item.question, extractKeywords(item.question).join(' ')]).map((query) => query.trim()).filter((query) => query !== ''))];
    const merged = new Map<number, SearchHit>();
    for (const query of queries) {
      for (const hit of index.search(query, { limit: 10 }).hits) {
        const previous = merged.get(hit.chunkId);
        if (!previous || previous.score < hit.score) merged.set(hit.chunkId, hit);
      }
    }
    const top = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, topK);
    const position = top.findIndex((hit) => matches(index, hit, item.expect));
    return {
      question: item.question,
      queries,
      found: position >= 0,
      rank: position >= 0 ? position + 1 : null,
      top: top.map((hit) => ({
        title: hit.title,
        where: hit.source === 'idea' ? `灵感 ${hit.ideaId}` : `${hit.library}:${hit.path}`,
        excerpt: hit.excerpt,
      })),
    };
  });
  return { total: results.length, found: results.filter((result) => result.found).length, topK, results };
}
