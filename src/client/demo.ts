import { acceptsRevision, addPlayer, apply, beats, lobby, playerView, possibleShow, shuffledDeck } from '../game.ts'
import type { Action, Card, View } from '../protocol.ts'

// The opening uses the four reference screens. Every subsequent turn uses the same rules as online play.
export const exampleHand: Card[] = [[8,2],[3,9],[4,7],[5,2],[1,6],[4,8],[6,4],[7,2],[2,10]]
const openingPair: Card[] = [[6,2],[6,3]]
const openingRun: Card[] = [[7,1],[8,5],[9,4]]
export function demoGame() {
  let g = lobby()
  for (const name of ['阿青', '你', '小林', '小麦', '阿森']) g = addPlayer(g, name)
  const top = [...openingPair, ...openingRun, ...exampleHand]
  const rest = shuffledDeck(5, Math.random).filter(([a,b]) =>
    !top.some(([c,d]) => (a === c && b === d) || (a === d && b === c)))
  const deck = [...openingPair, ...openingRun, ...rest.splice(0,4), ...exampleHand, ...rest]
  return apply(g, 0, { type: 'start' }, deck)
}
export function demoBot(v: View): Action {
  if (v.phase === 'orient') return { type: 'orient', rotate: false }
  if (v.phase === 'result') return { type: 'next', round: v.round }
  if (v.round === 1) {
    if (v.me === 0 && !v.table.length) {
      const size = v.hand.length === 9 ? 2 : v.hand.length === 7 ? 3 : 0
      if (size && beats(v.hand.slice(0, size), [])) return { type: 'show', from: 0, to: size - 1 }
    }
    if (v.me > 1 && v.owner === 1 && v.table.length) {
      return { type: 'scout', end: 'left', flip: false, at: v.hand.length }
    }
  }
  return possibleShow(v.hand, v.table) ?? { type: 'scout', end: 'left', flip: false, at: v.hand.length }
}
export function startDemo(update: (v: View) => void, error: (message: string) => void) {
  let g = demoGame(), revision = 1
  let timer: ReturnType<typeof setTimeout>
  function publish() {
    update(playerView(g, 1, 'DEMN22', revision))
    const bot = g.phase === 'orient' ? g.players.findIndex((p,i) => i !== 1 && !p.ready) :
      g.phase === 'result' ? g.players.findIndex((_, i) => i !== 1 && !g.result?.confirmed?.includes(i)) :
      g.phase === 'play' && g.turn !== 1 ? g.turn : -1
    if (bot >= 0) timer = setTimeout(() => move(bot, demoBot(playerView(g, bot, 'DEMN22', revision))), 320)
  }
  function move(seat: number, a: Action) {
    clearTimeout(timer)
    try {
      const next = apply(g, seat, a, a.type === 'next' ? shuffledDeck(5, Math.random) : undefined)
      if (next !== g) revision++
      g = next
    } catch (e) { error((e as Error).message) }
    publish()
  }
  publish()
  return { submit: (a: Action, seen: number) => {
    if (!acceptsRevision(g, a, seen, revision)) { error('局面已更新，请重新确认'); return }
    move(1, a)
  }, close: () => clearTimeout(timer) }
}
