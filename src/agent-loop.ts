import { LLMClient } from './llm-client.js'
import { NodeExecutor } from './node-executor.js'
import { buildSystemPrompt } from './prompt.js'
import { buildTools } from './tools.js'
import { applyAuth } from './auth.js'
import type { ParsedSpec } from './spec-parser.js'
import type { AuthConfig, LLMConfig, ChatMessage, RequestOptions, QueryResult } from './types.js'

interface AgentLoopParams {
  question: string
  spec: ParsedSpec
  auth: AuthConfig
  llm: LLMConfig
  maxIterations: number
  debug: boolean
}

const MAX_CHARS = 6000 * 4 // ~6k tokens, matching codemode's truncation
function truncate(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2) ?? 'undefined'
  if (text.length <= MAX_CHARS) return text
  return `${text.slice(0, MAX_CHARS)}\n\n--- TRUNCATED ---`
}

/**
 * Core agent loop: prompt LLM with single execute tool → handle tool call → feed result back.
 * Spec index is baked into the system prompt so the LLM can one-shot most queries.
 */
export async function runAgentLoop(params: AgentLoopParams): Promise<QueryResult> {
  const { question, spec, auth, llm, maxIterations, debug } = params
  const log = debug
    ? (...args: unknown[]) => console.log('[sidecar]', ...args)
    : () => {}

  const client = new LLMClient(llm)
  const executor = new NodeExecutor()
  const tools = buildTools()

  const systemPrompt = buildSystemPrompt(spec.title, spec.version, spec.endpoints)
  log('system prompt:\n', systemPrompt)

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: question },
  ]

  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  const allEndpointsCalled: string[] = []

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    log(`--- iteration ${iteration}/${maxIterations} ---`)

    const response = await client.chat(messages, tools)
    const choice = response.choices[0]
    if (!choice) throw new Error('LLM returned no choices')

    totalPromptTokens += response.usage?.prompt_tokens ?? 0
    totalCompletionTokens += response.usage?.completion_tokens ?? 0

    const { message, finish_reason } = choice

    // Append the assistant message (may contain tool_calls or content)
    messages.push({
      role: 'assistant',
      content: message.content,
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    })

    // -- Final answer (no tool calls) --
    if (finish_reason === 'stop' || !message.tool_calls?.length) {
      log('final answer:\n', message.content)
      const content = message.content ?? ''

      // Try to parse structured { answer, data } from the response
      let answer = content
      let data: unknown = null
      try {
        const parsed = JSON.parse(content)
        if (parsed.answer) {
          answer = parsed.answer
          data = parsed.data ?? null
        }
      } catch {
        // Not JSON — use raw text as answer
      }

      const result = {
        answer,
        data,
        meta: {
          iterations: iteration,
          endpoints_called: allEndpointsCalled,
          tokens: { prompt: totalPromptTokens, completion: totalCompletionTokens },
        },
      }
      log('result:', JSON.stringify(result, null, 2))
      return result
    }

    // -- Tool calls --
    for (const toolCall of message.tool_calls) {
      const { name } = toolCall.function
      const args = JSON.parse(toolCall.function.arguments)
      const code = args.code as string

      log(`tool call: ${name}`)
      log('code:\n', code)

      if (name !== 'execute') {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name,
          content: `Error: Unknown tool "${name}"`,
        })
        continue
      }

      const execResult = await executor.execute(code, {
        request: async (opts: unknown) => {
          const { method, path, query } = opts as RequestOptions
          if (method.toUpperCase() !== 'GET') {
            throw new Error(`Only GET requests are allowed (got ${method})`)
          }
          allEndpointsCalled.push(`${method} ${path}`)
          return makeRequest(spec.baseUrl, auth, method, path, query)
        },
      })

      // If execute returned { answer, data }, short-circuit — no extra LLM turn needed
      const execData = execResult.result as { answer?: string; data?: unknown } | null | undefined
      if (!execResult.error && execData?.answer) {
        const result = {
          answer: execData.answer,
          data: execData.data ?? null,
          meta: {
            iterations: iteration,
            endpoints_called: allEndpointsCalled,
            tokens: { prompt: totalPromptTokens, completion: totalCompletionTokens },
          },
        }
        log('result (short-circuit):', JSON.stringify(result, null, 2))
        return result
      }

      if (execResult.logs.length > 0) log('sandbox logs:', execResult.logs)

      const toolResult = execResult.error
        ? `Error: ${execResult.error}`
        : truncate(execResult.result)

      log(`tool result (${name}):`, toolResult.slice(0, 500))

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name,
        content: toolResult,
      })
    }
  }

  throw new Error(`Agent loop completed ${maxIterations} iterations without a result`)
}

/** Host-side GET request — auth injected here, never enters sandbox */
async function makeRequest(
  baseUrl: string,
  auth: AuthConfig,
  method: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<unknown> {
  let url = `${baseUrl.replace(/\/+$/, '')}${path}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const authed = applyAuth(url, headers, auth)
  url = authed.url
  Object.assign(headers, authed.headers)

  if (query && Object.keys(query).length > 0) {
    const u = new URL(url)
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) u.searchParams.set(k, String(v))
    }
    url = u.toString()
  }

  const res = await fetch(url, { method: method.toUpperCase(), headers })
  const text = await res.text()

  if (!res.ok) {
    throw new Error(`API ${method} ${path} returned ${res.status}: ${text.slice(0, 500)}`)
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
