import type { LLMConfig, ChatMessage, ChatCompletionResponse } from './types.js'

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

  async chat(messages: ChatMessage[]): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0,
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`LLM request failed (${res.status}): ${body}`)
    }

    return (await res.json()) as ChatCompletionResponse
  }
}
