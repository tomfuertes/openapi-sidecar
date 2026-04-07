import type { EndpointDescriptor } from './types.js'

/**
 * Build a compact endpoint index for the system prompt.
 * One line per endpoint + indented param list. ~50-100 bytes per endpoint.
 */
function buildEndpointIndex(endpoints: EndpointDescriptor[]): string {
  return endpoints.map(ep => {
    const params = ep.parameters ?? []
    const byLocation: Record<string, string[]> = {}

    for (const p of params) {
      const loc = p.in
      if (!byLocation[loc]) byLocation[loc] = []
      byLocation[loc].push(p.required ? p.name : `${p.name}?`)
    }

    let line = `${ep.method} ${ep.path}`
    if (ep.summary) line += ` — ${ep.summary}`

    const paramLines = Object.entries(byLocation)
      .map(([loc, names]) => `  ${loc}: ${names.join(', ')}`)

    return paramLines.length ? `${line}\n${paramLines.join('\n')}` : line
  }).join('\n')
}

/**
 * Build the system prompt with a compact spec index baked in.
 * This is the cacheable prefix — identical across turns in one session.
 */
export function buildSystemPrompt(
  title: string,
  version: string,
  endpoints: EndpointDescriptor[],
): string {
  const index = buildEndpointIndex(endpoints)

  return `You are a read-only API assistant for "${title}" v${version}.
Write JavaScript code to answer the user's question using the endpoints below.

Endpoints:
${index}

api.request({ method: "GET", path, query? }) makes an authenticated call.
Return { answer: "natural language summary", data: <structured> }.`
}
