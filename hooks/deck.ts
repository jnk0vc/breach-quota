import type { SubAgent, HackName, Hacks, LogEntry, TokenTally, Verdict } from '../types'
import {
  BONE,
  CYAN,
  HOT,
  HUD,
  HUD_DARK,
  HUD_DIM,
  VIEW_W,
  VOID,
  YELLOW,
  chamfer,
  fitText,
  fontAttrs,
  glitch,
  glyph,
  heading,
  kilo,
  plate,
  svgDocument,
  text,
  widthOf,
  xml,
} from './style'
import type { Layout } from './style'

// ── 呼び名と色 ──────────────────────────────────────────

export const HACK_LABEL: Record<HackName, string> = { SCAN: 'スキャン', INJECT: '書き換え', EXEC: '実行' }
export const HACK_NAMES: HackName[] = ['SCAN', 'INJECT', 'EXEC']
export const VERDICT_WORD: Record<Verdict, string> = { idle: 'IDLE', running: 'RUN', approved: 'OK', denied: 'ICE' }
export const VERDICT_TEXT: Record<Verdict, string> = { idle: '待機', running: '実行中', approved: '成功', denied: '遮断' }
export const VERDICT_COLOR: Record<Verdict, string> = { idle: HUD_DIM, running: YELLOW, approved: CYAN, denied: HOT }

// 状況の見出し。ヘッダー帯の右に出す
const STATUS: Record<Verdict, string> = { idle: 'STANDBY', running: 'JACKED IN', approved: 'LINK OK', denied: 'ICE HIT' }

export const elapsed = (from: number, at: number): string => {
  const seconds = Math.max(0, Math.floor((at - from) / 1000))
  const h = Math.floor(seconds / 3600)
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
  const s = String(seconds % 60).padStart(2, '0')
  return h > 0 ? `+${h}:${m}:${s}` : `+${m}:${s}`
}

export const shortModel = (model: string): string => model.replace(/^claude-/, '').replace(/-\d{8}$/, '')

// ── 数値の書式 ──────────────────────────────────────────

export const usd = (value: number): string => `$${value.toFixed(2)}`

// 開始から5分たつまでは平均がぶれるので、ペースを出さない
export const costPace = (cost: number | null, startedAt: number, now: number): string | undefined => {
  const hours = (now - startedAt) / 3_600_000
  return cost === null || startedAt === 0 || hours < 5 / 60 ? undefined : `${usd(cost / hours)}/h`
}

// キャッシュから読んだ入力の割合。入力が1件もなければundefined
export const cacheRate = (tokens: TokenTally): number | undefined => {
  const input = tokens.input + tokens.cacheRead + tokens.cacheWrite
  return input === 0 ? undefined : tokens.cacheRead / input
}

// ── ヘッダー帯 ──────────────────────────────────────────

export const headerSvg = (decision: Verdict, ops: number, layout: Layout, drawWidth: number) => {
  const width = VIEW_W[layout]
  const height = 40
  const title = 'BREACH//QUOTA'
  const titleSvg = text(16, 27, 18, 'inherit', title, { face: 'label', weight: 900, spacing: 3 })
  const status = STATUS[decision]
  const statusColor = decision === 'denied' ? HOT : VOID
  const body = `<path d="${chamfer(0, 4, width, height - 8, 12)}" fill="${YELLOW}"/>
  <g fill="${VOID}">${titleSvg}</g>${glitch(titleSvg)}
  ${text(width - 16, 27, 15, statusColor, status, { anchor: 'end', face: 'label', weight: 900, spacing: 2 })}
  ${text(width - 22 - widthOf(status, 15, 'label') - status.length * 2, 26, 10, VOID, `OPS ${String(ops).padStart(3, '0')}`, { anchor: 'end', face: 'mono', weight: 700, opacity: 0.7 })}`
  return svgDocument(width, height, drawWidth, body, { tube: false })
}

// ── 計器(消費額・キャッシュ命中率・通信量) ─────────────────

const CELL_H = 100

type Cell = { title: string; japanese: string; value: string; sub: string; note: string }

const cell = (x: number, y: number, w: number, one: Cell, valueSize: number): string =>
  `<g transform="translate(${x} ${y})">
  ${plate(0, 0, w, CELL_H, HUD, 10)}
  ${text(10, 22, 10, YELLOW, one.title, { face: 'label', weight: 800, spacing: 1.6 })}
  ${text(10, 35, 9, HUD, one.japanese, { weight: 600, opacity: 0.8 })}
  <g filter="url(#crt)">${text(10, 70, valueSize, one.value === '--' ? HUD_DIM : CYAN, xml(one.value), { face: 'cond', weight: 700 })}</g>
  ${text(10, 84, 9.5, BONE, xml(one.sub), { face: 'mono', weight: 500, opacity: 0.85 })}
  ${text(10, 95, 8.5, CYAN, one.note, { weight: 600, opacity: 0.85 })}
</g>`

const cellsOf = (cost: number | null, tokens: TokenTally, startedAt: number, now: number, isNarrow: boolean): Cell[] => {
  const rate = cacheRate(tokens)
  const input = tokens.input + tokens.cacheRead + tokens.cacheWrite
  return [
    {
      title: 'BURN RATE',
      japanese: '消費額',
      value: cost === null ? '--' : usd(cost),
      sub: costPace(cost, startedAt, now) ?? 'ペース計測中',
      note: isNarrow ? '// 開始からの平均' : '// セッション開始からの平均ペース',
    },
    {
      title: 'CACHE HIT',
      japanese: 'キャッシュ命中率',
      value: rate === undefined ? '--' : `${Math.round(rate * 100)}%`,
      sub: `読${kilo(tokens.cacheRead)}／書${kilo(tokens.cacheWrite)}`,
      note: isNarrow ? '// 読込÷入力' : '// キャッシュ読込÷入力の合計',
    },
    {
      title: 'BANDWIDTH',
      japanese: '通信量',
      value: input + tokens.output === 0 ? '--' : kilo(input + tokens.output),
      sub: `入${kilo(input)}／出${kilo(tokens.output)}`,
      note: `// ${tokens.turns}ターンの累計`,
    },
  ]
}

export const vitalsSvg = (
  cost: number | null,
  tokens: TokenTally,
  startedAt: number,
  now: number,
  layout: Layout,
  drawWidth: number,
) => {
  const width = VIEW_W[layout]
  const gap = 10
  const w = (width - 2 * gap) / 3
  const body = cellsOf(cost, tokens, startedAt, now, layout === 'narrow')
    .map((one, i) => cell(i * (w + gap), 0, w, one, layout === 'narrow' ? 30 : 36))
    .join('')
  return svgDocument(width, CELL_H, drawWidth, body)
}

export const vitalsRow = (cost: number | null, tokens: TokenTally, startedAt: number, now: number): string => {
  const rate = cacheRate(tokens)
  const input = tokens.input + tokens.cacheRead + tokens.cacheWrite
  return [
    `消費額 ${cost === null ? '--' : usd(cost)}${costPace(cost, startedAt, now) ? ` (${costPace(cost, startedAt, now)})` : ''}`,
    `キャッシュ命中率 ${rate === undefined ? '--' : `${Math.round(rate * 100)}%`}`,
    `通信量 ${kilo(input + tokens.output)} / ${tokens.turns}ターン`,
  ].join(' ・ ')
}

// ── ハックトレース ──────────────────────────────────────
// 3種のハックを横長のトラックに並べ、1回の実行を1列として刻む。右端が最新。
// その下にサブエージェントを1体1トラックで並べ、その機体の実行を同じ列に重ねて刻む

const LANE_TOP = 50
const LANE_H = 36
const STEP = 11
const LABEL_W = 100
const AGENT_HEAD = 24
const AGENT_SLOTS = 3

// 実行中のサブエージェントを先に、そのあとに新しい順で、最大3体を出す
export const subAgentsShown = (subAgents: readonly SubAgent[]): SubAgent[] =>
  [...subAgents]
    .reverse()
    .sort((a, b) => Number(b.verdict === 'running') - Number(a.verdict === 'running'))
    .slice(0, AGENT_SLOTS)

// サブエージェントのトラックは、作業内容を1行のせるぶん背を高くする
const NOTE_H = 10
const AGENT_LANE_H = LANE_H + NOTE_H

const tapeY = (agentCount: number): number =>
  LANE_TOP + 3 * LANE_H + (agentCount > 0 ? AGENT_HEAD + agentCount * AGENT_LANE_H : 0)

export const traceHeight = (agentCount: number): number => tapeY(agentCount) + 28

const tick = (x: number, y: number, verdict: Verdict): string =>
  `<polygon points="${x + 3},${y} ${x + 8},${y} ${x + 5},${y + 16} ${x},${y + 16}" fill="${VERDICT_COLOR[verdict]}"${verdict === 'running' ? ' class="blink"' : ''}/>`

type Lane = {
  title: string
  sub: string
  note?: string
  count: number
  verdict: Verdict
  entries: { column: number; verdict: Verdict }[]
}

const lane = (one: Lane, top: number, trackX: number, trackW: number, isAgent: boolean): string => {
  const titleSize = isAgent ? 11 : 13
  // 右端に回数(×12)を置くぶん、名前の幅を空ける
  const room = trackX - 14 - 34
  // サブエージェントの作業内容は、トラックの上に1行で添える
  const note =
    one.note === undefined
      ? ''
      : text(trackX, top + 8, 9, BONE, xml(fitText(one.note, 9, trackW)), { weight: 600, opacity: 0.7 })
  const y = one.note === undefined ? top : top + NOTE_H
  const title = isAgent
    ? text(14, y + 15, titleSize, BONE, xml(fitText(one.title, titleSize, room, 'label')), { face: 'label', weight: 700 })
    : text(14, y + 15, titleSize, HUD, one.title, { face: 'label', weight: 800, spacing: 1.6 })
  return `${title}
  ${text(14, y + 28, 9, isAgent ? HUD_DIM : HUD, xml(fitText(one.sub, 9, room, isAgent ? 'mono' : 'gothic')), { face: isAgent ? 'mono' : 'gothic', weight: 600, opacity: isAgent ? 1 : 0.75 })}
  <rect x="${trackX}" y="${y + 4}" width="${trackW}" height="22" fill="${HUD_DARK}" opacity="0.35"/>
  <line x1="${trackX}" y1="${y + 26}" x2="${trackX + trackW}" y2="${y + 26}" stroke="${HUD_DIM}" stroke-width="1"/>
  ${note}
  ${one.entries.map(entry => tick(trackX + 4 + entry.column * STEP, y + 7, entry.verdict)).join('')}
  ${text(trackX - 8, y + 20, 10, VERDICT_COLOR[one.verdict], `×${one.count}`, { anchor: 'end', face: 'mono', weight: 700 })}`
}

const trace = (
  hacks: Hacks,
  decision: Verdict,
  list: readonly LogEntry[],
  subAgents: readonly SubAgent[],
  width: number,
): string => {
  const trackX = 14 + LABEL_W
  const trackW = width - trackX - 14
  const columns = Math.max(1, Math.floor((trackW - 8) / STEP))
  const recent = list.slice(-columns)
  const first = list.length - recent.length
  const hackLanes: Lane[] = HACK_NAMES.map(name => ({
    title: name,
    sub: HACK_LABEL[name],
    count: hacks[name].count,
    verdict: hacks[name].verdict,
    entries: recent.flatMap((entry, i) => (entry.hack === name ? [{ column: i, verdict: entry.verdict }] : [])),
  }))
  const shown = subAgentsShown(subAgents)
  const agentLanes: Lane[] = shown.map(one => ({
    title: one.type,
    sub: shortModel(one.model),
    note: one.description,
    count: one.count,
    verdict: one.verdict,
    entries: recent.flatMap((entry, i) => (entry.agentId === one.id ? [{ column: i, verdict: entry.verdict }] : [])),
  }))
  const agentTop = LANE_TOP + 3 * LANE_H
  const tape = tapeY(shown.length)
  // 通し番号の目盛り。10回ごとに番号を振る
  const marks = recent
    .map((_, i) => {
      const n = first + i + 1
      const x = trackX + 4 + i * STEP + 4
      return n % 10 === 0
        ? `<line x1="${x}" y1="${tape + 2}" x2="${x}" y2="${tape + 9}" stroke="${HUD_DIM}"/>${text(x, tape + 20, 8, HUD_DIM, String(n), { anchor: 'middle', face: 'mono', weight: 500 })}`
        : `<line x1="${x}" y1="${tape + 2}" x2="${x}" y2="${tape + 5}" stroke="${HUD_DARK}"/>`
    })
    .join('')
  const height = traceHeight(shown.length)
  return `${plate(0, 0, width, height, decision === 'denied' ? HOT : HUD)}
  ${heading(14, 28, 'HACK TRACE', 'ツール実行', HUD)}
  ${text(width - 14, 28, 12, VERDICT_COLOR[decision], `${VERDICT_WORD[decision]} ／ ${VERDICT_TEXT[decision]}`, { anchor: 'end', face: 'label', weight: 800, spacing: 1.4 })}
  ${hackLanes.map((one, i) => lane(one, LANE_TOP + i * LANE_H, trackX, trackW, false)).join('')}
  ${
    shown.length === 0
      ? ''
      : `${text(14, agentTop + 16, 10, YELLOW, 'SUB-AGENTS', { face: 'label', weight: 800, spacing: 2 })}
  <line x1="${trackX}" y1="${agentTop + 12}" x2="${width - 14}" y2="${agentTop + 12}" stroke="${YELLOW}" stroke-width="0.6" stroke-dasharray="2 3" opacity="0.6"/>
  ${agentLanes.map((one, i) => lane(one, agentTop + AGENT_HEAD + i * AGENT_LANE_H, trackX, trackW, true)).join('')}`
  }
  ${marks}`
}

// ── アクセスログ ────────────────────────────────────────

const ROW_H = 20
const LOG_HEAD = 46

const accessLog = (list: readonly LogEntry[], origin: number, width: number, rows: number): string => {
  const shown = list.slice(-rows)
  // 経過・ハック・結果・ツール・対象の5列。ハックは最長のINJECTが収まる幅をとる
  const summaryX = 220
  const room = width - summaryX - 14
  const lines = shown
    .map((entry, i) => {
      const y = LOG_HEAD + 6 + i * ROW_H
      const color = VERDICT_COLOR[entry.verdict]
      const stripe = i % 2 === 0 ? `<rect x="8" y="${y - 13}" width="${width - 16}" height="${ROW_H - 2}" fill="${HUD_DARK}" opacity="0.25"/>` : ''
      const blink = entry.verdict === 'running' ? ' class="blink"' : ''
      return `${stripe}${glyph(14, y, elapsed(origin, entry.at), ` fill="${HUD_DIM}"`)}${glyph(72, y, entry.hack, ` fill="${HUD}" font-weight="700"`)}${glyph(116, y, VERDICT_WORD[entry.verdict], ` fill="${color}" font-weight="700"${blink}`)}${glyph(146, y, xml(fitText(entry.tool, 10, summaryX - 146 - 6, 'mono')), ` fill="${BONE}" font-weight="600"`)}${glyph(summaryX, y, xml(fitText(entry.summary, 10, room, 'mono')), ` fill="${HUD_DIM}"`)}`
    })
    .join('')
  const height = LOG_HEAD + rows * ROW_H + 10
  return `${plate(0, 0, width, height, HUD)}
  ${heading(14, 28, 'ACCESS LOG', 'アクセスログ', HUD)}
  ${text(width - 14, 28, 10, HUD_DIM, `${list.length} ENTRIES`, { anchor: 'end', face: 'mono', weight: 600 })}
  ${shown.length === 0 ? text(14, LOG_HEAD + 6, 10, HUD_DIM, '// ツールが動くとここに記録します', { weight: 600 }) : `<g ${fontAttrs('mono', 10, 500)}>${lines}</g>`}`
}

// ── 組み立て ────────────────────────────────────────────

const GAP = 14
const LOG_X_WIDE = 714

export const logHeight = (rows: number): number => LOG_HEAD + rows * ROW_H + 10

export const boardSvg = (
  hacks: Hacks,
  decision: Verdict,
  list: readonly LogEntry[],
  subAgents: readonly SubAgent[],
  origin: number,
  layout: Layout,
  drawWidth: number,
  rows: number,
) => {
  const width = VIEW_W[layout]
  const agentCount = subAgentsShown(subAgents).length
  const traceH = traceHeight(agentCount)
  if (layout === 'wide') {
    const traceW = LOG_X_WIDE - GAP
    const height = Math.max(traceH, logHeight(rows))
    const body = `<g>${trace(hacks, decision, list, subAgents, traceW)}</g><g transform="translate(${LOG_X_WIDE} 0)">${accessLog(list, origin, width - LOG_X_WIDE, rows)}</g>`
    return svgDocument(width, height, drawWidth, body)
  }
  const height = traceH + GAP + logHeight(rows)
  const body = `<g>${trace(hacks, decision, list, subAgents, width)}</g><g transform="translate(0 ${traceH + GAP})">${accessLog(list, origin, width, rows)}</g>`
  return svgDocument(width, height, drawWidth, body)
}

// パネルの残りの高さに収まるログの行数。広いときはトレースの高さに合わせる
export const logRowsFor = (
  layout: Layout,
  drawWidth: number,
  paneHeight: number,
  usedHeight: number,
  subAgents: readonly SubAgent[],
): number => {
  const scale = drawWidth / VIEW_W[layout]
  const spare = (paneHeight - usedHeight) / scale
  const traceH = traceHeight(subAgentsShown(subAgents).length)
  const room = layout === 'wide' ? Math.max(spare, traceH) : spare - traceH - GAP
  return Math.max(4, Math.min(40, Math.floor((room - LOG_HEAD - 10) / ROW_H)))
}
