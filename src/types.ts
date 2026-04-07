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
  /** Override the base URL for API calls (defaults to spec's servers[0].url) */
  baseUrl?: string
  /** Log internal steps (tool calls, execution results) */
  debug?: boolean
  /** Max agent loop iterations (default 10) */
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

// -- Tool calling types (OpenAI-compatible) --

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** Chat message for the LLM conversation */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

/** Shape of the LLM chat completion response (OpenAI-compatible subset) */
export interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: string
      content: string | null
      tool_calls?: ToolCall[]
    }
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

/** Request options for the execute tool's codemode.request() */
export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
}
