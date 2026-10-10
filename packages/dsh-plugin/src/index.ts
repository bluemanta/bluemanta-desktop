import { defaultDataDir, openCore } from '@bluemanta/core';
import type { HostContext } from './context.js';
import { resolveDataDir } from './data-dir.js';
import { CARDS_PATH, handleCards, handleHealth, HEALTH_PATH, type RouteCore } from './routes.js';

export const name = 'bluemanta';
export const inject = ['connection'];

export type { HostContext } from './context.js';
export { resolveDataDir } from './data-dir.js';
export { CARDS_PATH, handleCards, handleHealth, HEALTH_PATH } from './routes.js';
export type { CardsBody, ErrorBody, HealthBody, RouteCore } from './routes.js';

function adapt(
  core: RouteCore,
  handler: (core: RouteCore, request: Request) => Response,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return handler(core, request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ error: message }, { status: 500, headers: { 'cache-control': 'no-store' } });
    }
  };
}

export function apply(ctx: HostContext): void {
  const core = openCore({ dataDir: resolveDataDir(process.env.BLUEMANTA_DATA_DIR, defaultDataDir) });
  ctx.effect(() => {
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
      fetch: adapt(core, handleCards),
    });
    return () => {
      disposeHealth();
      disposeCards();
      core.close();
    };
  }, 'bluemanta: core');
}
