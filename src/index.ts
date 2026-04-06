import { parseSpec } from './spec-parser.js'
import { runAgentLoop } from './agent-loop.js'
import type { SidecarConfig, QueryResult } from './types.js'

export type { SidecarConfig, QueryResult, QueryMeta, AuthConfig, LLMConfig } from './types.js'

export class OpenAPISidecar {
  private config: SidecarConfig & { maxIterations: number }

  constructor(config: SidecarConfig) {
    this.config = { maxIterations: 5, ...config }
  }

  async query(question: string): Promise<QueryResult> {
    const spec = await parseSpec(this.config.spec)
    return runAgentLoop({
      question,
      spec,
      auth: this.config.auth,
      llm: this.config.llm,
      maxIterations: this.config.maxIterations,
    })
  }
}
