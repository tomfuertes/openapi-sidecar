import type { EndpointDescriptor } from './types.js'

const MAX_FIELDS = 8

const typeMap: Record<string, string> = {
  string: 'string',
  integer: 'number',
  number: 'number',
  boolean: 'boolean',
}

/** Convert a dereferenced JSON Schema to compact TS shorthand: {id: string, name?: string, ...} */
function schemaToShorthand(schema: Record<string, unknown>, depth = 0): string {
  if (schema.type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined
    if (items?.properties) return `[${schemaToShorthand(items, depth)}]`
    return `${typeMap[(items?.type as string) ?? ''] ?? 'unknown'}[]`
  }

  const props = schema.properties as Record<string, Record<string, unknown>> | undefined
  if (!props) return 'object'

  const required = new Set(schema.required as string[] ?? [])
  const keys = Object.keys(props)
  const truncated = keys.length > MAX_FIELDS
  const fields = keys.slice(0, MAX_FIELDS).map(k => {
    const p = props[k]
    const opt = !required.has(k) || p.nullable ? '?' : ''
    let t: string
    if (p.type === 'array') {
      const items = p.items as Record<string, unknown> | undefined
      t = depth === 0 && items?.properties
        ? `${schemaToShorthand(items, depth + 1)}[]`
        : `${typeMap[(items?.type as string) ?? ''] ?? 'unknown'}[]`
    } else if (p.type === 'object' || p.properties) {
      t = depth === 0 ? schemaToShorthand(p, depth + 1) : 'object'
    } else {
      t = typeMap[(p.type as string) ?? ''] ?? 'unknown'
    }
    return `${k}${opt}: ${t}`
  })

  return `{${fields.join(', ')}${truncated ? ', ...' : ''}}`
}

/** Serialize top-level property names for dedup comparison */
function schemaKey(schema?: Record<string, unknown>): string | null {
  const props = schema?.properties as Record<string, unknown> | undefined
  if (!props) {
    // unwrap array wrapper
    if (schema?.type === 'array') {
      const items = schema.items as Record<string, unknown> | undefined
      return schemaKey(items)
    }
    return null
  }
  return Object.keys(props).sort().join(',')
}

/**
 * Build a compact endpoint index for the system prompt.
 * One line per endpoint + indented param list + response shape shorthand.
 */
function buildEndpointIndex(endpoints: EndpointDescriptor[]): string {
  let lastSchemaKey: string | null = null

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

    // Append response shape shorthand
    if (ep.responseSchema) {
      const key = schemaKey(ep.responseSchema)
      if (key && key === lastSchemaKey) {
        line += ' → same'
      } else {
        line += ` → ${schemaToShorthand(ep.responseSchema)}`
        lastSchemaKey = key
      }
    } else {
      lastSchemaKey = null
    }

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
