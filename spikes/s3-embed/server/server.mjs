#!/usr/bin/env node
/**
 * S3 来源 A：独立的本地服务。只监听 127.0.0.1，校验 Host 头，接口要求口令头。
 * 环境变量：S3_PORT（默认 4390）、S3_TOKEN（必填）、S3_DATA_DIR（必填，临时目录）。
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openIdeas } from '../shared/ideas-api.mjs'

const port = Number(process.env.S3_PORT || 4390)
const token = process.env.S3_TOKEN || ''
const dataDir = process.env.S3_DATA_DIR || ''
if (!token || !dataDir) {
  console.error('需要 S3_TOKEN 和 S3_DATA_DIR')
  process.exit(1)
}
const page = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'index.html')
const ideas = openIdeas(dataDir, 's3-web-a')
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])

const server = createServer(async (req, res) => {
  const send = (status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body)
  }
  if (!allowedHosts.has(req.headers.host || '')) return send(403, { error: 'host 不允许' })
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return send(200, await readFile(page, 'utf8'), 'text/html; charset=utf-8')
  }
  if (url.pathname === '/api/ideas') {
    if (req.headers['x-bluemanta-token'] !== token) return send(401, { error: '口令不对' })
    const readBody = () => new Promise((resolve, reject) => {
      let text = ''
      req.setEncoding('utf8')
      req.on('data', chunk => { text += chunk })
      req.on('end', () => resolve(text))
      req.on('error', reject)
    })
    const [status, body] = await ideas.handle(req.method || 'GET', url, readBody)
    return send(status, body)
  }
  return send(404, { error: 'not found' })
})

server.listen(port, '127.0.0.1', () => console.log(`s3 server: http://127.0.0.1:${port}/?token=${token}`))
const stop = () => { server.close(); ideas.close(); process.exit(0) }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
