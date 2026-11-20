import React, { useRef, useState } from 'react'
import { Box, Text, useBoxMetrics, useInput, useWindowSize, type DOMElement } from 'ink'
import { beats, previewPick, rotateHand, shape } from '../game.ts'
import type { Action, Card, Pick, View } from '../protocol.ts'

const mint = '#86efc3', amber = '#ffc36b', muted = '#94a3b8'
// Each pair of pixel rows shares a terminal line; even 10 fits in five columns.
const largePoints: Record<number, string> = {
  1: '▄█ \n █ \n▀▀▀',
  2: '▀▀█\n█▀▀\n▀▀▀',
  3: '▀▀█\n▀▀█\n▀▀▀',
  4: '█ █\n▀▀█\n  ▀',
  5: '█▀▀\n▀▀█\n▀▀▀',
  6: '█▀▀\n█▀█\n▀▀▀',
  7: '▀▀█\n ▄▀\n ▀ ',
  8: '█▀█\n█▀█\n▀▀▀',
  9: '█▀█\n▀▀█\n▀▀▀',
  10: '█ █▀█\n█ █ █\n▀ ▀▀▀',
}
function describe(cards: Card[]) {
  const group = shape(cards)
  if (!group) return '无法组成牌型'
  const kind = cards.length === 1 ? '单张' : group.match ? (cards.length === 2 ? '对子' : '同点') : '顺子'
  return kind + ' ' + cards.map(([v]) => v).join('–')
}
function Cards({ cards, width, range, inserted }: {
  cards: Card[], width: number, range?: [number, number], inserted?: number,
}) {
  const compact = width < 72 || cards.length * 8 > width
  const cell = compact ? 6 : 8
  const perRow = Math.max(1, Math.floor(width / cell))
  const rows = []
  for (let start = 0; start < cards.length; start += perRow) {
    rows.push(<Box key={start}>
      {cards.slice(start, start + perRow).map(([top, bottom], col) => {
        const i = start + col
        const marked = range !== undefined && i >= range[0] && i <= range[1]
        const bar = marked ? (i === range[0] || col === 0 ? '└' : '─') + '─'.repeat(cell - 2) +
          (i === range[1] || col === perRow - 1 ? '┘' : '─') : ' '
        return <Box key={i} width={cell} flexDirection="column">
          {inserted !== undefined && <Text bold>{inserted === i ? '新 ▼' : ' '}</Text>}
          <Box borderStyle={compact ? undefined : marked ? 'bold' : 'single'}
            flexDirection="column" alignItems="center" width={cell - 1} aria-label={`当前 ${top}，备用 ${bottom}`}>
            <Text bold>{largePoints[top]}</Text>
            <Box alignSelf="flex-end"><Text>{bottom}</Text></Box>
          </Box>
          {range && <Text>{bar}</Text>}
        </Box>
      })}
    </Box>)
  }
  return <Box flexDirection="column">{rows}</Box>
}
function TableBody({ width, children }: { width: number, children: React.ReactNode }) {
  const viewport = useRef<DOMElement>(null)
  const body = useRef<DOMElement>(null)
  const [offset, setOffset] = useState(0)
  const bodySize = useBoxMetrics(body)
  const viewportSize = useBoxMetrics(viewport)
  const limit = Math.max(0, bodySize.height - viewportSize.height)
  const top = Math.min(offset, limit)
  useInput((_, key) => {
    if (key.upArrow) setOffset(Math.max(0, top - 1))
    if (key.downArrow) setOffset(Math.min(limit, top + 1))
  }, { isActive: limit > 0 })
  return <>
    <Box ref={viewport} flexGrow={1} flexBasis={0} overflow="hidden" contentOffsetY={top} flexDirection="column"
      justifyContent={limit ? 'flex-start' : 'center'}>
      <Box ref={body} flexDirection="column" flexShrink={0}>{children}</Box>
    </Box>
    <Text color={muted} wrap="truncate-end">{limit > 0
      ? '↑↓ 滚动 ' + '─'.repeat(Math.max(0, width - 8))
      : '─'.repeat(width)}</Text>
  </>
}
type Props = {
  view: View, submit: (action: Action, revision: number) => void, busy?: boolean,
  notice?: string, local?: boolean, columns?: number, rows?: number,
}
export function Board(props: Props) {
  const size = useWindowSize()
  const { view: v } = props
  const key = [v.code, v.round, v.phase, v.players[v.me].ready, v.phase === 'play' ? v.revision : 0].join('/')
  const width = props.columns ?? size.columns
  const height = props.rows ?? size.rows
  return <Screen key={key} {...props} width={width} height={height} />
}
function Screen({ view: v, submit, busy, notice, local, width, height }: Props & { width: number, height: number }) {
  const [mode, setMode] = useState<'idle' | 'show' | 'scout' | 'combo'>('idle')
  const [step, setStep] = useState<'pick' | 'range' | 'confirm'>('pick')
  const [pick, setPick] = useState<Pick>({ end: 'left', flip: false, at: 0 })
  const [cursor, setCursor] = useState(0)
  const [anchor, setAnchor] = useState<number | null>(null)
  const [rotate, setRotate] = useState(false)
  const me = v.players[v.me]
  const myTurn = v.phase === 'play' && v.turn === v.me
  const canDeal = local || v.me === 0
  const canScout = myTurn && v.table.length > 0 && (v.players.length > 2 || me.chips > 0)
  const canCombo = canScout && v.players.length > 2 && !me.comboUsed
  const picking = mode === 'scout' || mode === 'combo'
  const preview = picking ? previewPick(v.hand, v.table, pick) : null
  const hand = preview?.hand ?? (rotate ? rotateHand(v.hand) : v.hand)
  const table = preview?.table ?? v.table
  const inRange = mode === 'show' || (mode === 'combo' && step !== 'pick')
  const from = Math.min(cursor, anchor ?? cursor), to = Math.max(cursor, anchor ?? cursor)
  const selection = hand.slice(from, to + 1)
  const legal = beats(selection, table)
  function send(action: Action) { submit(action, v.revision) }
  useInput((input, key) => {
    if (busy) return
    const k = input.toLowerCase()
    if (v.phase === 'lobby' && canDeal && key.return && v.players.length >= 2) return send({ type: 'start' })
    if (v.phase === 'result' && canDeal && key.return) return send({ type: 'next' })
    if (v.phase === 'orient' && !me.ready) {
      if (k === 'r') setRotate(!rotate)
      if (key.return) send({ type: 'orient', rotate })
      return
    }
    if (!myTurn) return
    if (mode === 'idle') {
      if (k === 's' || ((k === 'c' || k === 'b') && (k === 'c' ? canScout : canCombo))) {
        setMode(k === 's' ? 'show' : k === 'c' ? 'scout' : 'combo')
        setPick({ end: 'left', flip: false, at: 0 })
        setStep('pick'); setCursor(0); setAnchor(null)
      }
      return
    }
    if (key.escape) {
      if (step === 'confirm') setStep(mode === 'combo' ? 'range' : 'pick')
      else if (picking && step === 'range') setStep('pick')
      else setMode('idle')
      return
    }
    if (picking && step === 'pick') {
      if (k === 'e') setPick({ ...pick, end: pick.end === 'left' ? 'right' : 'left' })
      if (k === 'r') setPick({ ...pick, flip: !pick.flip })
      if (key.leftArrow || key.rightArrow) {
        setPick({ ...pick, at: Math.max(0, Math.min(v.hand.length, pick.at + (key.leftArrow ? -1 : 1))) })
      }
      if (key.return) {
        setCursor(pick.at); setAnchor(null); setStep(mode === 'combo' ? 'range' : 'confirm')
      }
      return
    }
    if (inRange && step !== 'confirm') {
      if (key.leftArrow || key.rightArrow) {
        setCursor(Math.max(0, Math.min(hand.length - 1, cursor + (key.leftArrow ? -1 : 1))))
      }
      if (input === ' ') setAnchor(anchor === null ? cursor : null)
      if (key.return && legal) {
        if (mode === 'combo') setStep('confirm')
        else send({ type: 'show', from, to })
      }
      return
    }
    if (step === 'confirm' && key.return) {
      if (mode === 'scout') send({ type: 'scout', ...pick })
      if (mode === 'combo' && legal) send({ type: 'combo', ...pick, from, to })
    }
  })

  const sidebar = width >= 92 && v.phase === 'play' && mode === 'idle'
  const cardWidth = width - (sidebar ? 25 : 0)
  const playerName = (i: number) => i === v.me ? '你' : v.players[i].name
  const roster = <Box flexDirection="column" width={sidebar ? 24 : undefined}>
    <Text bold color={amber}>玩家 / 手牌</Text>
    {v.players.map((p, i) => <Text key={i} color={i === v.turn ? amber : undefined}>
      {i === v.turn ? '▶' : ' '} {playerName(i)}  {p.count} 张</Text>)}
  </Box>
  let hint = ''
  let content: React.ReactNode
  if (v.phase === 'lobby') {
    content = <Box flexDirection="column"><Text bold>等待入座 · {v.players.length}/5</Text>
      {v.players.map((p, i) => <Text key={i}>{p.name}{i === 0 ? ' · 房主' : ''}{i === v.me ? '（你）' : ''}</Text>)}
    </Box>
    hint = canDeal && v.players.length >= 2 ? '[Enter] 开始发牌' : '将房间码发给朋友，等待房主发牌'
  } else if (v.phase === 'orient') {
    content = <Box flexDirection="column" gap={1}>
      <Text bold>{me.ready ? '手牌方向已锁定' : '选择手牌方向'}</Text>
      <Text dimColor>大字是当前点数，右下角是备用点数。整手旋转会反转牌序。</Text>
      <Text bold color={amber}>我的手牌 · {hand.length} 张</Text>
      <Cards cards={hand} width={width} range={[0, hand.length - 1]} />
    </Box>
    hint = me.ready ? '等待其他玩家确认方向' : '[R] 旋转整手   [Enter] 确认方向'
  } else if (v.result) {
    const final = v.phase === 'finished'
    const ranked = v.players.map((p, i) => ({ ...p, i })).sort((a, b) => b.total - a.total)
    const winners = ranked.filter(p => p.total === ranked[0].total).map(p => playerName(p.i))
    content = <Box flexDirection="column">
      <Text color={mint} bold>{final ? '最终排名 · ' + winners.join('、') + (winners.length > 1 ? ' 共享胜利' : ' 获胜') : '本轮结算'}</Text>
      <Text>{playerName(v.result.winner)} · {{ empty: '出光手牌', unchallenged: '其余玩家均只 Scout', blocked: '对手无合法行动' }[v.result.reason]}</Text>
      {ranked.map((p, j) => {
        const score = v.result!.scores[p.i]
        const place = ranked.findIndex(other => other.total === p.total) + 1
        return <Text key={p.i}>{final ? '#' + place + ' ' : ''}{playerName(p.i)}　得分牌 {score.captured} + 筹码 {score.chips} − 扣牌 {score.penalty} = {score.points}　累计 {ranked[j].total}</Text>
      })}
    </Box>
    hint = final ? '[Ctrl+C] 离开' : canDeal ? '[Enter] 开始下一轮' : '等待房主开始下一轮'
  } else {
    const handRange: [number, number] | undefined = inRange ? [from, to] : undefined
    content = <Box flexDirection="column">
      <Box>
        <Box flexDirection="column" width={cardWidth}>
          <Text bold color={amber}>{picking ? (mode === 'combo' ? 'Scout & Show' : 'Scout') + ' · 预览' : '桌面牌组'}</Text>
          {picking && <Text>取{pick.end === 'left' ? '左' : '右'}端 {v.table[pick.end === 'left' ? 0 : v.table.length - 1][0]} → {hand[pick.at][0]}　插在第 {pick.at + 1} 位</Text>}
          <Text dimColor>{table.length ? playerName(v.owner!) + '打出 · ' + describe(table) : '桌面为空，可自由领出'}</Text>
          <Cards cards={table} width={cardWidth} />
          <Text bold color={amber}>{picking ? '插入后的手牌' : '我的手牌'} · {hand.length} 张</Text>
          <Cards cards={hand} width={cardWidth} range={handRange} inserted={picking ? pick.at : undefined} />
          {inRange && <Text color={legal ? mint : amber}>{describe(selection)} · {legal ? '可以出牌' : '不能出牌'}</Text>}
        </Box>
        {sidebar && roster}
      </Box>
      {!sidebar && mode === 'idle' && <Text dimColor>{v.players.map((p, i) => playerName(i) + ' ' + p.count + '张').join('  ')}</Text>}
    </Box>
    if (myTurn) {
      if (mode === 'idle') hint = '[S] Show' + (canScout ? '   [C] Scout' : '') + (canCombo ? '   [B] Scout & Show' : '')
      else if (step === 'confirm') hint = '[Enter] 确认' + (mode === 'combo' ? '抓牌并出牌' : '抓牌') + '   [Esc] 返回调整'
      else if (picking && step === 'pick') hint = '[E] 换端  [R] 翻牌  [← →] 插入点  [Enter] 继续  [Esc] 取消'
      else hint = '[← →] 选牌  [Space] 定起点  [Enter] ' + (mode === 'combo' ? '预览' : '出牌') + '  [Esc] 返回'
    }
  }
  return <Box flexDirection="column" width={width} height={height} overflow="hidden">
    <Box justifyContent="space-between"><Text bold>SCOUT</Text><Text>房间 {v.code}{v.round ? ' · 第 ' + v.round + '/' + v.players.length + ' 轮' : ''}</Text></Box>
    <Text color={muted}>{'─'.repeat(width)}</Text>
    <TableBody width={width}>{content}</TableBody>
    {v.phase === 'play' && <Text color={amber}>轮到{playerName(v.turn)}行动　<Text dimColor>{v.players.length === 2 ? 'Scout 筹码 ' + me.chips : '本轮 Scout & Show ' + (me.comboUsed ? '已使用' : '可用')}</Text></Text>}
    {hint && <Text color={mint}>{hint}</Text>}
    {notice && <Text color={amber}>{notice}</Text>}
  </Box>
}
