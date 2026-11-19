import assert from 'node:assert/strict'
import { once, on } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import WebSocket from 'ws'
import { possibleShow, previewPick } from '../src/game.ts'
import { serverURL } from '../src/client/session.ts'
import { credentialsSchema, responseSchema, type Action, type View } from '../src/protocol.ts'

const base = serverURL(process.env.SCOUT_SERVER ?? 'http://127.0.0.1:8787')
async function seat(code?: string) {
  const res = await fetch(new URL(code ? 'rooms/' + code + '/join' : 'rooms', base), {
    method: 'POST', body: JSON.stringify({ name: '测试玩家' + (code ? '乙' : '甲') }),
    redirect: 'error', signal: AbortSignal.timeout(15000),
  })
  assert.equal(res.status, 201)
  return credentialsSchema.parse(await res.json())
}
type Seat = Awaited<ReturnType<typeof seat>>
async function open(saved: Seat) {
  const url = new URL('rooms/' + saved.code + '/socket', base)
  url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(url, { headers: { Authorization: 'Bearer ' + saved.token }, handshakeTimeout: 15000 })
  const frames = on(ws, 'message')
  await once(ws, 'open')
  return { ws, next: async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const item = await Promise.race([frames.next(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('等待牌面超时')), 18000)
      })])
      const raw = JSON.parse(item.value![0].toString())
      const parsed = responseSchema.parse(raw)
      // The schema strips extra fields. Comparing raw frames catches accidental private data on the wire.
      assert.deepEqual(raw, parsed)
      return parsed
    } finally { clearTimeout(timer) }
  } }
}
async function match(n: number, idleMs: number) {
  const host = await seat(), seats = [host]
  for (let i=1; i<n; i++) seats.push(await seat(host.code))
  const clients = await Promise.all(seats.map(open))
  let views = await Promise.all(clients.map(async c => (await c.next()).view))
  let reconnected = false, combo = false, scout = false
  const totals = Array<number>(n).fill(0)
  function common() {
    for (const [i,v] of views.entries()) {
      assert.equal(v.me, i)
      assert.equal(v.hand.length, v.players[i].count)
      const { hand, me, ...shared } = v
      const { hand: _, me: __, ...other } = views[0]
      assert.deepEqual(shared, other)
    }
    const cards = views.flatMap(v => v.hand).map(([a,b]) => Math.min(a,b)*11 + Math.max(a,b))
    assert.equal(new Set(cards).size, cards.length)
  }
  async function send(i: number, action: Action, drop = false) {
    const { revision } = views[i]
    const msg = JSON.stringify({ revision, action })
    clients[i].ws.send(msg)
    if (drop) {
      // Do not consume the confirmation. Another seat observes the committed move.
      clients[i].ws.close()
      const others = await Promise.all(clients.map(async (c,j) => j === i ? null : (await c.next()).view))
      clients[i] = await open(seats[i])
      const restored = (await clients[i].next()).view
      views = others.map(v => v ?? restored)
      clients[i].ws.send(msg)
      const duplicate = await clients[i].next()
      assert.equal(duplicate.type, 'error')
      assert.deepEqual(duplicate.view, restored)
      reconnected = true
    } else {
      views = await Promise.all(clients.map(async c => {
        const m = await c.next()
        assert.equal(m.type, 'view', m.type === 'error' ? m.message : undefined)
        return m.view
      }))
    }
    assert.equal(views[0].revision, revision + 1)
    common()
  }
  try {
    common()
    clients[1].ws.send(JSON.stringify({ revision: views[1].revision, action: { type:'start' } }))
    const denied = await clients[1].next()
    assert.equal(denied.type,'error')
    assert.deepEqual(denied.view, views[1])
    await send(0, { type:'start' })
    const retry = await fetch(new URL('rooms/' + host.code + '/join', base), {
      method: 'POST', body: JSON.stringify({ name:'测试玩家乙', token:seats[1].token }),
      redirect:'error', signal:AbortSignal.timeout(15000),
    })
    assert.equal(retry.status,200)
    assert.deepEqual(await retry.json(),seats[1])
    for (let turns=0; turns<2000; turns++) {
      const v: View = views[views[0].turn], i = v.me
      if (v.phase === 'orient') {
        for (let j=0;j<n;j++) await send(j, { type:'orient', rotate:j%2 === 1 })
        if (v.round === 1 && idleMs) {
          console.log(n + ' 人房间空闲 ' + idleMs + ' ms，保持已连接的座位')
          await sleep(idleMs)
          for (const [seat, client] of clients.entries()) {
            client.ws.send(JSON.stringify({ revision: 0, action: { type:'orient', rotate:false } }))
            const restored = await client.next()
            assert.equal(restored.type, 'error')
            assert.deepEqual(restored.view, views[seat])
          }
        }
        continue
      }
      if (v.result) {
        for (const [j, s] of v.result.scores.entries()) {
          assert.equal(s.points, s.captured + s.chips - s.penalty)
          totals[j] += s.points
          assert.equal(totals[j], v.players[j].total)
        }
        if (v.phase === 'finished') {
          assert.equal(v.round,n); assert.ok(reconnected && scout)
          if (n>2) assert.ok(combo)
          console.log(n + ' 人局完成 · ' + v.round + ' 轮 · revision ' + v.revision + ' · 得分 ' + totals.join(' / '))
          return
        }
        await send(0, { type:'next' }); continue
      }
      const show = possibleShow(v.hand, v.table)
      const pick = { end:'right' as const, flip:true, at:v.hand.length }
      const canScout = v.table.length > 0 && (n>2 || v.players[i].chips > 0)
      if (canScout && !scout) {
        const preview = previewPick(v.hand,v.table,pick)
        await send(i,{ type:'scout',...pick },true)
        assert.deepEqual(views[i].hand, preview.hand)
        assert.deepEqual(views[i].table, preview.table)
        assert.equal(views[i].turn, n === 2 ? i : (i+1)%n)
        const credited = n === 2 ? i : v.owner!
        assert.equal(views[i].players[credited].chips, v.players[credited].chips + (n === 2 ? -1 : 1))
        scout = true; continue
      }
      if (n>2 && !combo && canScout && !v.players[i].comboUsed) {
        const after = previewPick(v.hand,v.table,pick), follow = possibleShow(after.hand,after.table)
        if (follow) {
          await send(i,{ ...follow, ...pick, type:'combo' })
          assert.equal(views[i].turn,(i+1)%n)
          assert.ok(views[i].players[i].comboUsed)
          combo=true; continue
        }
      }
      await send(i,show ?? { type:'scout',...pick })
    }
    assert.fail('对局未能结束')
  } finally { for (const c of clients) c.ws.close() }
}
const sizes = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [3, 2]
for (const [i, size] of sizes.entries()) {
  assert.ok([2, 3, 4, 5].includes(size), '联机测试人数须为 2–5')
  await match(size, i === 0 ? Number(process.env.SCOUT_IDLE_MS ?? 0) : 0)
}
