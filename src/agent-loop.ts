import { LLMClient } from './llm-client.js'
import { NodeExecutor } from './node-executor.js'
import { buildSystemPrompt } from './prompt.js'
import type { ParsedSpec } from './spec-parser.js'
import type { AuthConfig, LLMConfig, ChatMessage, QueryResult } from './types.js'

interface AgentLoopParams {
  question: string
  spec: ParsedSpec
  auth: AuthConfig
  llm: LLMConfig
  maxIterations: number
}

/**
 * Core agent loop: prompt LLM → extract code → execute in sandbox → retry on error.
 *
 * Each iteration:
 * 1. Send conversation to LLM
 * 2. Extract code block from response
 * 3. Execute in isolated-vm sandbox
 * 4. If error + iterations left → feed error back → loop
 * 5. If success → return structured result
 */
export async function runAgentLoop(params: AgentLoopParams): Promise<QueryResult> {
  const { question, spec, auth, llm, maxIterations } = params

  const client = new LLMClient(llm)
  const executor = new NodeExecutor({
    auth,
    baseUrl: spec.baseUrl,
  })

  const systemPrompt = buildSystemPrompt(spec)
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: question },
  ]

  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  const allEndpointsCalled: string[] = []

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    // 1. Call LLM
    const response = await client.chat(messages)
    const choice = response.choices[0]
    if (!choice) {
      throw new Error('LLM returned no choices')
    }

    totalPromptTokens += response.usage?.prompt_tokens ?? 0
    totalCompletionTokens += response.usage?.completion_tokens ?? 0

    const assistantContent = choice.message.content
    messages.push({ role: 'assistant', content: assistantContent })

    // 2. Extract code from response
    const code = extractCode(assistantContent)
    if (!code) {
      // LLM responded without code — maybe it answered directly
      // Try to parse as a direct answer
      return {
        answer: assistantContent,
        data: null,
        meta: {
          iterations: iteration,
          endpoints_called: allEndpointsCalled,
          tokens: { prompt: totalPromptTokens, completion: totalCompletionTokens },
        },
      }
    }

    // 3. Execute in sandbox
    const execResult = await executor.execute(code)

    if (execResult.error) {
      // Recoverable — feed error back to LLM
      if (iteration < maxIterations) {
        messages.push({
          role: 'user',
          content: `The code execution failed with this error:\n\n${execResult.error}\n\n${
            execResult.logs.length > 0
              ? `Console output:\n${execResult.logs.join('\n')}\n\n`
              : ''
          }Please fix the code and try again.`,
        })
        continue
      }

      // Out of iterations — throw
      throw new Error(
        `Agent loop exhausted ${maxIterations} iterations. Last error: ${execResult.error}`,
      )
    }

    // 4. Parse result
    const result = execResult.result as
      | { answer?: string; data?: unknown }
      | null
      | undefined

    // Track endpoints called during execution
    allEndpointsCalled.push(...execResult.endpointsCalled)

    return {
      answer: result?.answer ?? 'No answer provided by the agent.',
      data: result?.data ?? result ?? null,
      meta: {
        iterations: iteration,
        endpoints_called: allEndpointsCalled,
        tokens: { prompt: totalPromptTokens, completion: totalCompletionTokens },
      },
    }
  }

  throw new Error(`Agent loop completed ${maxIterations} iterations without a result`)
}

/**
 * Extract a JavaScript code block from LLM markdown response.
 * Looks for ```javascript or ```js fenced blocks, falls back to the whole content
 * if it looks like code.
 */
function extractCode(content: string): string | null {
  // Try fenced code blocks first
  const fencedMatch = content.match(
    /```(?:javascript|js|typescript|ts)?\s*\n([\s\S]*?)```/,
  )
  if (fencedMatch) {
    return fencedMatch[1].trim()
  }

  // If the content looks like it's mostly code (has return statement, api calls)
  if (
    content.includes('api.get') ||
    content.includes('api.post') ||
    content.includes('return {')
  ) {
    return content.trim()
  }

  return null
}
