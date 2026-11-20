import React, { useEffect, useRef, useState } from 'react'
import { render, Text } from 'ink'
import { Board } from './Board.tsx'
import { startDemo } from './demo.ts'
import { connect, defaultServer, getSession, type Session } from './session.ts'
import { createGameNotifier } from './game-notification.ts'
import type { View } from '../protocol.ts'

function App({ session }: { session?: Session }) {
  const [view, setView] = useState<View>()
  const [notice, setNotice] = useState('连接房间中…')
  const [busy, setBusy] = useState(true)
  const live = useRef<ReturnType<typeof connect> | null>(null)
  useEffect(() => {
    const notify = createGameNotifier(message => process.stdout.write(message), { local: !session })
    const receive = (v: View) => {
      notify(v)
      setView(v)
    }
    if (session) {
      live.current = connect(session, receive, (s, b) => { setNotice(s); setBusy(b) })
    } else {
      setBusy(false); setNotice('')
      live.current = startDemo(receive, setNotice)
    }
    return () => live.current?.close()
  }, [session])
  if (!view) return <Text>{notice}</Text>
  return <Board view={view} local={!session} notice={notice} busy={busy} submit={(a, r) => live.current?.submit(a, r)} />
}
const [command = 'demo', ...args] = process.argv.slice(2)
const help = `./scout                   本地试玩
./scout create 昵称       创建房间
./scout join 房间码 昵称  加入房间
./scout resume 房间码     回到原座位

从源码启动时，对应命令为 pnpm play。
SCOUT_SERVER 指定房间服务器，默认 ${defaultServer}。`
try {
  if (['help', '-h', '--help'].includes(command)) console.log(help)
  else {
    const commands: Record<string, number> = { demo: 0, create: 1, join: 2, resume: 1 }
    if (args.length !== commands[command]) throw Error(help)
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error('请在交互式终端运行 SCOUT')
    const session = command === 'demo' ? undefined : await getSession(command, args)
    const app = render(<App session={session} />, { alternateScreen: true, interactive: true })
    await app.waitUntilExit()
  }
} catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1 }
