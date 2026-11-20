import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { render } from 'ink-testing-library'
import { renderToString } from 'ink'
import stringWidth from 'string-width'
import { Board } from '../src/client/Board.tsx'
import { demoGame } from '../src/client/demo.ts'
import { apply, playerView } from '../src/game.ts'
import type { Action, View } from '../src/protocol.ts'

test('真实 Ink 按键走过四张设计稿，取消预览与回车提交', async t => {
  let g = demoGame(), rev = 1
  const actions: Action[] = []
  function board(v: View) {
    return <Board view={v} submit={(a,r) => { assert.equal(r, rev); actions.push(a) }} columns={64} />
  }
  const view = () => playerView(g, 1, 'DEMN22', rev)
  const ui = render(board(view()))
  t.after(() => { ui.unmount(); ui.cleanup() })
  const frame = () => ui.lastFrame() ?? ''
  const press = async (...keys: string[]) => {
    for (const k of keys) { ui.stdin.write(k); await sleep(45) }
  }
  const right = '\x1b[C', left = '\x1b[D', enter = '\r', esc = '\x1b'
  await sleep(50)
  await press('r')
  assert.match(frame(), /^█ █▀█.*\n█ █ █.*\n▀ ▀▀▀.*\n {4}2\b/m)
  await press('r', enter)
  assert.deepEqual(actions.pop(), { type: 'orient', rotate: false })
  for (let i = 0; i < 5; i++) g = apply(g,i,{ type: 'orient', rotate: false })
  g = apply(g,0,{ type: 'show', from: 0, to: 1 })
  rev++; ui.rerender(board(view())); await sleep(40)
  await press('s',right,' ',right,right)
  assert.match(frame(), /顺子 3–4–5 · 可以出牌/)
  await press(enter)
  const show = actions.pop()!
  assert.deepEqual(show, { type: 'show', from: 1, to: 3 })
  g = apply(g,1,show)
  for (const i of [2,3,4]) g = apply(g,i,{ type: 'scout', end:'left', flip:false, at:0 })
  g = apply(g,0,{ type:'show', from:0,to:2 })
  rev++; ui.rerender(board(view())); await sleep(40)
  await press('c','e','r',right,esc)
  assert.equal(actions.length, 0)
  await press('b','e','r',right,right,right,enter,' ',left,enter)
  assert.match(frame(), /对子 4–4 · 可以出牌/)
  assert.match(frame(), /新 ▼/)
  assert.match(frame(), /确认抓牌并出牌/)
  await press(esc)
  assert.equal(actions.length, 0)
  await press(enter,enter)
  assert.equal(actions.length, 1)
  const combo = actions.pop()!
  assert.deepEqual(combo, { type:'combo', end:'right', flip:true, at:3, from:2, to:3 })
  g = apply(g,1,combo); rev++
  ui.rerender(board(view())); await sleep(50)
  assert.match(frame(), /轮到小林行动/)
  assert.match(frame(), /我的手牌 · 5 张/)
  assert.match(frame(), /阿青 +4 +0 +1 +可用/)
  assert.match(frame(), /你 +5 +4 +3 +已用/)
  assert.match(frame(), /小林 +10 +0 +0 +可用/)
})
test('40 列终端完整显示 12 张牌、选区和键位；同分并列', async t => {
  const v = playerView(demoGame(), 1, 'DEMN22', 3)
  v.hand.push([9,10],[10,3],[10,6])
  const draw = () => <Board view={v} columns={40} submit={() => {}} />
  const ui = render(draw())
  t.after(() => { ui.unmount(); ui.cleanup() })
  await sleep(40)
  const frame = ui.lastFrame()!
  assert.match(frame, /█ █▀█\n.*█ █ █\n.*▀ ▀▀▀\n.*\b6$/m)
  assert.match(frame, /确认方向/)
  assert.ok(frame.includes('└') && frame.includes('┘'))
  assert.ok(frame.split('\n').every(line => stringWidth(line) <= 40))
  v.phase = 'finished'
  v.result = { reason: 'empty', winner: 0, scores: v.players.map(() => ({ captured:0,chips:0,penalty:0,points:0 })) }
  v.players[0].total = v.players[1].total = 6
  ui.rerender(draw()); await sleep(40)
  assert.match(ui.lastFrame()!, /共享胜利/)
  assert.equal(ui.lastFrame()!.match(/#1 /g)?.length, 2)
})

test('宽终端的牌面保留三行大字和右下角点数，选中的牌使用粗边框', () => {
  const v = playerView(demoGame(), 1, 'DEMN22', 3)
  v.phase = 'play'
  v.owner = 0
  v.table = [[8, 10]]
  v.hand = [[10, 8]]
  const frame = renderToString(<Board view={v} columns={80} submit={() => {}} />, { columns: 80 })
  assert.ok(frame.includes(['│ █▀█ │', '│ █▀█ │', '│ ▀▀▀ │', '│   10│'].join('\n')))
  assert.ok(frame.includes(['│█ █▀█│', '│█ █ █│', '│▀ ▀▀▀│', '│    8│'].join('\n')))
  const selected = renderToString(<Board view={{ ...v, phase: 'orient' }} columns={80} submit={() => {}} />, { columns: 80 })
  assert.ok(selected.includes(['┏━━━━━┓', '┃█ █▀█┃', '┃█ █ █┃', '┃▀ ▀▀▀┃', '┃    8┃', '┗━━━━━┛', '└──────┘'].join('\n')))
})

test('宽窄终端都显示每位玩家的手牌、已赢牌、筹码和本轮 Scout & Show 状态', () => {
  const v = playerView(demoGame(), 1, 'DEMN22', 3)
  v.phase = 'play'
  v.players[0].name = '一二三四五六七八九十二三四五六七'
  v.players[0].captured = 10
  v.players[0].chips = 12
  v.players[0].comboUsed = true
  v.players[1].chips = 3
  function draw(view: View, columns: number) {
    return renderToString(<Board view={view} columns={columns} rows={36} submit={() => {}} />, { columns })
  }
  for (const columns of [40, 100]) {
    const frame = draw(v, columns)
    assert.match(frame, /玩家 +手牌 +已赢 +筹码 +Scout & Show/)
    assert.match(frame, /▶ 一二[^\n]* +9 +10 +12 +已用/)
    assert.match(frame, /你 +9 +0 +3 +可用/)
    for (const player of ['小林', '小麦', '阿森']) {
      assert.match(frame, new RegExp(player + ' +9 +0 +0 +可用'))
    }
    assert.ok(frame.split('\n').every(line => stringWidth(line) <= columns))
  }
  const duel = draw({ ...v, players: v.players.slice(0, 2) }, 40)
  assert.match(duel, /玩家 +手牌 +已赢 +Scout & Show/)
  assert.match(duel, /▶ 一二[^\n]* +9 +10 +不适用/)
  assert.match(duel, /你 +9 +0 +不适用/)
  assert.match(duel, /Scout 筹码 3/)
})

test('轮末支持全员确认，也能和旧版房间继续对局', { timeout: 2000 }, async t => {
  const v = playerView(demoGame(), 1, 'DEMN22', 3)
  v.phase = 'result'
  v.result = {
    reason: 'empty', winner: 0, confirmed: [0, 2],
    scores: v.players.map(() => ({ captured: 0, chips: 0, penalty: 0, points: 0 })),
  }
  let submit!: (action: Action, revision: number) => void
  const submitted = new Promise<[Action, number]>(resolve => { submit = (...move) => resolve(move) })
  const draw = (view: View) => <Board view={view} columns={64} rows={24} submit={submit} />
  const ui = render(draw(v))
  t.after(() => { ui.unmount(); ui.cleanup() })
  await sleep(50)
  assert.match(ui.lastFrame()!, /待确认 · 你、小麦、阿森/)
  assert.match(ui.lastFrame()!, /\[Enter\] 确认结算/)
  ui.stdin.write('\r')
  assert.deepEqual(await submitted, [{ type: 'next', round: v.round }, v.revision])

  const waiting = renderToString(draw({ ...v, result: { ...v.result, confirmed: [0, 1, 2] } }), { columns: 64 })
  assert.match(waiting, /待确认 · 小麦、阿森/)
  assert.match(waiting, /已确认，等待其他玩家/)
  const final = renderToString(draw({ ...v, phase: 'finished' }), { columns: 64 })
  assert.doesNotMatch(final, /待确认|确认结算/)

  const legacy = { ...v, result: { ...v.result, confirmed: undefined } }
  assert.match(renderToString(draw(legacy), { columns: 64 }), /等待房主开始下一轮/)
  const advanced = new Promise<[Action, number]>(resolve => { submit = (...move) => resolve(move) })
  ui.rerender(draw({ ...legacy, me: 0 }))
  await sleep(50)
  assert.match(ui.lastFrame()!, /\[Enter\] 开始下一轮/)
  ui.stdin.write('\r')
  assert.deepEqual(await advanced, [{ type: 'next' }, v.revision])
})

test('全屏桌面随窗口高度变化，滚动时保留房间和按键提示', async t => {
  const v = playerView(demoGame(), 1, 'DEMN22', 1)
  const draw = (rows: number) => <Board view={v} columns={40} rows={rows} submit={() => assert.fail('滚动不应提交操作')} />
  const ui = render(draw(36))
  t.after(() => { ui.unmount(); ui.cleanup() })
  const lines = () => ui.lastFrame()!.split('\n')
  await sleep(50)
  assert.equal(lines().length, 36)
  assert.match(lines().at(-1)!, /确认方向/)
  ui.rerender(draw(12)); await sleep(50)
  assert.equal(lines().length, 12)
  assert.match(lines()[0], /房间 DEMN22/)
  assert.match(lines()[2], /选择手牌方向/)
  assert.match(lines().at(-2)!, /↑↓ 滚动/)
  const before = ui.lastFrame()
  ui.stdin.write('\x1b[B'); await sleep(50)
  assert.notEqual(ui.lastFrame(), before)
  assert.match(lines()[0], /房间 DEMN22/)
  assert.match(lines().at(-1)!, /确认方向/)
  ui.stdin.write('\x1b[A'); await sleep(50)
  assert.equal(ui.lastFrame(), before)
  ui.rerender(draw(36)); await sleep(50)
  assert.equal(lines().length, 36)
  assert.doesNotMatch(ui.lastFrame()!, /↑↓ 滚动/)
})
