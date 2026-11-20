import assert from 'node:assert/strict'
import test from 'node:test'
import { createGameNotifier } from '../src/client/game-notification.ts'
import { demoGame } from '../src/client/demo.ts'
import { playerView } from '../src/game.ts'

test('只在进入自己回合时通知，同回合抓牌和重连快照不重复提醒', () => {
  const sent: string[] = []
  const notify = createGameNotifier(message => sent.push(message), { env: { TERM_PROGRAM: 'iTerm.app' } })
  const v = playerView(demoGame(), 1, 'DEMN22', 1)
  v.players[v.me].name = '小林'
  v.turn = v.me
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
  assert.deepEqual(sent, [text, text, text])
})

test('首轮发牌和最终结算各通知一次，逐轮发牌和结算不重复提醒', () => {
  const sent: string[] = []
  const notify = createGameNotifier(message => sent.push(message), { env: { TERM_PROGRAM: 'iTerm.app' } })
  const orient = playerView(demoGame(), 1, 'DEMN22', 1)
  notify({ ...orient, round: 0, phase: 'lobby' })
  notify(orient)
  notify({ ...orient, revision: 2 })
  notify({ ...orient, phase: 'play' })
  notify({ ...orient, phase: 'result' })
  notify({ ...orient, round: 2 })
  notify({ ...orient, round: 2, phase: 'play' })
  const finished = { ...orient, round: orient.players.length, phase: 'finished' as const }
  notify(finished)
  notify({ ...finished })
  assert.deepEqual(sent, [
    '\x1b]9;SCOUT · 游戏开始\x1b\\',
    '\x1b]9;SCOUT · 游戏结束，请查看最终排名\x1b\\',
  ])
})

test('本地试玩发牌即响铃，恢复座位时不补发已发生的开局或结束通知', () => {
  const sent: string[] = []
  const orient = playerView(demoGame(), 1, 'DEMN22', 1)
  const local = createGameNotifier(message => sent.push(message), { env: {}, local: true })
  local(orient)
  local(orient)
  local({ ...orient, phase: 'finished' })
  assert.deepEqual(sent, ['\x07', '\x07'])

  const resume = () => createGameNotifier(() => assert.fail('恢复座位不应补发通知'), { env: {} })
  resume()(orient)
  resume()({ ...orient, phase: 'finished' })
})

test('从大厅重连到自己行动时，开局和换人合并提醒', () => {
  const sent: string[] = []
  const notify = createGameNotifier(message => sent.push(message), { env: { TERM_PROGRAM: 'iTerm.app' } })
  const v = playerView(demoGame(), 1, 'DEMN22', 1)
  notify({ ...v, round: 0, phase: 'lobby' })
  notify({ ...v, phase: 'play', turn: v.me })
  assert.deepEqual(sent, ['\x1b]9;SCOUT · 游戏开始 · 轮到 你 行动了\x1b\\'])
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
    const notify = createGameNotifier(message => sent.push(message), { env })
    notify(v)
    notify(v)
    assert.deepEqual(sent, ['\x07'])
  }
  for (const env of [{ TERM_PROGRAM: 'ghostty' }, { TERM_PROGRAM: 'WezTerm' }, { TERM: 'xterm-kitty' }]) {
    const sent: string[] = []
    createGameNotifier(message => sent.push(message), { env })(v)
    assert.equal(sent.length, 1)
    assert.ok(sent[0].startsWith('\x1b]9;SCOUT'))
  }
})
