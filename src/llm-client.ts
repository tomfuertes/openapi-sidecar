import type { LLMConfig, ChatMessage, ChatCompletionResponse, ToolDefinition } from './types.js'

/**
 * Minimal OpenAI-compatible chat completions client.
 * Raw fetch — no SDK dependency, works with OpenRouter, Together, local, etc.
 */
export class LLMClient {
  private baseUrl: string
  private apiKey: string
  private model: string

  constructor(config: LLMConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.apiKey = config.apiKey
    this.model = config.model
  }

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
  ): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: 0,
    }
    if (tools && tools.length > 0) {
      body.tools = tools
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`LLM request failed (${res.status}): ${text}`)
    }

    return (await res.json()) as ChatCompletionResponse
  }
}
