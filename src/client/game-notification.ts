import type { View } from '../protocol.ts'

export function createGameNotifier(
  write: (message: string) => void,
  { env = process.env, local = false }: { env?: NodeJS.ProcessEnv, local?: boolean } = {},
) {
  const program = env.TERM_PROGRAM ?? ''
  const term = env.TERM ?? ''
  const multiplexed = env.TMUX || env.STY || /^(screen|tmux)(-|$)/.test(term)
  const desktop = !multiplexed && (['iTerm.app', 'WezTerm', 'ghostty', 'kitty'].includes(program)
    || term === 'xterm-ghostty' || term === 'xterm-kitty')
  let lastPhase: View['phase'] | undefined = local ? 'lobby' : undefined
  let lastOwnRound: number | undefined

  return (view: View) => {
    const messages: string[] = []
    if (lastPhase === 'lobby' && (view.phase === 'orient' || view.phase === 'play')) {
      messages.push('游戏开始')
    }
    if (lastPhase !== undefined && lastPhase !== 'finished' && view.phase === 'finished') {
      messages.push('游戏结束，请查看最终排名')
    }
    const ownRound = view.phase === 'play' && view.turn === view.me ? view.round : undefined
    if (ownRound !== undefined && ownRound !== lastOwnRound) {
      messages.push(`轮到 ${view.players[view.me].name} 行动了`)
    }
    lastPhase = view.phase
    lastOwnRound = ownRound
    if (messages.length) write(desktop ? `\x1b]9;SCOUT · ${messages.join(' · ')}\x1b\\` : '\x07')
  }
}
