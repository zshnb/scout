import { DurableObject } from 'cloudflare:workers'
import { addPlayer, apply, lobby, playerView, shuffledDeck, type Game } from './game.ts'
import { codePattern, commandSchema, seatRequest } from './protocol.ts'

interface Env { ROOMS: DurableObjectNamespace<Room> }
type Snapshot = { code: string, revision: number, game: Game, keys: string[] }
const failure = (message: string, status: number) => Response.json({ message }, { status })

async function digest(token: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('')
}
function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => alphabet[byte % 32]).join('')
}

export default {
  async fetch(req: Request, env: Env) {
    const path = new URL(req.url).pathname
    if (path === '/rooms' && req.method === 'POST') {
      const parsed = await readSeat(req)
      if (parsed instanceof Response) return parsed
      for (let i = 0; i < 4; i++) {
        const code = roomCode()
        const room = env.ROOMS.get(env.ROOMS.idFromName(code))
        const result = await room.fetch('https://room/create/' + code, {
          method: 'POST', body: JSON.stringify(parsed),
        })
        if (result.status !== 409) return result
      }
      return failure('暂时无法分配房间码，请重试', 503)
    }
    const [, prefix, code, op, ...extra] = path.split('/')
    if (prefix !== 'rooms' || !codePattern.test(code ?? '') || extra.length ||
        !((op === 'join' && req.method === 'POST') || (op === 'socket' && req.method === 'GET'))) {
      return failure('房间路径无效', 404)
    }
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req)
  },
} satisfies ExportedHandler<Env>

async function readSeat(req: Request) {
  const reader = req.body?.getReader()
  if (!reader) return failure('请填写昵称', 400)
  const decoder = new TextDecoder()
  let size = 0, body = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 1024) { await reader.cancel(); return failure('请求过长', 413) }
    body += decoder.decode(value, { stream: true })
  }
  try {
    const parsed = seatRequest.safeParse(JSON.parse(body + decoder.decode()))
    if (parsed.success) return parsed.data
  } catch { /* Invalid JSON uses the same client-facing error. */ }
  return failure('请提供 1–16 字的有效昵称', 400)
}

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY, snapshot TEXT NOT NULL)')
    const connected = ctx.getWebSockets().length
    if (connected) console.info('SCOUT restored attached sockets', connected)
  }
  private load(): Snapshot | null {
    const row = this.ctx.storage.sql.exec<{ snapshot: string }>('SELECT snapshot FROM room WHERE id = 1').toArray()[0]
    return row ? JSON.parse(row.snapshot) : null
  }
  private save(s: Snapshot) {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room (id, snapshot) VALUES (1, ?)', JSON.stringify(s))
  }
  private send(ws: WebSocket, s: Snapshot, error?: string) {
    const seat = ws.deserializeAttachment() as number
    const view = playerView(s.game, seat, s.code, s.revision)
    try {
      ws.send(JSON.stringify(error ? { type: 'error', message: error, view } : { type: 'view', view }))
    } catch { /* A disconnected seat will receive this snapshot when it reconnects. */ }
  }
  private broadcast(s: Snapshot) {
    for (const ws of this.ctx.getWebSockets()) this.send(ws, s)
  }
  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname
    if (path.endsWith('/socket')) {
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return failure('需要 WebSocket', 426)
      const auth = req.headers.get('Authorization') ?? ''
      if (!/^Bearer [a-f0-9-]{36}$/i.test(auth)) return failure('重连凭证无效', 401)
      const key = await digest(auth.slice(7))
      const state = this.load()
      const seat = state?.keys.indexOf(key) ?? -1
      if (!state || seat < 0) return failure('重连凭证无效', 401)
      const [client, server] = Object.values(new WebSocketPair())
      this.ctx.acceptWebSocket(server)
      server.serializeAttachment(seat)
      this.send(server, state)
      return new Response(null, { status: 101, webSocket: client })
    }
    const parsed = await readSeat(req)
    if (parsed instanceof Response) return parsed
    const token = parsed.token ?? crypto.randomUUID()
    const key = await digest(token)
    const create = path.startsWith('/create/')
    // No await between reading and writing: concurrent joins and moves serialize here.
    let s = this.load()
    if (create) {
      if (s) return failure('房间码已使用', 409)
      s = { code: path.split('/')[2], revision: 0, game: lobby(), keys: [] }
    }
    if (!s) return failure('找不到这个房间', 404)
    if (s.keys.includes(key)) {
      return Response.json({ code: s.code, token }, { headers: { 'Cache-Control': 'no-store' } })
    }
    try { s.game = addPlayer(s.game, parsed.name) }
    catch { return failure('房间已开局或已满', 409) }
    s.keys.push(key)
    s.revision++
    this.save(s)
    this.broadcast(s)
    return Response.json({ code: s.code, token }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  }
  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const s = this.load()!
    if (typeof raw !== 'string' || raw.length > 1024) return this.send(ws, s, '请求无效')
    let decoded: unknown
    try { decoded = JSON.parse(raw) } catch { return this.send(ws, s, '请求格式无效') }
    const msg = commandSchema.safeParse(decoded)
    if (!msg.success) return this.send(ws, s, '操作格式无效')
    if (msg.data.revision !== s.revision) return this.send(ws, s, '局面已更新，请重新确认')
    const { action } = msg.data
    const n = s.game.players.length
    const fresh = action.type === 'start' || (action.type === 'next' && n !== 2)
    try {
      s.game = apply(s.game, ws.deserializeAttachment(), action, fresh ? shuffledDeck(n, Math.random) : undefined)
    } catch (e) { return this.send(ws, s, e instanceof Error ? e.message : '非法操作') }
    s.revision++
    this.save(s)
    this.broadcast(s)
  }
  webSocketClose(ws: WebSocket, code: number, reason: string) {
    if (code === 1000 || (code >= 3000 && code <= 4999)) ws.close(code, reason)
    else ws.close()
  }
  webSocketError(ws: WebSocket) { ws.close(1011, '连接中断') }
}
