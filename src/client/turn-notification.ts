import type { View } from '../protocol.ts'

export function createTurnNotifier(write: (message: string) => void, env: NodeJS.ProcessEnv = process.env) {
  const program = env.TERM_PROGRAM ?? ''
  const term = env.TERM ?? ''
  const multiplexed = env.TMUX || env.STY || /^(screen|tmux)(-|$)/.test(term)
  const desktop = !multiplexed && (['iTerm.app', 'WezTerm', 'ghostty', 'kitty'].includes(program)
    || term === 'xterm-ghostty' || term === 'xterm-kitty')
  let lastOwnRound: number | undefined

  return (view: View) => {
    const ownRound = view.phase === 'play' && view.turn === view.me ? view.round : undefined
    if (ownRound !== undefined && ownRound !== lastOwnRound) {
      write(desktop ? `\x1b]9;SCOUT · 轮到 ${view.players[view.me].name} 行动了\x1b\\` : '\x07')
    }
    lastOwnRound = ownRound
  }
}
