import type { AuthConfig } from './types.js'

/**
 * Apply auth credentials to a fetch request's URL and headers.
 * Called on the host side — secrets never enter the sandbox.
 */
export function applyAuth(
  url: string,
  headers: Record<string, string>,
  auth: AuthConfig,
): { url: string; headers: Record<string, string> } {
  const h = { ...headers }
  let u = url

  if (auth.bearer) {
    h['Authorization'] = `Bearer ${auth.bearer}`
  }

  if (auth.basic) {
    const encoded = btoa(`${auth.basic.username}:${auth.basic.password}`)
    h['Authorization'] = `Basic ${encoded}`
  }

  if (auth.header) {
    Object.assign(h, auth.header)
  }

  if (auth.query) {
    const parsed = new URL(u)
    for (const [k, v] of Object.entries(auth.query)) {
      parsed.searchParams.set(k, v)
    }
    u = parsed.toString()
  }

  return { url: u, headers: h }
}
