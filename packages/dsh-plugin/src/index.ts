import { defaultDataDir, openCore } from '@bluemanta/core';
import { cleanupStaleAttachments } from './cleanup.js';
import { COMMANDS_PATH, handleCommands } from './commands.js';
import type { HostContext } from './context.js';
import { resolveDataDir } from './data-dir.js';
import { CARDS_PATH, handleCards, handleHealth, HEALTH_PATH, type RouteCore } from './routes.js';
import { ATTACHMENT_PATH, ATTACHMENTS_PATH, handleAttachmentRead, handleAttachmentUpload } from './uploads.js';

export const name = 'bluemanta';
export const inject = ['connection'];

export type { HostContext } from './context.js';
export { cleanupStaleAttachments } from './cleanup.js';
export { COMMANDS_PATH, DESKTOP_SOURCE, handleCommands, statusForCommandCode } from './commands.js';
export type { CommandGateway, DeskCommandName } from './commands.js';
export { resolveDataDir } from './data-dir.js';
export { parseImage } from './images.js';
export { CARDS_PATH, handleCards, handleHealth, HEALTH_PATH } from './routes.js';
export type { CardsBody, ErrorBody, HealthBody, RouteCore, SearchedCard } from './routes.js';
export { ATTACHMENT_PATH, ATTACHMENTS_PATH, handleAttachmentRead, handleAttachmentUpload } from './uploads.js';

function adapt<T>(
  core: T,
  handler: (core: T, request: Request) => Response | Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handler(core, request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ error: message }, { status: 500, headers: { 'cache-control': 'no-store' } });
    }
  };
}

export function apply(ctx: HostContext): void {
  const core = openCore({ dataDir: resolveDataDir(process.env.BLUEMANTA_DATA_DIR, defaultDataDir) });
  ctx.effect(() => {
    cleanupStaleAttachments(core);
    const disposeHealth = ctx.connection.fetch.register({
      path: HEALTH_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: adapt(core, handleHealth),
    });
    const disposeCards = ctx.connection.fetch.register({
      path: CARDS_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: adapt(core satisfies RouteCore, handleCards),
    });
    const disposeCommands = ctx.connection.fetch.register({
      path: COMMANDS_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: adapt(core, handleCommands),
    });
    const disposeUploads = ctx.connection.fetch.register({
      path: ATTACHMENTS_PATH,
      methods: ['POST'],
      requestBody: 'streaming',
      fetch: adapt(core, handleAttachmentUpload),
    });
    const disposeAttachment = ctx.connection.fetch.register({
      path: ATTACHMENT_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: adapt(core, handleAttachmentRead),
    });
    return () => {
      disposeHealth();
      disposeCards();
      disposeCommands();
      disposeUploads();
      disposeAttachment();
      core.close();
    };
  }, 'bluemanta: core');
}
