import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { openCore, type Core } from '@bluemanta/core';
import { defaultKnowledgeEnv, evaluate, type EvalCase, type KnowledgeEnv, type SearchHit } from '@bluemanta/knowledge';
import { resolveDataDir } from './data-dir.js';
import { openKnowledgeIndex } from './knowledge-tools.js';

export const KNOWLEDGE_EVAL_FILE = 'knowledge-eval.json';

export type RunKnowledgeIo = {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Tests inject libraries; defaults to defaultKnowledgeEnv(). */
  knowledgeEnv?: KnowledgeEnv;
};

const USAGE = `用法：knowledge <search|route|stats|eval> [参数]
  search <关键词…>   全文搜索知识库和灵感（前 10 条）
  route <问题>       按总索引的别名、关键词找候选主题
  stats              索引里每个库的文件数、段数和灵感数（会先刷新）
  eval [文件]        跑真实问题测试集，默认 <数据目录>/${KNOWLEDGE_EVAL_FILE}
选项：--data-dir <目录>  --library <库 id>（可重复）  --limit <数量>  --no-ideas  --json`;

function where(hit: SearchHit): string {
  return hit.source === 'idea' ? `灵感 ${hit.ideaId}` : `${hit.library}:${hit.path}`;
}

function printHits(hits: readonly SearchHit[], out: (text: string) => void): void {
  if (hits.length === 0) {
    out('没有找到。换个说法，或只用一两个关键词。\n');
    return;
  }
  hits.forEach((hit, i) => {
    const heading = hit.headings.length > 0 ? ` › ${hit.headings.join(' › ')}` : '';
    out(`${i + 1}. ${hit.title}${heading}  [${where(hit)}${hit.area === 'archive' ? '，归档' : ''}]\n   ${hit.excerpt}\n`);
  });
}

function readCases(path: string): EvalCase[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : (parsed as { cases?: unknown }).cases;
  if (!Array.isArray(list)) throw new Error('测试集应是数组，或 { "cases": [...] }');
  return list.map((item, i) => {
    const value = item as Partial<EvalCase>;
    if (typeof value.question !== 'string' || !Array.isArray(value.expect)) throw new Error(`第 ${i + 1} 条缺少 question 或 expect`);
    return {
      question: value.question,
      expect: value.expect.map(String),
      ...(Array.isArray(value.queries) ? { queries: value.queries.map(String) } : {}),
    };
  });
}

/** Returns the exit code: 0 ok, 1 runtime failure, 2 usage error. */
export function runKnowledge(io: RunKnowledgeIo): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...io.argv],
      allowPositionals: true,
      options: {
        'data-dir': { type: 'string' },
        library: { type: 'string', multiple: true },
        limit: { type: 'string' },
        'no-ideas': { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
    return 2;
  }
  const [command, ...rest] = parsed.positionals;
  if (parsed.values.help || command === undefined) {
    io.stdout(`${USAGE}\n`);
    return command === undefined && !parsed.values.help ? 2 : 0;
  }
  if (!['search', 'route', 'stats', 'eval'].includes(command)) {
    io.stderr(`未知命令：${command}\n${USAGE}\n`);
    return 2;
  }
  const limit = parsed.values.limit === undefined ? 10 : Number(parsed.values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    io.stderr('--limit 应是 1 到 100 的整数\n');
    return 2;
  }
  const query = rest.join(' ').trim();
  if ((command === 'search' || command === 'route') && query === '') {
    io.stderr(`${command} 需要关键词\n`);
    return 2;
  }
  const dataDir = resolveDataDir(parsed.values['data-dir'], io.env);
  const env = io.knowledgeEnv ?? defaultKnowledgeEnv();
  const json = parsed.values.json === true;
  let core: Core | undefined;
  let index: ReturnType<typeof openKnowledgeIndex> | undefined;
  try {
    if (parsed.values['no-ideas'] !== true) core = openCore({ dataDir });
    index = openKnowledgeIndex({ dataDir, env, ...(core ? { core } : {}) });
    const libraries = parsed.values.library;
    if (command === 'search') {
      const result = index.search(query, { limit, includeIdeas: core !== undefined, ...(libraries ? { libraries } : {}) });
      if (json) io.stdout(`${JSON.stringify(result)}\n`);
      else printHits(result.hits, io.stdout);
    } else if (command === 'route') {
      const candidates = index.route(query, { limit, ...(libraries ? { libraries } : {}) });
      if (json) io.stdout(`${JSON.stringify({ query, candidates })}\n`);
      else if (candidates.length === 0) io.stdout('没有匹配的主题。\n');
      else candidates.forEach((item, i) => io.stdout(`${i + 1}. ${item.name}  [${item.library}:${item.topicPath}]  命中：${item.matched.join('、')}\n`));
    } else if (command === 'stats') {
      const refreshed = index.refresh(true);
      const stats = index.stats();
      if (json) io.stdout(`${JSON.stringify({ refreshed, stats })}\n`);
      else {
        for (const library of stats.libraries) io.stdout(`${library.id}：${library.files} 个文件，${library.chunks} 段\n`);
        io.stdout(`灵感：${stats.ideas} 条\n刷新：新增 ${refreshed?.added ?? 0}，更新 ${refreshed?.updated ?? 0}，删除 ${refreshed?.removed ?? 0}\n`);
      }
    } else {
      const file = rest[0] ?? join(dataDir, KNOWLEDGE_EVAL_FILE);
      if (!existsSync(file)) {
        io.stderr(`找不到测试集：${file}\n`);
        return 1;
      }
      const report = evaluate(index, readCases(file));
      if (json) io.stdout(`${JSON.stringify(report)}\n`);
      else {
        for (const result of report.results) {
          io.stdout(`${result.found ? '✓' : '✗'} ${result.question}${result.rank ? `（第 ${result.rank} 条）` : ''}\n`);
          if (!result.found) for (const top of result.top.slice(0, 3)) io.stdout(`    前排：${top.title}  [${top.where}]\n`);
        }
        io.stdout(`前 ${report.topK} 条命中：${report.found}/${report.total}\n`);
      }
    }
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    index?.close();
    core?.close();
  }
}
