import type { ToolDefinition } from './types.js'

/**
 * Build a single execute tool definition.
 * The spec index lives in the system prompt — no search tool needed.
 */
export function buildTools(): ToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'execute',
        description: `Execute read-only API calls (GET only) and return a result.

Example:
async () => {
  const res = await api.request({ method: "GET", path: "/items", query: { limit: 100 } });
  return { answer: \`Found \${res.data.length} items.\`, data: res.data };
}`,
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Async arrow function to execute' },
          },
          required: ['code'],
          additionalProperties: false,
        },
      },
    },
  ]
}
