import type { Action, Card, Pick, RoundResult, View } from './protocol.ts'

type Player = {
  name: string, hand: Card[], captured: Card[], ready: boolean,
  comboUsed: boolean, chips: number, total: number,
}
export type Game = {
  phase: View['phase'], players: Player[], round: number, starter: number, turn: number,
  table: Card[], owner: number | null, reserve: Card[], result: RoundResult | null,
}
export function lobby(): Game {
  return { phase: 'lobby', players: [], round: 0, starter: 0, turn: 0,
    table: [], owner: null, reserve: [], result: null }
}
export function addPlayer(game: Game, name: string): Game {
  if (game.phase !== 'lobby' || game.players.length >= 5) throw Error('房间已开局或已满')
  return { ...game, players: [...game.players, {
    name, hand: [], captured: [], chips: 0, total: 0, ready: false, comboUsed: false,
  }] }
}
export function flipCard([a, b]: Card): Card { return [b, a] }
export function rotateHand(hand: Card[]): Card[] { return hand.slice().reverse().map(flipCard) }

export function shuffledDeck(n: number, random: () => number): Card[] {
  const deck: Card[] = []
  for (let b = 2; b <= (n === 3 ? 9 : 10); b++) {
    for (let a = 1; a < b; a++) {
      if ((n === 2 || n === 4) && a === 9 && b === 10) continue
      deck.push(random() < 0.5 ? [a, b] : [b, a])
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

export function shape(cards: Card[]) {
  if (!cards.length) return null
  const first = cards[0][0]
  const delta = cards.length === 1 ? 0 : cards[1][0] - first
  if (Math.abs(delta) > 1 || !cards.every(([v], i) => v === first + i * delta)) return null
  return { size: cards.length, match: delta === 0, low: Math.min(first, cards.at(-1)![0]) }
}
export function beats(cards: Card[], table: Card[]): boolean {
  const next = shape(cards)
  if (!next) return false
  const old = shape(table)
  if (!old) return true
  if (next.size !== old.size) return next.size > old.size
  if (next.match !== old.match) return next.match
  return next.low > old.low
}
export function possibleShow(hand: Card[], table: Card[]) {
  for (let from = 0; from < hand.length; from++) {
    for (let to = from + Math.max(1, table.length) - 1; to < hand.length; to++) {
      if (beats(hand.slice(from, to + 1), table)) return { type: 'show' as const, from, to }
    }
  }
  return null
}
export function previewPick(hand: Card[], table: Card[], pick: Pick) {
  if (!table.length || pick.at < 0 || pick.at > hand.length) throw Error('请选择桌面端点和有效插入位置')
  const rest = table.slice()
  const taken = pick.end === 'left' ? rest.shift()! : rest.pop()!
  const after = hand.slice()
  after.splice(pick.at, 0, pick.flip ? flipCard(taken) : taken)
  return { hand: after, table: rest }
}
function deal(g: Game, cards: Card[]) {
  const n = g.players.length
  const size = n === 2 ? 11 : cards.length / n
  g.round++
  g.starter = (g.round - 1) % n
  g.turn = g.starter
  g.phase = 'orient'
  g.result = null
  g.owner = null
  g.table = []
  g.reserve = cards.slice(size * n)
  g.players.forEach((p, i) => Object.assign(p, {
    hand: cards.slice(i * size, (i + 1) * size), captured: [], chips: n === 2 ? 3 : 0,
    ready: false, comboUsed: false,
  }))
}
function finish(g: Game, reason: RoundResult['reason'], winner: number) {
  const scores = g.players.map((p, i) => {
    const penalty = i === winner ? 0 : p.hand.length
    const points = p.captured.length + p.chips - penalty
    p.total += points
    return { captured: p.captured.length, chips: p.chips, penalty, points }
  })
  g.result = { reason, winner, scores }
  g.phase = g.round === g.players.length ? 'finished' : 'result'
}
// The caller supplies a shuffled deck only when a fresh deal is needed.
export function apply(game: Game, seat: number, action: Action, deck?: Card[]): Game {
  const g = structuredClone(game)
  const p = g.players[seat]
  if (!p) throw Error('座位不存在')
  const n = g.players.length
  if (action.type === 'start' || action.type === 'next') {
    if (seat !== 0 || n < 2 || g.phase !== (action.type === 'start' ? 'lobby' : 'result')) {
      throw Error('请由房主在凑齐人数或轮末时发牌')
    }
    const cards = n === 2 && g.round === 1 ? g.reserve : deck
    const expected = n === 3 ? 36 : n === 5 ? 45 : n === 2 && g.round === 1 ? 22 : 44
    if (cards?.length !== expected) throw Error('牌堆张数有误')
    deal(g, cards)
    return g
  }
  if (action.type === 'orient') {
    if (g.phase !== 'orient' || p.ready) throw Error('手牌方向已锁定')
    if (action.rotate) p.hand = rotateHand(p.hand)
    p.ready = true
    if (g.players.every(player => player.ready)) g.phase = 'play'
    return g
  }
  if (g.phase !== 'play' || g.turn !== seat) throw Error('请等待你的回合')
  const next = (seat + 1) % n
  if (action.type === 'scout' || action.type === 'combo') {
    if (action.type === 'combo' && (n === 2 || p.comboUsed)) throw Error('本轮无法使用 Scout & Show')
    if (g.owner === null || (n === 2 && p.chips === 0)) throw Error('无法 Scout')
    const preview = previewPick(p.hand, g.table, action)
    p.hand = preview.hand
    g.table = preview.table
    if (n === 2) p.chips--
    else g.players[g.owner].chips++
    if (action.type === 'scout') {
      if (n > 2) {
        g.turn = next
        if (next === g.owner) finish(g, 'unchallenged', g.owner)
      } else if (!p.chips && !possibleShow(p.hand, g.table)) {
        finish(g, 'blocked', g.owner)
      }
      return g
    }
    p.comboUsed = true
  }
  const { from, to } = action
  if (from < 0 || from > to || to >= p.hand.length) throw Error('出牌选区超出手牌')
  const selected = p.hand.slice(from, to + 1)
  if (!beats(selected, g.table)) throw Error('选区须构成能压过桌面的牌组')
  p.hand.splice(from, selected.length)
  p.captured.push(...g.table)
  g.table = selected
  g.owner = seat
  g.turn = next
  if (!p.hand.length) finish(g, 'empty', seat)
  else if (n === 2 && !g.players[next].chips && !possibleShow(g.players[next].hand, g.table)) {
    finish(g, 'blocked', seat)
  }
  return g
}

export function playerView(g: Game, me: number, code: string, revision: number): View {
  return { code, revision, me, phase: g.phase, round: g.round, starter: g.starter,
    turn: g.turn, table: g.table, owner: g.owner, result: g.result, hand: g.players[me].hand,
    players: g.players.map(({ hand, captured, ...publicInfo }) =>
      ({ ...publicInfo, count: hand.length, captured: captured.length })),
  }
}
