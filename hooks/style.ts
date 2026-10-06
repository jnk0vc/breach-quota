// ── 配色 ────────────────────────────────────────────────
// 赤みを帯びた黒の地に、サーモンレッドの枠と見出し。数値は状態で塗り分け、
// 平常はシアン、注意は黄、危険は赤にする。黄はヘッダー帯にも使う

export const VOID = '#0A0608'
export const PANEL = '#140A0D'
export const HUD = '#FF5F57'
export const HUD_DIM = '#7A2A2A'
export const HUD_DARK = '#3A1418'
export const CYAN = '#3FF2E8'
export const YELLOW = '#F2E600'
export const HOT = '#FF2244'
export const BONE = '#E8E2D5'

export type Tone = 'nominal' | 'caution' | 'critical'

export const TONE_INK: Record<Tone, string> = { nominal: CYAN, caution: YELLOW, critical: HOT }
export const TONE_FRAME: Record<Tone, string> = { nominal: HUD, caution: YELLOW, critical: HOT }

// 残量と見込みから色を決める。上から順に、最初に当てはまったもの
export const toneOf = (left: number | undefined, isDanger: boolean, isOverdraw = false): Tone => {
  if (isDanger || (left !== undefined && left < 20)) return 'critical'
  if (isOverdraw || (left !== undefined && left <= 50)) return 'caution'
  return 'nominal'
}

// ── 書体 ────────────────────────────────────────────────

const COND = "'DIN Condensed','Bahnschrift Condensed','Bahnschrift','Arial Narrow','Helvetica Neue',sans-serif"
const LABEL = "'DIN Alternate','Bahnschrift','Helvetica Neue',Arial,sans-serif"
const GOTHIC = "'Hiragino Kaku Gothic StdN','Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic','Noto Sans JP',sans-serif"
const MONO = "'SF Mono',Menlo,Consolas,'DejaVu Sans Mono',monospace"

export type Face = 'cond' | 'label' | 'gothic' | 'mono'

const FACES: Record<Face, string> = { cond: COND, label: LABEL, gothic: GOTHIC, mono: MONO }

// ── レイアウト ──────────────────────────────────────────
// wide: 計器3基を横に並べ、トレースの右にログ。medium / narrow: 縦に積む

export type Layout = 'wide' | 'medium' | 'narrow'

export const layoutOf = (drawWidth: number): Layout =>
  drawWidth >= 900 ? 'wide' : drawWidth >= 440 ? 'medium' : 'narrow'

export const VIEW_W: Record<Layout, number> = { wide: 1228, medium: 600, narrow: 400 }

// 動くSVGは枠(iframe)の中に宣言どおりの大きさで描かれ、枠の幅に合わせて縮まない。
// パネルのセル数からピクセル幅を見積もり、幅と高さを明示する。はみ出すと右が切れるので少し小さめに見積もる
const CELL_PX = 7.6

export const drawWidthOf = (bodyColumns: number): number => Math.max(240, Math.floor(bodyColumns * CELL_PX))

const ROW_PX = 18

export const paneHeightOf = (bodyRows: number): number => Math.max(300, bodyRows * ROW_PX)

export const svgSize = (drawWidth: number, viewWidth: number, viewHeight: number) => ({
  width: drawWidth,
  height: Math.round((drawWidth * viewHeight) / viewWidth),
})

// ── 文字 ────────────────────────────────────────────────

export const xml = (body: string): string =>
  body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const clip = (body: string, max: number): string =>
  body.length > max ? `${body.slice(0, Math.max(0, max - 1))}…` : body

// 1文字の描画幅の見積もり。漢字・かなは文字の大きさと同じ、英数字は書体ごとの割合
const RATIO: Record<Face, number> = { cond: 0.46, label: 0.62, gothic: 0.62, mono: 0.61 }

export const widthOf = (body: string, size: number, face: Face = 'gothic'): number =>
  [...body].reduce((sum, char) => sum + ((char.codePointAt(0) ?? 0) >= 0x2e80 ? size : size * RATIO[face]), 0)

// 幅に収まらなければ末尾を「…」にする
export const fitText = (body: string, size: number, maxWidth: number, face: Face = 'gothic'): string => {
  if (widthOf(body, size, face) <= maxWidth) return body
  const chars = [...body]
  while (chars.length > 0 && widthOf(`${chars.join('')}…`, size, face) > maxWidth) chars.pop()
  return `${chars.join('')}…`
}

type TextOptions = {
  anchor?: 'start' | 'middle' | 'end'
  face?: Face
  weight?: number
  spacing?: number
  opacity?: number
  extra?: string
}

// 書体の属性。同じ書体の文字が多いところでは、親の<g>に1回だけ付けて1枚のSVGの文字数を抑える
export const fontAttrs = (face: Face, size: number, weight: number): string =>
  `font-family="${FACES[face]}" font-size="${size}" font-weight="${weight}"${face === 'cond' ? ' font-stretch="condensed"' : ''}`

// 書体を親から受け継ぐ文字
export const glyph = (x: number, y: number, body: string, extra = ''): string => `<text x="${x}" y="${y}"${extra}>${body}</text>`

// bodyはエスケープ済みの文字列を渡す
export const text = (x: number, y: number, size: number, fill: string, body: string, options: TextOptions = {}): string => {
  const { anchor = 'start', face = 'gothic', weight = 700, spacing, opacity, extra = '' } = options
  return `<text x="${x}" y="${y}" ${fontAttrs(face, size, weight)} fill="${fill}" text-anchor="${anchor}"${spacing === undefined ? '' : ` letter-spacing="${spacing}"`}${opacity === undefined ? '' : ` opacity="${opacity}"`}${extra}>${body}</text>`
}

// 英字の見出しと、その右に小さく添える日本語
export const heading = (x: number, y: number, english: string, japanese: string, color: string, size = 13): string =>
  `${text(x, y, size, color, english, { face: 'label', weight: 800, spacing: 1.6 })}${text(
    x + widthOf(english, size, 'label') + english.length * 1.6 + 8,
    y,
    size * 0.72,
    color,
    japanese,
    { weight: 600, opacity: 0.75 },
  )}`

// ── 形 ──────────────────────────────────────────────────

// 右上と左下の角を斜めに落とした板
export const chamfer = (x: number, y: number, w: number, h: number, cut: number): string =>
  `M${x} ${y}H${x + w - cut}L${x + w} ${y + cut}V${y + h}H${x + cut}L${x} ${y + h - cut}Z`

// 計器の板。左上に太い差し色、右下に小さな角当てを付ける
export const plate = (x: number, y: number, w: number, h: number, frame: string, cut = 14): string =>
  `<path d="${chamfer(x, y, w, h, cut)}" fill="${PANEL}" stroke="${frame}" stroke-width="1" stroke-opacity="0.7"/>
  <rect x="${x}" y="${y}" width="${Math.min(56, w / 4)}" height="3" fill="${frame}"/>
  <rect x="${x + w - 22}" y="${y + h - 4}" width="16" height="4" fill="${frame}" opacity="0.8"/>`

// 塗りの付いたラベル箱。activeなら塗り、そうでなければ枠だけ
export const lamp = (x: number, y: number, w: number, h: number, label: string, color: string, isOn: boolean, size = 9): string =>
  `<path d="${chamfer(x, y, w, h, 4)}" fill="${isOn ? color : 'none'}" stroke="${isOn ? color : HUD_DARK}" stroke-width="1"/>
  ${text(x + w / 2, y + h / 2 + size * 0.36, size, isOn ? VOID : HUD_DIM, label, { anchor: 'middle', face: 'label', weight: 800, spacing: 1 })}`

// ── 共通の定義 ──────────────────────────────────────────

// ── ブラウン管 ──────────────────────────────────────────
// カラーのブラウン管に見立てる。走査線と管面の周辺減光を全面に重ね、大きな数字には
// 赤とシアンの色ずれ(コンバージェンスのずれ)とにじみを付ける。
// 走査帯は再描画の少ない計器のSVGだけに流す。描き直しの多いSVGでは途中から流れ直してしまう

// 赤の成分を左へ、緑と青の成分を右へずらして重ね、ぼかした光を下に敷く
const CRT_FILTER = `<filter id="crt" x="-6%" y="-20%" width="112%" height="140%">
  <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" result="glow"/>
  <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="red"/>
  <feOffset in="red" dx="-1.3" result="redShift"/>
  <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0" result="cyan"/>
  <feOffset in="cyan" dx="1.3" result="cyanShift"/>
  <feBlend in="redShift" in2="cyanShift" mode="screen" result="split"/>
  <feMerge><feMergeNode in="glow"/><feMergeNode in="split"/></feMerge>
</filter>`

// 圧縮予備域の斜線と、ブラウン管の効果。グリッチと走査帯はCSSで動かし、動きを減らす設定では止める
const ROLL_H = 90

// 走査帯は上から下へ6秒で抜け、3秒あけてまた流れる
const rollStyle = (height: number): string =>
  `.roll { animation: roll 9s linear infinite; }
  @keyframes roll { 0% { transform: translateY(${-ROLL_H}px); } 66%, 100% { transform: translateY(${height}px); } }`

export const defs = (rollHeight?: number): string =>
  `<defs>
  <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="6" fill="${YELLOW}" opacity="0.22"/></pattern>
  <pattern id="scan" width="8" height="3" patternUnits="userSpaceOnUse"><rect width="8" height="1" fill="#000" opacity="0.3"/></pattern>
  <radialGradient id="tube" cx="50%" cy="50%" r="72%"><stop offset="68%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.36"/></radialGradient>
  <linearGradient id="roll" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BONE}" stop-opacity="0"/><stop offset="0.7" stop-color="${BONE}" stop-opacity="0.07"/><stop offset="1" stop-color="${BONE}" stop-opacity="0"/></linearGradient>
  ${CRT_FILTER}
</defs>
<style>
  .glitch-r, .glitch-c { opacity: 0; animation: split 5.3s steps(1) infinite; }
  .glitch-c { animation-delay: 0.07s; }
  @keyframes split {
    0%, 93% { opacity: 0; transform: translate(0, 0); }
    94% { opacity: 0.8; transform: translate(-3px, 1px); }
    96% { opacity: 0.8; transform: translate(4px, -1px); }
    98% { opacity: 0.6; transform: translate(-1px, 0); }
  }
  .blink { animation: blink 0.9s steps(2, jump-none) infinite; }
  @keyframes blink { 50% { opacity: 0.2; } }
  ${rollHeight === undefined ? '' : rollStyle(rollHeight)}
  @media (prefers-reduced-motion: reduce) {
    .glitch-r, .glitch-c { animation: none; opacity: 0; }
    .blink { animation: none; }
    .roll { animation: none; display: none; }
  }
</style>`

// 同じ図形を赤とシアンでずらして重ね、ときどき走るグリッチにする
export const glitch = (body: string): string =>
  `<g class="glitch-r" style="mix-blend-mode:screen" fill="${HOT}">${body}</g><g class="glitch-c" style="mix-blend-mode:screen" fill="${CYAN}">${body}</g>`

// roll: 走査帯を流す。tube: 管面の周辺減光を重ねる(横に細長い帯では両端が暗く沈むので外す)
export const svgDocument = (
  width: number,
  height: number,
  drawWidth: number,
  body: string,
  options: { roll?: boolean; tube?: boolean } = {},
) => {
  const { roll: isRolling = false, tube: hasTube = true } = options
  const size = svgSize(drawWidth, width, height)
  // 走査帯は初めは画面の上に隠しておき、CSSが効かない環境では出さない
  const roll = isRolling
    ?`<rect class="roll" x="0" y="0" width="${width}" height="${ROLL_H}" fill="url(#roll)" transform="translate(0 ${-ROLL_H})" style="mix-blend-mode:screen"/>`
    : ''
  // 基と基のすき間が透けると枠(iframe)の白い地が見えるので、全面を地の色で塗る
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${size.width}" height="${size.height}" style="background:${VOID}">
  <rect width="${width}" height="${height}" fill="${VOID}"/>
  ${defs(isRolling ? height : undefined)}
  ${body}
  <g pointer-events="none">${roll}<rect width="${width}" height="${height}" fill="url(#scan)"/>${hasTube ? `<rect width="${width}" height="${height}" fill="url(#tube)"/>` : ''}</g>
</svg>`
  return { source, ...size }
}

export const kilo = (tokens: number): string =>
  tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1)}M`
    : tokens >= 1000
      ? `${Math.round(tokens / 1000)}k`
      : String(Math.round(tokens))
