import type { ContextGauge, Limit, MemoryMap, MemorySlice } from '../types'
import {
  BONE,
  CYAN,
  HUD,
  HUD_DARK,
  HUD_DIM,
  TONE_FRAME,
  TONE_INK,
  VIEW_W,
  VOID,
  YELLOW,
  fitText,
  fontAttrs,
  glitch,
  glyph,
  heading,
  kilo,
  lamp,
  plate,
  svgDocument,
  text,
  toneOf,
  widthOf,
  xml,
} from './style'
import type { Layout, Tone } from './style'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const SLOTS = 3

// ── 利用枠の読み取り ─────────────────────────────────────

export const labelOf = (kind: string): string => {
  if (kind === 'five_hour') return '5時間枠'
  if (kind === 'spend_limit') return '利用上限額'
  const model = /fable|opus|sonnet|haiku/i.exec(kind)?.[0]
  if (model) return `${model[0]!.toUpperCase()}${model.slice(1).toLowerCase()}週次`
  if (kind.startsWith('seven_day')) return '週次'
  return kind
}

const englishOf = (kind: string): string => {
  if (kind === 'five_hour') return 'FIVE-HOUR'
  if (kind === 'spend_limit') return 'SPEND LIMIT'
  const model = /fable|opus|sonnet|haiku/i.exec(kind)?.[0]
  if (model) return `${model.toUpperCase()} WEEKLY`
  return kind.startsWith('seven_day') ? 'WEEKLY' : kind.toUpperCase()
}

// 枠の長さを表すRAM番号。5時間枠はRAM.05H、週次はRAM.07D、モデル別の週次は頭文字を足す
const codeOf = (kind: string): string => {
  if (kind === 'five_hour') return 'RAM.05H'
  if (kind === 'spend_limit') return 'RAM.USD'
  const model = /fable|opus|sonnet|haiku/i.exec(kind)?.[0]
  if (kind.startsWith('seven_day')) return model ? `RAM.07D-${model[0]!.toUpperCase()}` : 'RAM.07D'
  return 'RAM.XX'
}

const windowMs = (kind: string): number | undefined =>
  kind === 'five_hour' ? 5 * HOUR : kind.startsWith('seven_day') ? 7 * DAY : undefined

const resetOf = (limit: Limit): number | undefined => {
  const at = limit.resetsAt ? Date.parse(limit.resetsAt) : Number.NaN
  return Number.isNaN(at) ? undefined : at
}

export type Mode = 'flatline' | 'cool' | 'stable' | 'overdraw'

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'flatline', label: 'FLATLINE' },
  { mode: 'cool', label: 'COOL' },
  { mode: 'stable', label: 'STABLE' },
  { mode: 'overdraw', label: 'OVERDRAW' },
]

export const modeLabel = (mode: Mode): string => MODES.find(one => one.mode === mode)?.label ?? mode

type Reading = {
  mode: Mode
  // 数え下ろす残り時間。undefinedなら「--:--」
  ms: number | undefined
  isDanger: boolean
  caption: string
  captionEn: string
  // 数値が何を数えているかの注記
  note: string
}

// 枠の開始からの消費ペースで、FLATLINE・COOL・STABLE・OVERDRAWの4段階に振り分ける
export const readingOf = (limit: Limit, now: number): Reading => {
  const reset = resetOf(limit)
  const untilReset = reset === undefined ? undefined : Math.max(0, reset - now)
  if (limit.percentUsed >= 100) {
    return {
      mode: 'flatline',
      ms: 0,
      isDanger: true,
      caption: '停止中',
      captionEn: 'FLATLINED',
      note: '// 枠のリセットまで使えません',
    }
  }
  const recharge = { caption: '再充填まで', captionEn: 'RECHARGE IN', note: '// 今のペースならリセットまで持ちます' }
  const length = windowMs(limit.kind)
  const elapsed = reset !== undefined && length !== undefined ? now - (reset - length) : undefined
  if (elapsed !== undefined && elapsed >= 60_000 && limit.percentUsed > 0 && reset !== undefined) {
    // 同じペースで使い続けたときに100%に達する時刻
    const hitAt = now + ((100 - limit.percentUsed) / limit.percentUsed) * elapsed
    if (hitAt < reset) {
      const ms = hitAt - now
      return {
        mode: 'overdraw',
        ms,
        isDanger: ms < 30 * 60_000 || limit.percentUsed >= 90,
        caption: '枯渇まで',
        captionEn: 'BURNOUT IN',
        note: '// 今のペースで使い切るまでの見込み',
      }
    }
    // 枠の経過割合に対して、使用率がその半分に満たなければCOOL
    const pace = limit.percentUsed / ((elapsed / length!) * 100)
    return { mode: pace < 0.5 ? 'cool' : 'stable', ms: untilReset, isDanger: limit.percentUsed >= 90, ...recharge }
  }
  return { mode: 'stable', ms: untilReset, isDanger: limit.percentUsed >= 90, ...recharge }
}

const limitTone = (limit: Limit, reading: Reading): Tone =>
  toneOf(Math.max(0, 100 - limit.percentUsed), reading.isDanger || reading.mode === 'flatline', reading.mode === 'overdraw')

export const untilText = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `あと${days}日${hours}時間`
  return hours > 0 ? `あと${hours}時間${minutes % 60}分` : `あと${minutes % 60}分`
}

// ── 数え下ろしの数字 ─────────────────────────────────────
// 再描画せずに秒を進めるため、桁ごとに0〜9の文字を重ね、見せる文字をSMILの離散アニメーションで切り替える。
// 1桁は「周期periodの中で、stepごとに値が変わる」と考える。周期の中の残り秒rから表示する数字を返すのがdigitOf。
// discreteでkeyTimesを省くと、周期がvaluesの数で等分される

const BIG = { size: 58, pitch: 30 }
const SMALL = { size: 30, pitch: 16 }
const COLON_W = 12

// xは桁の中心
const counting = (seconds: number, period: number, step: number, digitOf: (r: number) => number, x: number): string => {
  const steps = period / step
  // 区間iは、周期の中の残り秒が period-1-i*step から始まる
  const shown = Array.from({ length: steps }, (_, i) => digitOf(period - 1 - i * step))
  const offset = period - 1 - (seconds % period)
  const unique = [...new Set(shown)]
  if (unique.length === 1) return glyph(x, 0, String(unique[0]))
  return unique
    .map(digit => {
      const values = shown.map(one => (one === digit ? 'visible' : 'hidden')).join(';')
      return glyph(
        x,
        0,
        `${digit}<animate attributeName="visibility" calcMode="discrete" values="${values}" dur="${period}s" begin="${-offset}s" repeatCount="indefinite"/>`,
        ' visibility="hidden"',
      )
    })
    .join('')
}

// 「時:分」を大きく、「:秒」を小さく組む。1日以上あれば頭に「6D」を付ける
const clockOf = (ms: number | undefined, fill: string): string => {
  const seconds = ms === undefined ? undefined : Math.max(0, Math.floor(ms / 1000))
  const hasDays = seconds !== undefined && seconds >= 86400
  const big: string[] = []
  const small: string[] = []
  let cursor = 0
  const slot = (draw: (center: number) => string): void => {
    big.push(draw(cursor + BIG.pitch / 2))
    cursor += BIG.pitch
  }
  const dash = (center: number): string => glyph(center, 0, '-')
  if (hasDays) {
    slot(c => counting(seconds!, 864_000, 86_400, r => Math.floor(r / 86_400), c))
    big.push(glyph(cursor + 1, -2, 'D', ' font-size="26" text-anchor="start" opacity="0.8"'))
    cursor += 22
  }
  if (seconds === undefined) {
    slot(dash)
    slot(dash)
  } else {
    slot(c => counting(seconds, 86_400, 3600, r => Math.floor(Math.floor(r / 3600) / 10), c))
    slot(c => counting(seconds, 86_400, 3600, r => Math.floor(r / 3600) % 10, c))
  }
  big.push(glyph(cursor + COLON_W / 2, -3, ':'))
  cursor += COLON_W
  if (seconds === undefined) {
    slot(dash)
    slot(dash)
  } else {
    slot(c => counting(seconds, 3600, 600, r => Math.floor(r / 600), c))
    slot(c => counting(seconds, 600, 60, r => Math.floor(r / 60) % 10, c))
  }
  small.push(glyph(cursor + 4, -2, ':'))
  cursor += 8
  const first = cursor + SMALL.pitch / 2
  const second = cursor + SMALL.pitch * 1.5
  if (seconds === undefined) {
    small.push(dash(first), dash(second))
  } else {
    small.push(
      counting(seconds, 60, 10, r => Math.floor(r / 10), first),
      counting(seconds, 10, 1, r => r % 10, second),
    )
  }
  const attrs = (size: number): string => `${fontAttrs('cond', size, 700)} text-anchor="middle" fill="${fill}"`
  const digits = `<g ${attrs(BIG.size)}>${big.join('')}</g><g ${attrs(SMALL.size)}>${small.join('')}</g>`
  const p = BIG.pitch
  const zeros = `<g ${attrs(BIG.size)}>${glyph(p / 2, 0, '0')}${glyph(p * 1.5, 0, '0')}${glyph(2 * p + COLON_W / 2, -3, ':')}${glyph(2 * p + COLON_W + p / 2, 0, '0')}${glyph(3 * p + COLON_W + p / 2, 0, '0')}</g>`
  if (seconds === undefined) return digits
  if (seconds === 0) return `<g class="blink">${zeros}</g>`
  // 0に達したら数え下ろしを止め、0を点滅させる
  const zero = `<g display="none"><set attributeName="display" to="inline" begin="${seconds}s"/><g class="blink">${zeros}</g></g>`
  return `<g>${digits}<set attributeName="display" to="none" begin="${seconds}s"/></g>${zero}`
}

// ── RAMブロック ─────────────────────────────────────────
// 残量を20個の平行四辺形で示す。残りの最後の1個は、危険なとき点滅させる

const RAM_BLOCKS = 20

const ramBar = (x: number, y: number, w: number, h: number, ratio: number, tone: Tone): string => {
  const gap = 3
  const bw = (w - (RAM_BLOCKS - 1) * gap - 4) / RAM_BLOCKS
  const lit = Math.max(0, Math.min(RAM_BLOCKS, Math.round(ratio * RAM_BLOCKS)))
  return Array.from({ length: RAM_BLOCKS }, (_, i) => {
    const left = x + i * (bw + gap)
    const isLit = i < lit
    const blink = isLit && i === lit - 1 && tone === 'critical' ? ' class="blink"' : ''
    return `<polygon points="${left + 4},${y} ${left + bw + 4},${y} ${left + bw},${y + h} ${left},${y + h}" fill="${isLit ? TONE_INK[tone] : HUD_DARK}"${blink}/>`
  }).join('')
}

// ── 利用枠の計器 ────────────────────────────────────────

const TIMER_H = 200

const timerModule = (limit: Limit, now: number, x: number, y: number, w: number, h: number): string => {
  const reading = readingOf(limit, now)
  const tone = limitTone(limit, reading)
  const ink = TONE_INK[tone]
  const frame = TONE_FRAME[tone]
  const left = Math.max(0, 100 - limit.percentUsed)
  const reset = resetOf(limit)
  const code = codeOf(limit.kind)
  const codeW = widthOf(code, 10, 'label') + code.length + 14
  const clock = clockOf(reading.ms, ink)
  const percent = `${Math.round(left)}%`
  const percentSvg = text(w - 16, 108, 44, tone === 'critical' ? 'inherit' : ink, percent, { anchor: 'end', face: 'cond', weight: 700 })
  const lampW = (w - 28 - 3 * 6) / 4
  const footer = reset === undefined ? '' : `RESET ${untilText(reset - now)}`
  return `<g transform="translate(${x} ${y})">
  ${plate(0, 0, w, h, frame)}
  ${heading(14, 26, englishOf(limit.kind), labelOf(limit.kind), HUD)}
  <path d="M${w - 14 - codeW} 12H${w - 14}V${30}H${w - 14 - codeW + 6}L${w - 14 - codeW} ${24}Z" fill="${frame}"/>
  ${text(w - 21, 25, 10, VOID, code, { anchor: 'end', face: 'label', weight: 800, spacing: 1 })}
  ${text(14, 50, 10, ink, reading.captionEn, { face: 'label', weight: 800, spacing: 2.4 })}${text(14 + widthOf(reading.captionEn, 10, 'label') + reading.captionEn.length * 2.4 + 6, 50, 9, ink, reading.caption, { weight: 600, opacity: 0.8 })}
  <g transform="translate(14 108)" filter="url(#crt)">${clock}</g>
  ${text(w - 16, 64, 9, HUD_DIM, 'RAM LEFT', { anchor: 'end', face: 'label', weight: 800, spacing: 2 })}
  ${tone === 'critical' ? `<g fill="${ink}" filter="url(#crt)">${percentSvg}</g>${glitch(percentSvg)}` : `<g filter="url(#crt)">${percentSvg}</g>`}
  ${ramBar(14, 122, w - 28, 14, left / 100, tone)}
  ${text(14, 156, 9.5, CYAN, reading.note, { weight: 600 })}
  ${footer === '' ? '' : text(w - 14, 156, 9, HUD_DIM, footer, { anchor: 'end', weight: 600 })}
  ${MODES.map(({ mode, label }, i) => lamp(14 + i * (lampW + 6), 170, lampW, 18, label, frame, reading.mode === mode)).join('')}
</g>`
}

// ── 記憶マトリクス ──────────────────────────────────────
// コンテキストの窓を16進バイトの格子で描く。1マスが窓の一定量に当たり、使用中のマスは内訳の色で、
// 圧縮予備域は斜線で塗る。使用の端(次に埋まるマス)にカーソルを置き、その列を帯で照らす

const SLICE_NAMES: Record<string, string> = {
  'System prompt': 'システムプロンプト',
  'System tools': '標準ツール',
  'MCP tools': 'MCPツール',
  'MCP server instructions': 'MCPサーバー説明',
  'Custom agents': 'エージェント定義',
  'Memory files': 'メモリファイル',
  Skills: 'スキル',
  Messages: '会話',
  'Free space': '空き',
  'Autocompact buffer': '圧縮予備域',
  Used: '使用中',
}

export const sliceName = (slice: MemorySlice): string => SLICE_NAMES[slice.name] ?? slice.name

const USED_COLORS = [CYAN, YELLOW, '#FF8A7A', '#B78CFF', BONE, '#7CFFB2', '#FF6AD5', '#6FA8FF']

type Painted = { slice: MemorySlice; color: string }

// 使用中を大きい順に、そのあとに空き、最後に圧縮予備域
const ordered = (memory: MemoryMap): Painted[] => {
  const used = memory.slices
    .filter(one => one.kind === 'used' && one.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .map((slice, i) => ({ slice, color: USED_COLORS[i % USED_COLORS.length]! }))
  const free = memory.slices.filter(one => one.kind === 'free').map(slice => ({ slice, color: HUD_DARK }))
  const buffer = memory.slices.filter(one => one.kind === 'buffer').map(slice => ({ slice, color: YELLOW }))
  return [...used, ...free, ...buffer]
}

export const memoryFrom = (context: ContextGauge | null): MemoryMap | null => {
  if (context === null || context.window <= 0) return null
  const used = context.tokens ?? (context.percent === undefined ? undefined : (context.percent / 100) * context.window)
  if (used === undefined) return null
  return {
    slices: [
      { name: 'Used', tokens: used, kind: 'used' },
      { name: 'Free space', tokens: Math.max(0, context.window - used), kind: 'free' },
    ],
    used,
    max: context.window,
    percentage: (used / context.window) * 100,
  }
}

const STAGES = [
  { label: 'NOMINAL', below: 60 },
  { label: 'CAUTION', below: 80 },
  { label: 'CRITICAL', below: 95 },
  { label: 'FULL', below: Number.POSITIVE_INFINITY },
]

export const stageOf = (memory: MemoryMap | null): string | undefined =>
  memory === null ? undefined : STAGES.find(one => memory.percentage < one.below)?.label

export const memoryTone = (memory: MemoryMap | null): Tone =>
  memory === null ? 'nominal' : toneOf(Math.max(0, 100 - memory.percentage), memory.percentage >= 80)

// マスの番号から決まる、見た目だけの16進バイト
const byteOf = (i: number): string =>
  ((Math.imul(i + 7, 2654435761) >>> 13) & 0xff).toString(16).padStart(2, '0').toUpperCase()

// 各マスの中心が、並べた内訳のどこに落ちるかで塗る
const paintCells = (memory: MemoryMap, count: number): (Painted | undefined)[] => {
  const list = ordered(memory)
  const total = list.reduce((sum, one) => sum + one.slice.tokens, 0)
  if (total <= 0) return Array.from({ length: count }, () => undefined)
  const ends: number[] = []
  list.reduce((sum, one) => {
    ends.push(sum + one.slice.tokens)
    return sum + one.slice.tokens
  }, 0)
  return Array.from({ length: count }, (_, i) => {
    const middle = ((i + 0.5) / count) * total
    const at = ends.findIndex(end => middle < end)
    return list[at === -1 ? list.length - 1 : at]
  })
}

const CELL_W = 26
const CELL_H = 19
const LEGEND_ROW = 15

type MatrixShape = { rows: number; legendColumns: number; legendCap: number }

// 凡例に載せる内訳。収まらないときは小さい使用中から削り、空きと圧縮予備域は必ず残す
const legendOf = (memory: MemoryMap, cap: number): Painted[] => {
  const list = ordered(memory)
  if (list.length <= cap) return list
  const rest = list.filter(one => one.slice.kind !== 'used')
  return [...list.filter(one => one.slice.kind === 'used').slice(0, Math.max(0, cap - rest.length)), ...rest]
}

const matrixHeight = (memory: MemoryMap | null, shape: MatrixShape): number => {
  const legendCount = memory === null ? 0 : legendOf(memory, shape.legendCap).length
  return 40 + shape.rows * CELL_H + 12 + Math.ceil(legendCount / shape.legendColumns) * LEGEND_ROW + 50
}

const matrixModule = (memory: MemoryMap | null, x: number, y: number, w: number, h: number, shape: MatrixShape): string => {
  const tone = memoryTone(memory)
  const frame = TONE_FRAME[tone]
  const ink = TONE_INK[tone]
  const cols = Math.floor((w - 28) / CELL_W)
  const count = cols * shape.rows
  const gridX = 14 + (w - 28 - cols * CELL_W) / 2
  const gridY = 40
  const painted = memory === null ? Array.from({ length: count }, () => undefined) : paintCells(memory, count)
  const usedCells = painted.filter(one => one?.slice.kind === 'used').length
  const cells = painted
    .map((one, i) => {
      const cx = gridX + (i % cols) * CELL_W
      const cy = gridY + Math.floor(i / cols) * CELL_H
      const kind = one?.slice.kind
      const ground =
        kind === 'used'
          ? `<rect x="${cx + 1}" y="${cy + 1}" width="${CELL_W - 2}" height="${CELL_H - 2}" fill="${one!.color}" opacity="0.16"/>`
          : kind === 'buffer'
            ? `<rect x="${cx + 1}" y="${cy + 1}" width="${CELL_W - 2}" height="${CELL_H - 2}" fill="url(#hatch)"/>`
            : ''
      const ink = kind === 'used' ? one!.color : kind === 'buffer' ? YELLOW : HUD_DARK
      const look = `${kind === 'used' ? ' font-weight="700"' : ''}${kind === 'buffer' ? ' opacity="0.6"' : ''}`
      return `${ground}${glyph(cx + CELL_W / 2, cy + 13.5, byteOf(i), ` fill="${ink}"${look}`)}`
    })
    .join('')
  // 次に埋まるマスにカーソル。使い切っていれば出さない
  const cursor =
    memory === null || usedCells >= count
      ? ''
      : (() => {
          const cx = gridX + (usedCells % cols) * CELL_W
          const cy = gridY + Math.floor(usedCells / cols) * CELL_H
          return `<rect x="${cx}" y="${gridY}" width="${CELL_W}" height="${shape.rows * CELL_H}" fill="${CYAN}" opacity="0.08"/>
  <rect x="${cx + 0.5}" y="${cy + 0.5}" width="${CELL_W - 1}" height="${CELL_H - 1}" fill="none" stroke="${CYAN}" stroke-width="1.5" class="blink"/>`
        })()
  const legendTop = gridY + shape.rows * CELL_H + 12 + 10
  const legendW = (w - 28) / shape.legendColumns
  const legend =
    memory === null
      ? ''
      : legendOf(memory, shape.legendCap).map(({ slice, color }, i) => {
            const lx = 14 + (i % shape.legendColumns) * legendW
            const ly = legendTop + Math.floor(i / shape.legendColumns) * LEGEND_ROW
            const amount = kilo(slice.tokens)
            const room = legendW - 14 - widthOf(amount, 9, 'mono') - 12
            const swatch =
              slice.kind === 'buffer'
                ? `<rect x="${lx}" y="${ly - 8}" width="8" height="8" fill="url(#hatch)" stroke="${YELLOW}" stroke-width="0.8"/>`
                : `<rect x="${lx}" y="${ly - 8}" width="8" height="8" fill="${color}"/>`
            return `${swatch}${text(lx + 13, ly, 10, slice.kind === 'used' ? BONE : HUD_DIM, xml(fitText(sliceName(slice), 10, room)))}${text(lx + legendW - 10, ly, 9, HUD_DIM, amount, { anchor: 'end', face: 'mono', weight: 500 })}`
          })
          .join('')
  const stage = stageOf(memory)
  const lampsY = h - 30
  const lampW = (w - 28 - 3 * 6) / 4
  const summary = memory === null ? 'AWAITING SCAN' : `${Math.round(memory.percentage)}% ／ ${kilo(memory.max)}`
  const note =
    memory === null ? '// 次の応答のあとで計測します' : '// 使用が斜線の圧縮予備域に達すると、自動で圧縮されます'
  return `<g transform="translate(${x} ${y})">
  ${plate(0, 0, w, h, frame)}
  ${heading(14, 26, 'MEMORY MATRIX', 'コンテキスト', HUD)}
  ${text(w - 14, 27, 18, ink, summary, { anchor: 'end', face: 'cond', weight: 700 })}
  <g ${fontAttrs('mono', 10.5, 500)} text-anchor="middle">${cells}</g>${cursor}
  ${legend}
  ${text(14, lampsY - 9, 9.5, CYAN, note, { weight: 600 })}
  ${STAGES.map(({ label }, i) => lamp(14 + i * (lampW + 6), lampsY, lampW, 18, label, frame, stage === label)).join('')}
</g>`
}

// ── 組み立て ────────────────────────────────────────────

const GAP = 14
const MODULE_W = 400

// 利用枠の計器と記憶マトリクスを並べる。
// wide: 計器を横に並べ、空いた基に記憶マトリクス。3基とも埋まっていれば下に全幅で置く
// medium / narrow: 計器を縦に積み、その下に記憶マトリクス
export const powerSvg = (
  limits: readonly Limit[],
  memory: MemoryMap | null,
  now: number,
  layout: Layout,
  drawWidth: number,
): { source: string; width: number; height: number } => {
  const shown = limits.slice(0, SLOTS)
  const width = VIEW_W[layout]
  let body: string
  let height: number
  if (layout === 'wide' && shown.length < SLOTS) {
    const shape = { rows: 5, legendColumns: 2, legendCap: 6 }
    const rowH = Math.max(TIMER_H, matrixHeight(memory, shape))
    body =
      shown.map((limit, i) => timerModule(limit, now, i * (MODULE_W + GAP), 0, MODULE_W, rowH)).join('') +
      matrixModule(memory, shown.length * (MODULE_W + GAP), 0, MODULE_W, rowH, shape)
    height = rowH
  } else if (layout === 'wide') {
    const shape = { rows: 4, legendColumns: 4, legendCap: 12 }
    const mapH = matrixHeight(memory, shape)
    body =
      shown.map((limit, i) => timerModule(limit, now, i * (MODULE_W + GAP), 0, MODULE_W, TIMER_H)).join('') +
      matrixModule(memory, 0, TIMER_H + GAP, width, mapH, shape)
    height = TIMER_H + GAP + mapH
  } else {
    const shape = { rows: 6, legendColumns: layout === 'medium' ? 3 : 2, legendCap: 12 }
    const mapH = matrixHeight(memory, shape)
    const pitch = TIMER_H + GAP
    body =
      shown.map((limit, i) => timerModule(limit, now, 0, i * pitch, width, TIMER_H)).join('') +
      matrixModule(memory, 0, shown.length * pitch, width, mapH, shape)
    height = shown.length * pitch + mapH
  }
  // 計器のSVGは起点が動いたときしか描き直さないので、走査帯を流しても途中で巻き戻らない
  return svgDocument(width, height, drawWidth, body, { roll: true })
}

// Svgのないターミナル向け。同じ内容を文字で並べる
export const powerRows = (
  limits: readonly Limit[],
  memory: MemoryMap | null,
  now: number,
): { text: string; color: string }[] => {
  const rows = limits.map(limit => {
    const reading = readingOf(limit, now)
    const left = Math.max(0, 100 - limit.percentUsed)
    const lit = Math.round((left / 100) * RAM_BLOCKS)
    const ms = reading.ms ?? 0
    const time = `${Math.floor(ms / HOUR)}:${String(Math.floor((ms % HOUR) / 60_000)).padStart(2, '0')}`
    return {
      text: `${labelOf(limit.kind)} ${'▰'.repeat(lit)}${'▱'.repeat(RAM_BLOCKS - lit)} 残${Math.round(left)}% ${reading.caption} ${time} [${modeLabel(reading.mode)}]`,
      color: TONE_INK[limitTone(limit, reading)],
    }
  })
  if (memory !== null) {
    const top = ordered(memory)
      .filter(one => one.slice.kind === 'used')
      .slice(0, 3)
      .map(one => `${sliceName(one.slice)} ${kilo(one.slice.tokens)}`)
      .join(' ')
    rows.push({
      text: `コンテキスト 使用${Math.round(memory.percentage)}% ${kilo(memory.used)} / ${kilo(memory.max)} [${stageOf(memory)}] ${top}`,
      color: TONE_INK[memoryTone(memory)],
    })
  }
  return rows
}

// 警告帯に出すべき、使用率90%以上で最も逼迫した枠
export const critical = (limits: readonly Limit[]): Limit | undefined =>
  limits.filter(one => one.percentUsed >= 90).sort((a, b) => b.percentUsed - a.percentUsed)[0]

export const resetIn = (limit: Limit, now: number): string | undefined => {
  const reset = resetOf(limit)
  return reset === undefined ? undefined : untilText(reset - now)
}
