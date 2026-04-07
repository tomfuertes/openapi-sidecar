import vm from 'vm'
import { normalizeCode } from './normalize.js'

export interface ExecuteResult {
  result: unknown
  error?: string
  logs: string[]
}

interface ExecutorConfig {
  /** Execution timeout in ms (default 30000) */
  timeout?: number
}

/**
 * Execute LLM-generated code in a Node.js vm sandbox.
 *
 * The sandbox gets a `codemode` proxy object whose methods are provided
 * per-call by the agent loop (e.g. spec() for search, request() for execute).
 * Secrets never enter the sandbox — auth is handled by the host-side request fn.
 */
export class NodeExecutor {
  private timeout: number

  constructor(config?: ExecutorConfig) {
    this.timeout = config?.timeout ?? 30_000
  }

  async execute(
    code: string,
    fns: Record<string, (...args: unknown[]) => Promise<unknown>>,
  ): Promise<ExecuteResult> {
    const logs: string[] = []

    // Build the api proxy from provided fns
    const apiProxy: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
    for (const [name, fn] of Object.entries(fns)) {
      apiProxy[name] = fn
    }

    const sandbox = {
      api: apiProxy,
      console: {
        log: (...args: unknown[]) => logs.push(args.map(a => JSON.stringify(a)).join(' ')),
        warn: (...args: unknown[]) => logs.push(`[WARN] ${args.map(a => JSON.stringify(a)).join(' ')}`),
        error: (...args: unknown[]) => logs.push(`[ERROR] ${args.map(a => JSON.stringify(a)).join(' ')}`),
      },
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Date,
      Math,
      RegExp,
      Map,
      Set,
      Promise,
      Error,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,
    }

    const context = vm.createContext(sandbox)

    // Normalize LLM output (strip fences, handle named fns, etc.) then invoke
    const normalized = normalizeCode(code)
    const wrappedCode = `(${normalized})()`

    try {
      const script = new vm.Script(wrappedCode, { filename: 'sidecar-sandbox.js' })
      const resultPromise = script.runInContext(context, {
        timeout: this.timeout,
      })

      const result = await resultPromise

      return { result, logs }
    } catch (err) {
      return {
        result: null,
        error: err instanceof Error ? err.message : String(err),
        logs,
      }
    }
  }
}
