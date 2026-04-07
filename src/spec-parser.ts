import SwaggerParser from '@apidevtools/swagger-parser'
import type { EndpointDescriptor } from './types.js'

export interface ParsedSpec {
  title: string
  version: string
  baseUrl: string
  endpoints: EndpointDescriptor[]
  /** The full dereferenced spec object */
  raw: Record<string, unknown>
}

/**
 * Load and dereference an OpenAPI 3.x spec from a file path, URL, or object.
 * All $refs are resolved inline so downstream code never deals with references.
 */
export async function parseSpec(
  spec: string | Record<string, unknown>,
): Promise<ParsedSpec> {
  // swagger-parser accepts path, URL, or object
  const api = (await SwaggerParser.dereference(spec as string)) as Record<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any
  >

  const info = api.info ?? {}
  const servers = api.servers ?? []
  let baseUrl = servers[0]?.url ?? ''

  // If no server URL in spec, derive from source URL (strip path to /doc endpoint)
  if (!baseUrl && typeof spec === 'string') {
    try {
      const specUrl = new URL(spec)
      baseUrl = specUrl.origin
    } catch {
      // spec was a file path, not a URL — leave baseUrl empty
    }
  }

  const endpoints: EndpointDescriptor[] = []
  const paths = (api.paths ?? {}) as Record<string, Record<string, unknown>>

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, opObj] of Object.entries(methods)) {
      if (method === 'get') {
        const op = opObj as Record<string, unknown>
        const params = (op.parameters ?? []) as EndpointDescriptor['parameters']

        // Extract 200/201 response schema if available
        const responses = (op.responses ?? {}) as Record<string, unknown>
        const successResponse = (responses['200'] ?? responses['201']) as
          | Record<string, unknown>
          | undefined
        const responseSchema = successResponse?.content
          ? ((
              (successResponse.content as Record<string, unknown>)[
                'application/json'
              ] as Record<string, unknown>
            )?.schema as Record<string, unknown>)
          : undefined

        endpoints.push({
          method: method.toUpperCase(),
          path,
          summary: op.summary as string | undefined,
          description: op.description as string | undefined,
          parameters: params,
          responseSchema,
        })
      }
    }
  }

  return {
    title: info.title ?? 'Untitled API',
    version: info.version ?? '0.0.0',
    baseUrl,
    endpoints,
    raw: api,
  }
}
