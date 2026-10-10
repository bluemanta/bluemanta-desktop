import type {
  Attachment,
  Card,
  CardAddExtensionInput,
  CardCreateInput,
  CardDeleteExtensionInput,
  CardRevInput,
  CardSetStarInput,
  CardUpdateInput,
  CommandErrorCode,
  CommandResult,
  PurgedCard,
  Source,
} from '@bluemanta/core';
import { removeStoredFile } from './media.js';

export const COMMANDS_PATH = '/api/bluemanta/commands';

export const DESKTOP_SOURCE: Source = { kind: 'human', name: 'desktop' };

const COMMAND_NAMES = [
  'card.create',
  'card.update',
  'card.delete',
  'card.restore',
  'card.purge',
  'card.setStar',
  'card.addExtension',
  'card.deleteExtension',
] as const;

export type DeskCommandName = (typeof COMMAND_NAMES)[number];

const COMMAND_SET = new Set<string>(COMMAND_NAMES);

export type CommandGateway = {
  dataDir: string;
  card: {
    create: (input: CardCreateInput) => CommandResult<Card>;
    update: (input: CardUpdateInput) => CommandResult<Card>;
    delete: (input: CardRevInput) => CommandResult<Card>;
    restore: (input: CardRevInput) => CommandResult<Card>;
    purge: (input: CardRevInput) => CommandResult<PurgedCard>;
    setStar: (input: CardSetStarInput) => CommandResult<Card>;
    addExtension: (input: CardAddExtensionInput) => CommandResult<Card>;
    deleteExtension: (input: CardDeleteExtensionInput) => CommandResult<Card>;
  };
  deleteUnreferencedAttachmentRecords: (ids: readonly string[]) => Attachment[];
};

const JSON_HEADERS = { 'cache-control': 'no-store' };

export function statusForCommandCode(code: CommandErrorCode): number {
  switch (code) {
    case 'invalid_input':
      return 400;
    case 'not_found':
      return 404;
    case 'version_conflict':
    case 'duplicate_request_mismatch':
      return 409;
    case 'forbidden_source':
      return 403;
  }
}

function failure(status: number, code: CommandErrorCode, message: string): Response {
  return Response.json({ ok: false, code, message }, { status, headers: JSON_HEADERS });
}

function forceDesktopSource(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;
  return { ...(input as Record<string, unknown>), source: DESKTOP_SOURCE };
}

function runCommand(core: CommandGateway, command: DeskCommandName, input: unknown): CommandResult<Card | PurgedCard> {
  switch (command) {
    case 'card.create':
      return core.card.create(input as CardCreateInput);
    case 'card.update':
      return core.card.update(input as CardUpdateInput);
    case 'card.delete':
      return core.card.delete(input as CardRevInput);
    case 'card.restore':
      return core.card.restore(input as CardRevInput);
    case 'card.purge':
      return core.card.purge(input as CardRevInput);
    case 'card.setStar':
      return core.card.setStar(input as CardSetStarInput);
    case 'card.addExtension':
      return core.card.addExtension(input as CardAddExtensionInput);
    case 'card.deleteExtension':
      return core.card.deleteExtension(input as CardDeleteExtensionInput);
  }
}

/** 彻底删除成功后，删掉不再被任何卡片引用的附件文件和记录。 */
export function discardPurgedAttachments(core: CommandGateway, ids: readonly string[]): void {
  const removed = core.deleteUnreferencedAttachmentRecords(ids);
  for (const attachment of removed) {
    removeStoredFile(core.dataDir, attachment.path);
  }
}

/**
 * `POST /api/bluemanta/commands`，请求体 `{ command, input }`。
 * 白名单之外返回 400。`source` 一律改写成桌面端的人类来源。
 */
export async function handleCommands(core: CommandGateway, request: Request): Promise<Response> {
  if (request.method !== 'POST') return failure(405, 'invalid_input', '只接受 POST');

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return failure(400, 'invalid_input', '请求体不是 JSON');
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure(400, 'invalid_input', '请求体需要是对象');
  }
  const body = payload as { command?: unknown; input?: unknown };
  if (typeof body.command !== 'string' || !COMMAND_SET.has(body.command)) {
    return failure(400, 'invalid_input', '不支持的命令');
  }
  if (body.input === null || typeof body.input !== 'object' || Array.isArray(body.input)) {
    return failure(400, 'invalid_input', 'input 需要是对象');
  }

  const command = body.command as DeskCommandName;
  const result = runCommand(core, command, forceDesktopSource(body.input));
  if (result.ok && command === 'card.purge') {
    discardPurgedAttachments(core, result.record.attachmentIds);
  }
  if (!result.ok) return failure(statusForCommandCode(result.code), result.code, result.message);
  return Response.json(result, { headers: JSON_HEADERS });
}
