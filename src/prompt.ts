import type { ParsedSpec } from './spec-parser.js'

/**
 * Build the system prompt that instructs the LLM how to query the API.
 *
 * The prompt tells the LLM:
 * 1. What endpoints are available (from the parsed spec)
 * 2. How to make requests via the `api` proxy object
 * 3. What shape to return results in
 */
export function buildSystemPrompt(spec: ParsedSpec): string {
  const endpointDocs = spec.endpoints
    .map((ep) => {
      const params = ep.parameters
        ?.map(
          (p) =>
            `    - ${p.name} (${p.in}${p.required ? ', required' : ''}): ${
              p.schema ? JSON.stringify(p.schema) : 'any'
            }`,
        )
        .join('\n')

      return [
        `  ${ep.method} ${ep.path}`,
        ep.summary ? `    Summary: ${ep.summary}` : null,
        ep.description ? `    Description: ${ep.description}` : null,
        params ? `    Parameters:\n${params}` : null,
        ep.responseSchema
          ? `    Response schema: ${JSON.stringify(ep.responseSchema, null, 2)}`
          : null,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')

  return `You are an API query assistant for "${spec.title}" (v${spec.version}).
Base URL: ${spec.baseUrl}

## Available Endpoints

${endpointDocs}

## Instructions

Write an async JavaScript function body that queries the API to answer the user's question.
Use the \`api\` object to make HTTP requests. It has these methods:

  api.get(path, queryParams?)    → Promise<any>
  api.post(path, body?)          → Promise<any>
  api.put(path, body?)           → Promise<any>
  api.patch(path, body?)         → Promise<any>
  api.delete(path, queryParams?) → Promise<any>

- \`path\` is the endpoint path (e.g. "/users", "/projects/123")
- Query params are an object: { page: 1, limit: 10 }
- POST/PUT/PATCH body is a JSON object
- All methods return the parsed JSON response
- Auth is handled automatically — never include credentials

## Output Format

Your code MUST return a JSON object with this shape:

\`\`\`
return {
  answer: "Natural language summary answering the user's question",
  data: <the raw structured data from API responses>
}
\`\`\`

## Rules

- Only use GET requests unless the question clearly requires mutations
- Fetch only the data needed to answer the question
- If you need multiple API calls, make them sequentially
- Handle pagination if needed to get complete results
- If the API returns an error, try a different approach
- Keep the answer concise but informative
- Always include the raw data in the \`data\` field`
}
