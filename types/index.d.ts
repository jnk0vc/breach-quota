export type HackName = 'SCAN' | 'INJECT' | 'EXEC'
export type Verdict = 'idle' | 'running' | 'approved' | 'denied'
export type Hack = { verdict: Verdict; count: number; tool: string }
export type Hacks = { SCAN: Hack; INJECT: Hack; EXEC: Hack }
export type LogEntry = {
  id: string
  at: number
  hack: HackName
  tool: string
  summary: string
  verdict: Verdict
  // サブエージェントの中で実行されたときの、そのエージェントのid
  agentId?: string
}
export type Alarm = { tool: string; reason: string }
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type ContextGauge = { tokens?: number; window: number; percent?: number }
// サブエージェント1体ぶん。toolUseIdは起動したAgentツールの呼び出し
export type SubAgent = {
  id: string
  toolUseId: string
  type: string
  description: string
  model: string
  verdict: Verdict
  count: number
  // バックグラウンドで動くサブエージェントは、Agentツールが返っても作業が続く
  isBackground: boolean
}
// 全ターンのトークンの累計。キャッシュ命中率を出すのに使う
export type TokenTally = { input: number; output: number; cacheRead: number; cacheWrite: number; turns: number }
export type MemoryKind = 'used' | 'free' | 'buffer' | 'deferred'
export type MemorySlice = { name: string; tokens: number; kind: MemoryKind }
// コンテキストの内訳(/contextの見積もり)。maxはsliceの合計が対応する窓の大きさ
export type MemoryMap = { slices: MemorySlice[]; used: number; max: number; percentage: number }

declare module 'claude-code' {
  interface PluginState {
    'breach-quota': {
      hacks: Hacks
      log: LogEntry[]
      startedAt: number
      alarm: Alarm | null
      exec: string | null
      limits: Limit[]
      context: ContextGauge | null
      anchor: number
      subAgents: SubAgent[]
      cost: number | null
      tokens: TokenTally
      memory: MemoryMap | null
    }
  }
}
