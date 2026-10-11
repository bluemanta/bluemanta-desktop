/**
 * S3 宿主端：
 * - 来源 B：在 dsh 鉴权路由上托管网页（/api/bluemanta/s3/app）和接口（/api/bluemanta/s3/ideas）；
 * - 来源 A：插件激活时拉起独立本地服务（server/server.mjs），停用时关掉，验证"本地服务由谁启动"；
 * - /api/bluemanta/s3/config 把 A 的地址和口令交给浏览器端（经 dsh 鉴权，不外泄）。
 * 数据目录：S3_DATA_DIR，未设置时用 spikes/s3-embed/.data（gitignore）。
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'bluemanta-spike-s3-embed'
export const inject = ['connection']

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const A_PORT = Number(process.env.S3_PORT || 4390)

export function apply(ctx) {
  // Desktop 从访达启动时没有自定义环境变量，回退到验证目录自己的 .data（已被 gitignore），绝不碰真实数据
  const dataDir = process.env.S3_DATA_DIR || join(root, '.data')
  const token = randomBytes(16).toString('hex')
  const status = { a: 'starting', aError: '' }

  // 来源 A：子进程。Desktop 的宿主可能跑在 Electron 里，带上 ELECTRON_RUN_AS_NODE 让它按 Node 执行。
  ctx.effect(() => {
    const child = spawn(process.execPath, [join(root, 'server', 'server.mjs')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', S3_PORT: String(A_PORT), S3_TOKEN: token, S3_DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', d => { if (String(d).includes('s3 server:')) status.a = 'running' })
    child.stderr.on('data', d => { status.aError += String(d) })
    child.on('exit', code => { status.a = `exited ${code}` })
    return () => { child.kill('SIGTERM') }
  }, 's3: local server')

  // 来源 B：数据接口与网页都经 dsh 鉴权
  let ideasPromise
  const ideas = () => (ideasPromise ??= import(join(root, 'shared', 'ideas-api.mjs')).then(m => m.openIdeas(dataDir, 's3-web-b')))
  ctx.effect(() => () => { ideasPromise?.then(api => api.close()) }, 's3: close core')

  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/bluemanta/s3/app',
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      const html = await readFile(join(root, 'web', 'index.html'), 'utf8')
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
    },
  }), 's3: app route')

  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/bluemanta/s3/ideas',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const api = await ideas()
      const [code, body] = await api.handle(request.method, new URL(request.url), () => request.text())
      return Response.json(body, { status: code, headers: { 'cache-control': 'no-store' } })
    },
  }), 's3: ideas route')

  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/bluemanta/s3/config',
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      return Response.json({ aUrl: `http://127.0.0.1:${A_PORT}/?token=${token}`, status }, { headers: { 'cache-control': 'no-store' } })
    },
  }), 's3: config route')
}
