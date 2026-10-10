/**
 * S1 宿主端：在 dsh web server 上注册一个只读路由，返回 workbench 冻结数据中的灵感摘要。
 * 只读文件，不写入；只返回标题等摘要字段，不返回正文和原始输入。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'bluemanta-spike-s1-panel'
export const inject = ['connection']

export const ROUTE = '/api/bluemanta/s1/ideas'

const DEFAULT_STORE = join(homedir(), 'Library', 'Application Support', 'BluemantaOPC', 'store.json')

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

export function apply(ctx) {
  // S1b：改用 dsh 的 /api 路由注册表，自动经过 Host/Origin 校验和浏览器 cookie 认证。
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      try {
        const ideas = await readIdeas()
        return Response.json({ source: 'bluemanta-workbench（已冻结，只读）', count: ideas.length, ideas }, { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        return Response.json({ error: String(error?.message ?? error) }, { status: 500 })
      }
    },
  }), 'bluemanta-spike-s1-panel: ideas route')
}
