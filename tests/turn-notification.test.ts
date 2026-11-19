import assert from 'node:assert/strict'
import test from 'node:test'
import { createTurnNotifier } from '../src/client/turn-notification.ts'
import { demoGame } from '../src/client/demo.ts'
import { playerView } from '../src/game.ts'

test('只在进入自己回合时通知，同回合抓牌和重连快照不重复提醒', () => {
  const sent: string[] = []
  const notify = createTurnNotifier(message => sent.push(message), { TERM_PROGRAM: 'iTerm.app' })
  const v = playerView(demoGame(), 1, 'DEMN22', 1)
  v.players[v.me].name = '小林'
  v.turn = v.me
  notify({ ...v, phase: 'lobby' })
  notify({ ...v, phase: 'orient' })
  const play = { ...v, phase: 'play' as const }
  notify({ ...play, turn: 0 })
  assert.deepEqual(sent, [])
  notify(play)
  const text = '\x1b]9;SCOUT · 轮到 小林 行动了\x1b\\'
  assert.deepEqual(sent, [text])
  const afterScout = { ...play, revision: 2 }
  notify(afterScout)
  notify({ ...afterScout })
  assert.deepEqual(sent, [text])
  notify({ ...play, turn: 0 })
  notify({ ...play, revision: 4 })
  notify({ ...play, phase: 'result' })
  notify({ ...play, round: 2 })
  notify({ ...play, phase: 'finished' })
  assert.deepEqual(sent, [text, text, text])
})

test('恢复座位时若已轮到自己立即提醒，未知终端与多路复用器使用响铃', () => {
  const v = playerView(demoGame(), 1, 'DEMN22', 3)
  v.phase = 'play'
  v.turn = v.me
  const environments: NodeJS.ProcessEnv[] = [
    {}, { TERM_PROGRAM: 'Apple_Terminal' },
    { TERM_PROGRAM: 'iTerm.app', TMUX: 'session' },
    { TERM: 'screen-256color', TERM_PROGRAM: 'WezTerm' },
  ]
  for (const env of environments) {
    const sent: string[] = []
    const notify = createTurnNotifier(message => sent.push(message), env)
    notify(v)
    notify(v)
    assert.deepEqual(sent, ['\x07'])
  }
  for (const env of [{ TERM_PROGRAM: 'ghostty' }, { TERM_PROGRAM: 'WezTerm' }, { TERM: 'xterm-kitty' }]) {
    const sent: string[] = []
    createTurnNotifier(message => sent.push(message), env)(v)
    assert.equal(sent.length, 1)
    assert.ok(sent[0].startsWith('\x1b]9;SCOUT'))
  }
})
