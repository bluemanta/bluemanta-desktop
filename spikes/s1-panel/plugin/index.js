/**
 * S1 宿主端：在 dsh web server 上注册一个只读路由，返回 workbench 冻结数据中的灵感摘要。
 * 只读文件，不写入；只返回标题等摘要字段，不返回正文和原始输入。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'bluemanta-spike-s1-panel'
export const inject = ['webServer']

export const ROUTE = '/bluemanta/s1/ideas'

const DEFAULT_STORE = join(homedir(), 'Library', 'Application Support', 'BluemantaOPC', 'store.json')
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

function storePath() {
  return process.env.BLUEMANTA_WORKBENCH_STORE || DEFAULT_STORE
}

async function readIdeas() {
  const store = JSON.parse(await readFile(storePath(), 'utf8'))
  const ideas = store?.module_data?.['inspiration-desk']?.inspiration_desk?.data?.ideas
  if (!Array.isArray(ideas)) throw new Error('store.json 中没有找到灵感台数据')
  return ideas
    .filter(idea => !idea.deletedAt)
    .map(idea => ({
      id: idea.id,
      title: idea.title,
      category: idea.category,
      starred: Boolean(idea.starred),
      createdAt: idea.createdAt,
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    async handler(req, res) {
      const hostname = String(req.headers.host ?? '').replace(/:\d+$/, '')
      if (!LOOPBACK.has(hostname)) return send(res, 403, { error: 'loopback only' })
      if (req.method !== 'GET') return send(res, 405, { error: 'read only' })
      try {
        const ideas = await readIdeas()
        send(res, 200, { source: 'bluemanta-workbench（已冻结，只读）', count: ideas.length, ideas })
      } catch (error) {
        send(res, 500, { error: String(error?.message ?? error) })
      }
    },
  }), 'bluemanta-spike-s1-panel: ideas route')
}
