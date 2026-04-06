import vm from 'vm'
import { applyAuth } from './auth.js'
import type { AuthConfig } from './types.js'

export interface ExecuteResult {
  result: unknown
  error?: string
  logs: string[]
  endpointsCalled: string[]
}

interface ExecutorConfig {
  auth: AuthConfig
  baseUrl: string
  /** Execution timeout in ms (default 30000) */
  timeout?: number
}

/**
 * Execute LLM-generated code in a Node.js vm sandbox.
 *
 * The sandbox gets an `api` proxy object with get/post/put/patch/delete methods.
 * These proxy calls route back to the host where auth is injected and real
 * HTTP requests are made. Secrets never enter the sandbox.
 */
export class NodeExecutor {
  private config: ExecutorConfig

  constructor(config: ExecutorConfig) {
    this.config = config
  }

  async execute(code: string): Promise<ExecuteResult> {
    const logs: string[] = []
    const endpointsCalled: string[] = []

    // Build the api proxy that routes HTTP calls through the host
    const makeReq = this.makeRequest.bind(this)
    const apiProxy = {
      async get(path: string, params?: Record<string, unknown>) {
        endpointsCalled.push(`GET ${path}`)
        const text = await makeReq('GET', path, JSON.stringify(params ?? {}))
        return JSON.parse(text)
      },
      async post(path: string, body?: unknown) {
        endpointsCalled.push(`POST ${path}`)
        const text = await makeReq('POST', path, JSON.stringify(body ?? {}))
        return JSON.parse(text)
      },
      async put(path: string, body?: unknown) {
        endpointsCalled.push(`PUT ${path}`)
        const text = await makeReq('PUT', path, JSON.stringify(body ?? {}))
        return JSON.parse(text)
      },
      async patch(path: string, body?: unknown) {
        endpointsCalled.push(`PATCH ${path}`)
        const text = await makeReq('PATCH', path, JSON.stringify(body ?? {}))
        return JSON.parse(text)
      },
      async delete(path: string, params?: Record<string, unknown>) {
        endpointsCalled.push(`DELETE ${path}`)
        const text = await makeReq('DELETE', path, JSON.stringify(params ?? {}))
        return JSON.parse(text)
      },
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

    const wrappedCode = `(async () => {\n${code}\n})()`

    try {
      const script = new vm.Script(wrappedCode, { filename: 'sidecar-sandbox.js' })
      const resultPromise = script.runInContext(context, {
        timeout: this.config.timeout ?? 30_000,
      })

      const result = await resultPromise

      return { result, logs, endpointsCalled }
    } catch (err) {
      return {
        result: null,
        error: err instanceof Error ? err.message : String(err),
        logs,
        endpointsCalled,
      }
    }
  }

  /** Called from sandbox via proxy — runs on host with full auth */
  private async makeRequest(
    method: string,
    path: string,
    bodyOrParams: string,
  ): Promise<string> {
    const parsed = JSON.parse(bodyOrParams || '{}')
    let url = `${this.config.baseUrl.replace(/\/+$/, '')}${path}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Apply auth on the host side — secrets stay here
    const authed = applyAuth(url, headers, this.config.auth)
    url = authed.url
    Object.assign(headers, authed.headers)

    // Add query params for GET/DELETE
    if (['GET', 'DELETE'].includes(method.toUpperCase()) && parsed && Object.keys(parsed).length > 0) {
      const u = new URL(url)
      for (const [k, v] of Object.entries(parsed)) {
        u.searchParams.set(k, String(v))
      }
      url = u.toString()
    }

    const fetchOpts: RequestInit = {
      method: method.toUpperCase(),
      headers,
    }

    // Add body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      fetchOpts.body = JSON.stringify(parsed)
    }

    const res = await fetch(url, fetchOpts)
    const text = await res.text()

    if (!res.ok) {
      throw new Error(
        `API ${method.toUpperCase()} ${path} returned ${res.status}: ${text.slice(0, 500)}`,
      )
    }

    return text
  }
}
