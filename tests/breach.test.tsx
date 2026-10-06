import { expect, mock, test } from 'claude-code/testing'

const PANE_PROPS = {
  title: 'BREACH QUOTA',
  isFocused: false,
  bodyColumns: 48,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 3,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 3 },
  view: {},
} as const

const PANE = { plugin: 'breach-quota', component: 'Pane', requestId: 'breach-deck' } as const

test('Bash実行中はEXECの帯が出て、終わると消える', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  // 警告がないとき帯はエンジン既定の描画に譲るので、その代役を置く
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  let finish = () => {}
  on('tool.call', () => new Promise(resolve => (finish = () => resolve({ result: 'ok' }))))

  const running = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'breach-quota', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ text: /EXEC 実行中/ })).toBeDefined()
    expect(await band.find({ text: /npm test/ })).toBeDefined()
    await band.unmount()
  }

  finish()
  await running
  const band = await $.ui.mount({ plugin: 'breach-quota', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ text: /EXEC/ })).toBeUndefined()
  await band.unmount()
})

test('利用枠のペースで枯渇までの見込みを出し、90%超えでRAM LOWの帯を出す', async ($, on) => {
  // 5時間枠は開始から3時間で80%使用。このペースなら45分後に使い切る
  mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 80, resetsAt: '2026-10-05T12:00:00Z' },
      { kind: 'seven_day', percentUsed: 95, resetsAt: '2026-10-08T00:00:00Z' },
      { kind: 'seven_day_fable', percentUsed: 40, resetsAt: '2026-10-08T00:00:00Z' },
    ],
    changed: ['rateLimits'],
  })

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await pane.find({ text: /5時間枠 ▰{4}▱{16} 残20% 枯渇まで 0:45 \[OVERDRAW\]/ })).toBeDefined()
  // Fable週次は枠の63%が経過して40%使用。ペースは半分以上なのでSTABLE
  expect(await pane.find({ text: /Fable週次 .* 残60% 再充填まで .* \[STABLE\]/ })).toBeDefined()
  await pane.unmount()

  // 広いパネルは計器を横に、中くらいと狭いパネルは縦に積む。
  // 枠(iframe)は宣言どおりの大きさで描かれるので、幅はセル数から、高さは縦横比から明示する
  for (const [bodyColumns, viewWidth, width] of [
    [130, 1228, 988],
    [100, 600, 760],
    [48, 400, 364],
  ] as const) {
    const desktop = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE_PROPS, bodyColumns } })
    const power = (await desktop.findAll({ type: 'Svg' })).find(one => String(one.props.alt).startsWith('RAM残量'))
    const source = String(power?.props.source)
    const viewHeight = Number(new RegExp(`viewBox="0 0 ${viewWidth} (\\d+)"`).exec(source)?.[1])
    expect(viewHeight).toBeGreaterThan(0)
    expect(power?.props.width).toBe(width)
    expect(power?.props.height).toBe(Math.round((width * viewHeight) / viewWidth))
    expect(source).toContain('FABLE WEEKLY')
    expect(source).toContain('RAM.07D-F')
    expect(source).toContain('BURNOUT IN')
    expect(source).toContain('// 今のペースで使い切るまでの見込み')
    // 枠(iframe)の白い地が透けないよう、全面を地の色で塗る
    expect(source).toContain('style="background:#0A0608"')
    // ブラウン管の走査線と周辺減光を全面に重ね、大きな数字は色ずれのフィルタで描く
    expect(source).toContain('fill="url(#scan)"')
    expect(source).toContain('fill="url(#tube)"')
    expect(source).toContain('filter="url(#crt)"')
    // 走査帯は計器のSVGにだけ流し、動きを減らす設定では消す
    expect(source).toContain('class="roll"')
    expect(source).toMatch(/prefers-reduced-motion[\s\S]*\.roll \{ animation: none; display: none; \}/)
    // コンテキストの使用量がまだ届いていないので、記憶マトリクスは計測待ち
    expect(source).toContain('MEMORY MATRIX')
    expect(source).toContain('AWAITING SCAN')
    // 1枚のSVGは131072文字まで
    expect(source.length).toBeLessThan(131_072)
    await desktop.unmount()
  }

  const band = await $.ui.mount({ plugin: 'breach-quota', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ text: /RAM LOW 残量わずか/ })).toBeDefined()
  expect(await band.find({ text: /週次 残り5%/ })).toBeDefined()
  await band.unmount()
})

test('数え下ろしの各桁は、描いた瞬間の残り時間を指すようにずらして始める', async ($, on) => {
  // リセットまで1:59:23。秒の1の位(周期10秒)は、区間6で3を見せ、6秒ずらして始める
  mock.clock(on, { now: Date.parse('2026-10-05T10:00:37Z') })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 18, resetsAt: '2026-10-05T12:00:00Z' }],
    changed: ['rateLimits'],
  })

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop', props: PANE_PROPS })
  const power = (await desktop.findAll({ type: 'Svg' })).find(one => String(one.props.alt).startsWith('RAM残量'))
  const source = String(power?.props.source)
  expect(source).toContain(
    '>3<animate attributeName="visibility" calcMode="discrete" values="hidden;hidden;hidden;hidden;hidden;hidden;visible;hidden;hidden;hidden" dur="10s" begin="-6s"',
  )
  // 秒の10の位(周期60秒)は2。区間は59-23=36秒ぶん進んだ3番目
  expect(source).toContain(
    '>2<animate attributeName="visibility" calcMode="discrete" values="hidden;hidden;hidden;visible;hidden;hidden" dur="60s" begin="-36s"',
  )
  // 3時間で18%なら、経過に対して使用が半分未満なのでCOOL
  expect(source).toContain('RECHARGE IN')
  await desktop.unmount()
})

test('ツール実行が成功・遮断として記録され、両サーフェスで描ける', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('tool.call', (_, e) => (e.tool === 'Edit' ? { isError: true, result: 'old_string not found' } : { result: 'ok' }))

  await $.tool.call({ tool: 'Read', file_path: '/src/app.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/src/app.ts', old_string: 'a', new_string: 'b' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface, props: PANE_PROPS })
    if (surface === 'desktop') {
      const svgs = await pane.findAll({ type: 'Svg' })
      const board = String(svgs.find(one => String(one.props.alt).startsWith('ハックトレース'))?.props.source)
      expect(board).toContain('HACK TRACE')
      expect(board).toContain('ACCESS LOG')
      expect(board).toContain('app.ts')
      expect(board).toContain('>ICE<')
      expect(board).toContain('ICE ／ 遮断')
      // 描き直しの多いトレースには走査線だけを重ね、走査帯は流さない
      expect(board).toContain('fill="url(#scan)"')
      expect(board).not.toContain('class="roll"')
      const header = String(svgs.find(one => String(one.props.alt).startsWith('BREACH QUOTA'))?.props.source)
      expect(header).toContain('BREACH//QUOTA')
      expect(header).toContain('ICE HIT')
      expect(header).toContain('OPS 002')
      // 文字はすべてSVGの中で描く
      expect(await pane.find({ type: 'Text' })).toBeUndefined()
    } else {
      expect(await pane.find({ text: /ACCESS LOG/ })).toBeDefined()
      expect(await pane.find({ text: /app\.ts/ })).toBeDefined()
      expect(await pane.find({ text: /INJECT +書き換え ×1 遮断/ })).toBeDefined()
    }
    await pane.unmount()

    const band = await $.ui.mount({ plugin: 'breach-quota', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ text: /ICE 遮断/ })).toBeDefined()
    expect(await band.find({ text: /エラーを返しました/ })).toBeDefined()
    await band.unmount()
  }
})

test('サブエージェントの実行を専用トラックに刻み、ターンのトークンからキャッシュ命中率を出す', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5-20251001', agentId: 'agent-1' }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.agent.spawn({
    tool_use_id: 'toolu_agent',
    prompt: 'src以下を調べる',
    description: '構成調査',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  })
  // agentIdはエンジンがサブエージェントの実行に付ける予約キーで、引数の型には含まれない
  const inAgent = { tool: 'Read' as const, file_path: '/src/main.ts', agentId: 'agent-1' }
  await $.tool.call(inAgent)
  // 入力の合計500のうち300をキャッシュから読んだので、キャッシュ命中率は60%
  await $.turn.complete({
    answer: '調査完了',
    durationMs: 1200,
    isAborted: false,
    turnId: 'turn-1',
    agentId: 'agent-1',
    reason: 'answer',
    usage: {
      model: 'claude-haiku-4-5-20251001',
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 300,
      cache_creation_input_tokens: 100,
    },
  })

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop', props: PANE_PROPS })
  const svgs = await desktop.findAll({ type: 'Svg' })
  const board = String(svgs.find(one => String(one.props.alt).startsWith('ハックトレース'))?.props.source)
  expect(board).toContain('SUB-AGENTS')
  expect(board).toContain('Explore')
  expect(board).toContain('haiku-4-5')
  const vitals = String(svgs.find(one => String(one.props.alt).startsWith('計器'))?.props.source)
  expect(vitals).toContain('CACHE HIT')
  expect(vitals).toContain('>60%<')
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await terminal.find({ text: /SUB-AGENT Explore「構成調査」 成功 haiku-4-5 ×1/ })).toBeDefined()
  expect(await terminal.find({ text: /キャッシュ命中率 60%/ })).toBeDefined()
  await terminal.unmount()
})

test('消費額を計器に、コンテキストの内訳を記憶マトリクスに出す', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.usage', () => ({
    value: {
      startedAt: Date.parse('2026-10-05T08:00:00Z'),
      rateLimits: [],
      cost: { usd: 1.5 },
      context: {
        tokens: 120_000,
        window: 200_000,
        breakdown: {
          categories: [
            { name: 'System prompt', tokens: 10_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
            { name: 'Messages', tokens: 110_000, color: 'purple', isDeferred: false, kind: 'used' },
            { name: 'Some very long category name from a future build', tokens: 600, color: 'cyan', isDeferred: false, kind: 'used' },
            // 実際の内訳と同じく、予備域が空き領域より先に届く
            { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
            { name: 'Free space', tokens: 47_000, color: 'promptBorder', isDeferred: false, kind: 'free' },
            { name: 'MCP tools', tokens: 5_000, color: 'cyan', isDeferred: true, kind: 'deferred' },
          ],
          totalTokens: 120_000,
          maxTokens: 200_000,
          rawMaxTokens: 200_000,
          percentage: 60,
          gridRows: [],
          model: 'claude-opus-5-5',
          autocompactSource: 'auto',
          memoryFiles: [],
          mcpTools: [],
          agents: [],
          isAutoCompactEnabled: true,
          apiUsage: null,
        },
      },
    },
  }))
  await $.session.measure({
    context: { tokens: 120_000, window: 200_000 },
    rateLimits: [],
    cost: { usd: 1.5 },
    changed: ['context', 'cost'],
  })

  for (const bodyColumns of [130, 100, 48]) {
    const desktop = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE_PROPS, bodyColumns } })
    const svgs = await desktop.findAll({ type: 'Svg' })
    expect(String(svgs.find(one => String(one.props.alt).startsWith('計器'))?.props.source)).toContain('$1.50')
    const source = String(svgs.find(one => String(one.props.alt).startsWith('RAM残量'))?.props.source)
    expect(source).toContain('MEMORY MATRIX')
    expect(source).toContain('60% ／ 200k')
    // 内訳の名前は日本語で出し、遅延読み込みのツール定義は数えない
    expect(source).toContain('>会話<')
    expect(source).toContain('>圧縮予備域<')
    expect(source).not.toContain('MCPツール')
    expect(source).toMatch(/>Some very long[^<]*…</)
    // 予備域は届いた順によらず格子の最後に置き、凡例でも空きのあとに並べる
    expect(source.lastIndexOf('fill="url(#hatch)"')).toBeGreaterThan(source.lastIndexOf('opacity="0.16"'))
    expect(source.indexOf('>空き<')).toBeLessThan(source.indexOf('>圧縮予備域<'))
    // 使用の端にカーソルを置く
    expect(source).toContain('stroke="#3FF2E8" stroke-width="1.5" class="blink"')
    await desktop.unmount()
  }

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE_PROPS })
  expect(await terminal.find({ text: /コンテキスト 使用60% 120k \/ 200k \[CAUTION\] 会話 110k/ })).toBeDefined()
  expect(await terminal.find({ text: /消費額 \$1\.50/ })).toBeDefined()
  await terminal.unmount()
})
