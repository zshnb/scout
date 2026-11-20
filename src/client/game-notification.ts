import { execFile } from 'node:child_process'
import type { View } from '../protocol.ts'

type SystemNotifier = (message: string, onFailure: () => void) => void

const notifyMac: SystemNotifier = (message, onFailure) => {
  execFile('/usr/bin/osascript', [
    '-e', 'on run argv',
    '-e', 'display notification (item 1 of argv) with title "SCOUT"',
    '-e', 'end run',
    message,
  ], { timeout: 3000 }, error => { if (error) onFailure() })
}

export function createGameNotifier(
  write: (message: string) => void,
  {
    env = process.env, local = false, notifySystem = process.platform === 'darwin' ? notifyMac : null,
  }: { env?: NodeJS.ProcessEnv, local?: boolean, notifySystem?: SystemNotifier | null } = {},
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
    if (!messages.length) return
    const message = messages.join(' · ')
    const fallback = () => write(desktop ? `\x1b]9;SCOUT · ${message}\x1b\\` : '\x07')
    if (notifySystem) notifySystem(message, fallback)
    else fallback()
  }
}
