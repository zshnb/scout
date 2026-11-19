import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { codeSchema, credentialsSchema, nameSchema, responseSchema, type Action, type View } from '../protocol.ts'

export type Session = { base: URL, code: string, token: string }
export const defaultServer = 'https://scout-terminal.a857681664.workers.dev'
export function serverURL(input = process.env.SCOUT_SERVER ?? defaultServer) {
  const url = new URL(input)
  if (url.protocol === 'wss:') url.protocol = 'https:'
  if (url.protocol === 'ws:') url.protocol = 'http:'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
    throw Error('远程服务器需要 HTTPS 或 WSS')
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('请填写服务器根地址')
  return url
}
export async function getSession(command: string, args: string[]): Promise<Session> {
  const base = serverURL()
  const directory = join(process.env.SCOUT_HOME ?? join(homedir(), '.scout'), createHash('sha256').update(base.origin).digest('hex'))
  const code = command === 'create' ? '' : codeSchema.parse(args[0]?.toUpperCase())
  async function readSaved() {
    let data: string
    try { data = await readFile(join(directory, code + '.json'), 'utf8') }
    catch { throw Error('此终端没有该服务器和房间的座位凭证') }
    const saved = credentialsSchema.parse(JSON.parse(data))
    if (saved.code !== code) throw Error('座位凭证与房间码不匹配')
    return { base, ...saved }
  }
  if (command === 'resume') return readSaved()
  const name = nameSchema.parse(args[command === 'create' ? 0 : 1])
  await mkdir(directory, { recursive: true, mode: 0o700 })
  async function claim(room: string, token: string) {
    const file = join(directory, room + '.json'), temp = file + '.' + randomUUID()
    try {
      await writeFile(temp, JSON.stringify({ code: room, token }), { flag: 'wx', mode: 0o600 })
      // A hard link publishes the complete credential atomically and never overwrites another terminal's claim.
      await link(temp, file)
    } finally { await rm(temp, { force: true }) }
  }
  let token: string | undefined
  if (command === 'join') {
    try { await claim(code, randomUUID()) }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
    token = (await readSaved()).token
  }
  const res = await fetch(new URL(command === 'create' ? 'rooms' : 'rooms/' + code + '/join', base), {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, token }), signal: AbortSignal.timeout(15000),
  })
  const body = await res.json() as Record<string, unknown>
  if (!res.ok) throw Error(typeof body.message === 'string' ? body.message : '入座失败')
  const saved = credentialsSchema.parse(body)
  if (command === 'create') await claim(saved.code, saved.token)
  else if (saved.code !== code || saved.token !== token) throw Error('服务器返回的座位与本机凭证不匹配')
  return { base, ...saved }
}

export function connect(session: Session, update: (v: View) => void, status: (text: string, busy: boolean) => void) {
  const url = new URL('rooms/' + session.code + '/socket', session.base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  let socket: WebSocket, retry: ReturnType<typeof setTimeout>, attempt = 0, closed = false, pending = true
  function open() {
    pending = true
    socket = new WebSocket(url, { headers: { Authorization: 'Bearer ' + session.token }, handshakeTimeout: 10000 })
    socket.on('message', data => {
      if (closed) return
      try {
        const msg = responseSchema.parse(JSON.parse(data.toString()))
        if (msg.view.code !== session.code) throw Error('房间码不符')
        attempt = 0; pending = false
        update(msg.view)
        status(msg.type === 'error' ? msg.message : '', false)
      } catch {
        closed = true; status('服务器牌面格式不兼容，请检查客户端版本', true); socket.close()
      }
    })
    socket.on('unexpected-response', (_req, res) => {
      res.resume()
      if ([401, 403, 404].includes(res.statusCode ?? 0)) {
        closed = true; status('无法恢复座位，请检查服务器、房间码和凭证', true)
      }
      socket.terminate()
    })
    socket.on('error', () => { /* close drives reconnection */ })
    socket.on('close', () => {
      if (closed) return
      pending = true; status('连接中断，正在恢复座位…', true)
      retry = setTimeout(open, Math.min(8000, 300 * 2 ** Math.min(attempt++, 5)))
    })
  }
  open()
  return { submit(action: Action, revision: number) {
    if (pending || socket.readyState !== WebSocket.OPEN) return
    pending = true; status('等待服务器确认…', true)
    socket.send(JSON.stringify({ action, revision }), err => { if (err) socket.terminate() })
  }, close() {
    closed = true; clearTimeout(retry); socket.terminate()
  } }
}
