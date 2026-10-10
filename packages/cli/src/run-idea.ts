import { openCore, UnsupportedSchemaError, type Core, type IdeaCategory } from '@bluemanta/core';
import { resolveDataDir } from './data-dir.js';
import {
  captureIdea,
  getIdea,
  IDEA_CATEGORY_VALUES,
  searchIdeas,
  type IdeaToolFailure,
} from './idea-tools.js';

const COMMANDS = ['add', 'search', 'get'] as const;
type CommandName = (typeof COMMANDS)[number];

export type CliFailure = {
  ok: false;
  code: string;
  message: string;
};

export type AddSuccess = {
  ok: true;
  id: string;
  title: string;
  category: string;
  duplicate: boolean;
  createdAt: string;
};

export type IdeaIo = {
  argv: readonly string[];
  stdin: string;
  env: NodeJS.ProcessEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

type ParsedArgs =
  | { ok: true; command: CommandName; dataDir?: string }
  | CliFailure;

const CATEGORIES = new Set<string>(IDEA_CATEGORY_VALUES);

/** 执行一条灵感命令。成功退出码 0，失败非 0。标准输出只有一行 JSON。 */
export function runIdea(io: IdeaIo): number {
  const args = parseArgs(io.argv);
  if (!args.ok) {
    emit(io, args);
    return 1;
  }

  const dataDir = resolveDataDir(args.dataDir, io.env);
  let core: Core | undefined;
  try {
    core = openCore({ dataDir });
    const payload = parseStdin(io.stdin);
    if (!payload.ok) {
      emit(io, payload);
      return 1;
    }
    const result = dispatch(core, args.command, payload.value);
    emit(io, result);
    return result.ok ? 0 : 1;
  } catch (error) {
    emit(io, unexpected(error));
    return 1;
  } finally {
    core?.close();
  }
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let command: CommandName | undefined;
  let dataDir: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (token === '--data-dir' || token.startsWith('--data-dir=')) {
      const value = token === '--data-dir' ? argv[index + 1] : token.slice('--data-dir='.length);
      if (token === '--data-dir') index += 1;
      if (value === undefined || value.trim() === '' || value.startsWith('--')) {
        return fail('invalid_input', '--data-dir 需要一个路径');
      }
      if (dataDir !== undefined) return fail('invalid_input', '--data-dir 只能写一次');
      dataDir = value;
      continue;
    }
    if (token.startsWith('--')) return fail('invalid_input', `未知参数 ${token}`);
    if (!isCommand(token)) return fail('invalid_input', `未知子命令 ${token}`);
    if (command !== undefined) return fail('invalid_input', '只能有一个子命令');
    command = token;
  }
  if (command === undefined) return fail('invalid_input', '需要子命令 add、search 或 get');
  return dataDir === undefined ? { ok: true, command } : { ok: true, command, dataDir };
}

function dispatch(core: Core, command: CommandName, payload: unknown): AddSuccess | CliFailure | ReturnType<typeof searchIdeas> | ReturnType<typeof getIdea> {
  if (command === 'add') return addIdea(core, payload);
  if (command === 'search') return searchIdea(core, payload);
  return readIdea(core, payload);
}

function addIdea(core: Core, payload: unknown): AddSuccess | CliFailure {
  const input = parseAdd(payload);
  if (!input.ok) return input;
  const duplicate = core.listHistory().some((entry) => entry.requestId === input.requestId);
  const captured = captureIdea(core, {
    requestId: input.requestId,
    source: { kind: 'agent', name: input.sourceName },
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.raw === undefined
      ? {}
      : { rawInput: { status: 'present', channel: 'bot', text: input.raw } }),
  });
  if (!captured.ok) return toolFailure(captured);
  const card = core.getCard(captured.id);
  if (card === null || card.cardType !== 'idea') {
    return fail('not_found', '写入后没有读到这条灵感');
  }
  if (card.title !== captured.title) {
    return fail('readback_mismatch', '写入后回读的标题与写入结果不一致');
  }
  return {
    ok: true,
    id: captured.id,
    title: captured.title,
    category: captured.category,
    duplicate,
    createdAt: card.createdAt,
  };
}

function searchIdea(core: Core, payload: unknown): ReturnType<typeof searchIdeas> | CliFailure {
  const input = parseSearch(payload);
  if (!input.ok) return input;
  const result = searchIdeas(core, input.value);
  if (!result.ok) return toolFailure(result);
  return result;
}

function readIdea(core: Core, payload: unknown): ReturnType<typeof getIdea> | CliFailure {
  const input = parseGet(payload);
  if (!input.ok) return input;
  const result = getIdea(core, { id: input.id });
  if (!result.ok) return toolFailure(result);
  return result;
}

type AddInput = {
  ok: true;
  requestId: string;
  sourceName: string;
  title?: string;
  body?: string;
  raw?: string;
  category?: IdeaCategory;
};

function parseAdd(payload: unknown): AddInput | CliFailure {
  if (!isRecord(payload)) return fail('invalid_input', '标准输入必须是 JSON 对象');
  const requestId = readString(payload, 'requestId');
  if (!requestId.ok) return requestId;
  const trimmedId = requestId.value.trim();
  if (trimmedId === '') return fail('invalid_input', 'requestId 不能为空');

  const title = readOptionalString(payload, 'title');
  if (!title.ok) return title;
  const body = readOptionalString(payload, 'body');
  if (!body.ok) return body;
  const raw = readOptionalString(payload, 'raw');
  if (!raw.ok) return raw;
  const source = readOptionalString(payload, 'source');
  if (!source.ok) return source;
  const category = readCategory(payload);
  if (!category.ok) return category;

  const sourceName = source.value === undefined || source.value.trim() === '' ? 'bot' : source.value.trim();
  return {
    ok: true,
    requestId: trimmedId,
    sourceName,
    ...(title.value === undefined ? {} : { title: title.value }),
    ...(body.value === undefined ? {} : { body: body.value }),
    ...(raw.value === undefined ? {} : { raw: raw.value }),
    ...(category.value === undefined ? {} : { category: category.value }),
  };
}

function parseSearch(payload: unknown): { ok: true; value: { query: string; limit?: number } } | CliFailure {
  if (!isRecord(payload)) return fail('invalid_input', '标准输入必须是 JSON 对象');
  const query = readString(payload, 'query');
  if (!query.ok) return query;
  if (!Object.hasOwn(payload, 'limit')) return { ok: true, value: { query: query.value } };
  const limit = payload.limit;
  if (typeof limit !== 'number') return fail('invalid_input', 'limit 需要是 1 到 50 的整数');
  return { ok: true, value: { query: query.value, limit } };
}

function parseGet(payload: unknown): { ok: true; id: string } | CliFailure {
  if (!isRecord(payload)) return fail('invalid_input', '标准输入必须是 JSON 对象');
  const id = readString(payload, 'id');
  if (!id.ok) return id;
  return { ok: true, id: id.value };
}

function readCategory(payload: Record<string, unknown>): { ok: true; value?: IdeaCategory } | CliFailure {
  if (!Object.hasOwn(payload, 'category')) return { ok: true };
  const value = payload.category;
  if (typeof value !== 'string' || !CATEGORIES.has(value)) {
    return fail('invalid_input', 'category 只能是 product、learning、work、life、other');
  }
  return { ok: true, value: value as IdeaCategory };
}

function readString(payload: Record<string, unknown>, key: string): { ok: true; value: string } | CliFailure {
  if (!Object.hasOwn(payload, key)) return fail('invalid_input', `缺少 ${key}`);
  const value = payload[key];
  if (typeof value !== 'string') return fail('invalid_input', `${key} 需要是字符串`);
  return { ok: true, value };
}

function readOptionalString(
  payload: Record<string, unknown>,
  key: string,
): { ok: true; value?: string } | CliFailure {
  if (!Object.hasOwn(payload, key)) return { ok: true };
  const value = payload[key];
  if (typeof value !== 'string') return fail('invalid_input', `${key} 需要是字符串`);
  return { ok: true, value };
}

function parseStdin(stdin: string): { ok: true; value: unknown } | CliFailure {
  const text = stdin.charCodeAt(0) === 0xfeff ? stdin.slice(1) : stdin;
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return fail('invalid_input', '标准输入不是合法 JSON');
  }
}

function toolFailure(result: IdeaToolFailure): CliFailure {
  return fail(result.code ?? 'invalid_input', result.error);
}

function unexpected(error: unknown): CliFailure {
  if (error instanceof UnsupportedSchemaError) {
    return fail(error.code, error.message);
  }
  const message = error instanceof Error && error.message !== '' ? error.message : '未能完成命令';
  return fail('internal', message);
}

function emit(io: IdeaIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value)}\n`);
}

function fail(code: string, message: string): CliFailure {
  return { ok: false, code, message };
}

function isCommand(token: string): token is CommandName {
  return (COMMANDS as readonly string[]).includes(token);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
