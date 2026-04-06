/** LLM provider configuration (OpenAI-compatible chat completions) */
export interface LLMConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/** Auth credential bag — exactly one key should be set */
export interface AuthConfig {
  bearer?: string
  header?: Record<string, string>
  query?: Record<string, string>
  basic?: { username: string; password: string }
}

/** Top-level SDK configuration */
export interface SidecarConfig {
  /** OpenAPI spec — file path, URL, or pre-parsed object */
  spec: string | Record<string, unknown>
  auth: AuthConfig
  llm: LLMConfig
  /** Max agent loop iterations (default 5, set 1 for single-shot) */
  maxIterations?: number
}

/** Result returned from sidecar.query() */
export interface QueryResult {
  /** Natural language summary */
  answer: string
  /** Raw structured data from API calls */
  data: unknown
  /** Execution metadata */
  meta: QueryMeta
}

export interface QueryMeta {
  iterations: number
  endpoints_called: string[]
  tokens: { prompt: number; completion: number }
}

/** Chat message for the LLM conversation */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Shape of the LLM chat completion response (OpenAI-compatible subset) */
export interface ChatCompletionResponse {
  choices: Array<{
    message: { role: string; content: string }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
  }
}

/** Parsed OpenAPI endpoint descriptor used in prompt construction */
export interface EndpointDescriptor {
  method: string
  path: string
  summary?: string
  description?: string
  parameters?: Array<{
    name: string
    in: string
    required?: boolean
    schema?: Record<string, unknown>
  }>
  responseSchema?: Record<string, unknown>
}
