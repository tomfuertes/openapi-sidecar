import type { ParsedSpec } from './spec-parser.js'

/**
 * Build a minimal system prompt.
 * All instructions live in the tool descriptions — the system prompt
 * just sets the role and tells the LLM to use the tools.
 */
export function buildSystemPrompt(spec: ParsedSpec): string {
  return `You are an API assistant for "${spec.title}" v${spec.version}.

Use the search tool to explore the API spec and discover endpoints, parameters, and schemas.
Then use the execute tool to make API calls with the correct parameters.
Answer the user's question with a natural language summary.`
}
