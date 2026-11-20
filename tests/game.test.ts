import test from 'node:test'
import assert from 'node:assert/strict'
import { addPlayer, apply, beats, lobby, playerView, possibleShow, previewPick, rotateHand, shuffledDeck, type Game } from '../src/game.ts'
import { demoGame, exampleHand } from '../src/client/demo.ts'
import type { Action, Card } from '../src/protocol.ts'

function randomSeed(seed: number) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
}
function room(n: number) {
  let g = lobby()
  for (let i = 0; i < n; i++) g = addPlayer(g, '玩家' + i)
  return g
}
function playing(n: number) {
  let g = apply(room(n), 0, { type: 'start' }, shuffledDeck(n, randomSeed(3)))
  for (let i = 0; i < n; i++) g = apply(g, i, { type: 'orient', rotate: false })
  return g
}
const cards = (...values: number[]): Card[] => values.map(v => [v, v === 10 ? 1 : 10])
const pick = { end: 'right' as const, at: 0, flip: false }
const key = ([a,b]: Card) => Math.min(a,b) + '/' + Math.max(a,b)

test('发牌、锁定方向与双人预留牌', () => {
  for (const [n, size] of [[2,11],[3,12],[4,11],[5,9]]) {
    const deck = shuffledDeck(n, randomSeed(n))
    assert.equal(new Set(deck.map(key)).size, deck.length)
    assert.equal(deck.some(c => key(c) === '9/10'), n === 5)
    assert.equal(deck.some(c => c.includes(10)), n !== 3)
    assert.ok(deck.some(([a,b]) => a>b) && deck.some(([a,b]) => a<b))
    const g = apply(room(n), 0, { type: 'start' }, deck)
    assert.ok(g.players.every(p => p.hand.length === size))
    const turned = apply(g, 0, { type: 'orient', rotate: true })
    assert.deepEqual(turned.players[0].hand, rotateHand(deck.slice(0, size)))
    assert.deepEqual(turned.players[0].hand[0], deck[size-1].slice().reverse())
    assert.throws(() => apply(turned, 0, { type: 'orient', rotate: false }))
    assert.throws(() => apply(turned, 0, { type: 'show', from: 0, to: 0 }))
    if (n === 2) {
      assert.deepEqual(g.reserve, deck.slice(22))
      const play = apply(apply(g, 0, { type: 'orient', rotate: false }), 1, { type: 'orient', rotate: false })
      play.players[0].hand = cards(9)
      const result = apply(play, 0, { type: 'show', from: 0, to: 0 })
      delete result.result!.confirmed // Stored settlements from before confirmation support.
      assert.deepEqual(playerView(result, 0, 'ABC234', 1).result?.confirmed, [])
      const waiting = apply(result, 0, { type: 'next' })
      assert.equal(waiting.phase, 'result')
      assert.deepEqual(waiting.result?.confirmed, [0])
      assert.equal(apply(waiting, 0, { type: 'next', round: 1 }), waiting)
      assert.throws(() => apply(waiting, 1, { type: 'next', round: 2 }))
      const next = apply(waiting, 1, { type: 'next', round: 1 })
      assert.deepEqual(next.players.flatMap(p => p.hand), g.reserve)
      assert.equal(next.starter, 1)
      assert.equal(next.result, null)
      assert.ok(next.players.every(p => p.chips === 3))
    }
  }
})
test('连续升降、同点和严格比较', () => {
  assert.ok(beats(cards(3,4,5), cards(6,6)))
  assert.ok(beats(cards(5,4,3), cards(2,3,4)))
  assert.ok(beats(cards(2,2), cards(8,9)))
  assert.ok(beats(cards(3,3), cards(2,2)))
  for (const x of [[3,4,3], [1,3], [3,3,4], []]) assert.equal(beats(cards(...x), []), false)
  assert.equal(beats(cards(5,4,3), cards(3,4,5)), false)
  assert.equal(beats(cards(5,6), cards(2,2)), false)
})
test('设计稿的组合动作一次生效，失败保持原局面', () => {
  const g = playing(5)
  g.players[0].hand = exampleHand.filter((_, i) => i === 0 || i >= 4)
  g.owner = 4
  g.table = [[7,1],[8,5],[9,4]]
  const saved = structuredClone(g)
  const combo = { type: 'combo', end: 'right', at: 3, flip: true, from: 2, to: 3 } as const
  assert.throws(() => apply(g, 0, { ...combo, to: 4 }))
  assert.throws(() => apply(g, 0, { ...combo, at: 9 }))
  assert.throws(() => apply(g, 1, combo))
  assert.deepEqual(g, saved)
  const next = apply(g, 0, combo)
  assert.deepEqual(next.table, [[4,8],[4,9]])
  assert.deepEqual(next.players[0].hand.map(c => c[0]), [8,1,6,7,2])
  assert.deepEqual(next.players[0].captured, [[7,1],[8,5]])
  assert.deepEqual([next.owner, next.turn, next.players[4].chips], [0,1,1])
  assert.ok(next.players[0].comboUsed)
  assert.throws(() => apply({ ...next, turn: 0 }, 0, combo))
  assert.deepEqual(demoGame().players[1].hand, exampleHand)
})
test('桌面取空、首尾插入与轮末豁免', () => {
  const g = playing(3)
  g.owner = 2; g.table = [[5,7]]; g.players[2].hand = cards(1,3)
  const next = apply(g, 0, { type: 'scout', ...pick, flip: true, at: g.players[0].hand.length })
  assert.deepEqual(next.table, [])
  assert.deepEqual(next.players[0].hand.at(-1), [7,5])
  assert.equal(next.turn, 1)
  assert.equal(apply(next, 1, { type: 'show', from: 0, to: 0 }).owner, 1)
  g.table = [[5,7],[6,3]]; g.players[2].captured = cards(1)
  const second = apply(apply(g, 0, { type: 'scout', ...pick }), 1, { type: 'scout', ...pick })
  assert.deepEqual(second.players[1].hand[0], [5,7])
  assert.equal(second.result?.reason, 'unchallenged')
  assert.deepEqual(second.result?.scores[2], { captured: 1, chips: 2, penalty: 0, points: 3 })
  assert.equal(second.result?.scores[0].points, -13)
})
test('双人付筹码、连续行动、对手受阻和出光结算', () => {
  const g = playing(2)
  g.players[0].hand = cards(1,3); g.table = [[6,2],[6,4],[6,9]]; g.owner = 1
  assert.throws(() => apply(g, 0, { type: 'combo', ...pick, from: 0, to: 0 }))
  const s = apply(g, 0, { type: 'scout', ...pick })
  assert.deepEqual([s.turn, s.players[0].chips, s.players[1].chips], [0,2,3])
  g.players[0].chips = 1
  const stuck = apply(g, 0, { type: 'scout', ...pick })
  assert.equal(stuck.result?.reason, 'blocked')
  assert.equal(stuck.result?.scores[1].penalty, 0)
  g.players[0].chips = 0
  assert.throws(() => apply(g, 0, { type: 'scout', ...pick }))
  g.turn = 1; g.table = []; g.players[1].hand = cards(9,9,2)
  assert.equal(apply(g, 1, { type: 'show', from: 0, to: 1 }).result?.reason, 'blocked')
  g.players[1].hand = cards(9); g.table = cards(8)
  const end = apply(g, 1, { type: 'show', from: 0, to: 0 })
  assert.deepEqual(end.result?.scores[1], { captured: 1, chips: 3, penalty: 0, points: 4 })
  assert.equal(end.result?.scores[0].points, -2)
})
function inventory(g: Game) {
  return [...g.players.flatMap(p => [...p.hand, ...p.captured]), ...g.table, ...g.reserve].map(key).sort()
}
test('160 场可复现的完整对局逐步检查每张牌和累计得分', () => {
  for (const n of [2,3,4,5]) for (let seed = 1; seed <= 40; seed++) {
    const rand = randomSeed(seed), deck = shuffledDeck(n, rand)
    let g = apply(room(n), 0, { type: 'start' }, deck)
    let expected = deck.map(key).sort(), totals = Array<number>(n).fill(0)
    let turns = 0
    while (true) {
      assert.deepEqual(inventory(g), expected)
      assert.ok(++turns < 2000)
      if (g.result) {
        totals = totals.map((x,i) => x + g.result!.scores[i].points)
        assert.deepEqual(g.players.map(p => p.total), totals)
        if (g.phase === 'finished') {
          assert.throws(() => apply(g, 0, { type: 'next', round: g.round }))
          break
        }
        const next = shuffledDeck(n, rand)
        expected = (n === 2 ? g.reserve : next).map(key).sort()
        const round = g.round
        const action = { type: 'next', round } as const
        for (let i = 0; i < n - 1; i++) {
          g = apply(g, i, action)
          assert.equal(g.phase, 'result')
          assert.equal(g.round, round)
          assert.deepEqual(g.players.map(p => p.total), totals)
        }
        g = apply(g, n - 1, action, next)
      } else if (g.phase === 'orient') {
        for (let i = 0; i < n; i++) g = apply(g, i, { type: 'orient', rotate: rand() < .5 })
        assert.equal(g.turn, g.round - 1)
      } else {
        const v = playerView(g, g.turn, 'ABC234', turns)
        const show = possibleShow(v.hand, v.table)
        let action: Action = show ?? { type: 'scout', ...pick }
        if (v.table.length && (n > 2 || g.players[g.turn].chips > 0) && (!show || rand() < .25)) {
          const p = { at: Math.floor(rand() * (v.hand.length+1)), end: rand() < .5 ? 'left' as const : 'right' as const, flip: rand() < .5 }
          const after = previewPick(v.hand, v.table, p)
          const follow = possibleShow(after.hand, after.table)
          action = follow && n > 2 && !v.players[v.me].comboUsed && rand() < .35 ?
            { ...follow, ...p, type: 'combo' } : { ...p, type: 'scout' }
        }
        g = apply(g, g.turn, action)
      }
    }
    assert.equal(g.round, n)
  }
})
