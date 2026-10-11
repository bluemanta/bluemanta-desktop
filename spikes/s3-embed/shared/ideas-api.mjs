/**
 * S3：A、B 两种来源共用的灵感接口。直接复用仓库里已构建的 core 和 T6/T7 的工具函数，不另写业务规则。
 * 只用于技术验证，数据目录由调用方指定（一律是临时目录）。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const { openCore } = await import(join(repo, 'packages/core/dist/index.js'))
const tools = await import(join(repo, 'packages/cli/dist/idea-tools.js'))

export function openIdeas(dataDir, sourceName) {
  const core = openCore({ dataDir })
  return {
    close: () => core.close(),
    /** GET ?q= 列表 / ?id= 详情；POST { title, body?, requestId } 记录 */
    async handle(method, url, readBody) {
      if (method === 'GET') {
        const id = url.searchParams.get('id')
        if (id) {
          const result = tools.getIdea(core, { id })
          return result.ok ? [200, result] : [404, { error: result.error }]
        }
        const query = url.searchParams.get('q') || ''
        if (query.trim()) {
          const result = tools.searchIdeas(core, { query, limit: 50 })
          return result.ok ? [200, { count: result.count, items: result.items }] : [400, { error: result.error }]
        }
        const cards = core.listCards({ cardType: 'idea', deleted: 'active' })
        const items = cards.map(card => ({
          id: card.id, title: card.title, category: card.fields?.category ?? '', createdAt: card.createdAt.slice(0, 10),
        }))
        return [200, { count: items.length, items }]
      }
      if (method === 'POST') {
        let input
        try { input = JSON.parse(await readBody()) } catch { return [400, { error: '请求体不是 JSON' }] }
        const result = tools.captureIdea(core, {
          requestId: String(input.requestId || ''),
          source: { kind: 'agent', name: sourceName },
          title: String(input.title || ''),
          ...(input.body ? { body: String(input.body) } : {}),
        })
        return result.ok ? [200, result] : [400, { error: result.error }]
      }
      return [405, { error: '不支持的方法' }]
    },
  }
}
