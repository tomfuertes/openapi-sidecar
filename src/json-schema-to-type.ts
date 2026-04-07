/**
 * Convert JSON Schema to TypeScript type declarations.
 * Extracted from @cloudflare/codemode (json-schema-types) to avoid
 * pulling in ai/zod/acorn peer dependencies via barrel exports.
 */
import type { JSONSchema7 } from 'json-schema'

type SchemaLike = JSONSchema7 | boolean

interface ConversionContext {
  root: SchemaLike
  depth: number
  seen: Set<SchemaLike>
  maxDepth: number
}

function quoteProp(name: string): string {
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
    const escaped = name
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')
    return `"${escaped}"`
  }
  return name
}

function escapeStringLiteral(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function escapeJsDoc(text: string): string {
  return text.replace(/\*\//g, '*\\/')
}

function resolveRef(ref: string, root: SchemaLike): SchemaLike | null {
  if (ref === '#') return root
  if (!ref.startsWith('#/')) return null
  const segments = ref.slice(2).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
  let current: unknown = root
  for (const seg of segments) {
    if (current === null || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[seg]
    if (current === undefined) return null
  }
  if (typeof current === 'boolean') return current
  if (current === null || typeof current !== 'object') return null
  return current as SchemaLike
}

function applyNullable(result: string, schema: JSONSchema7 | null): string {
  if (result !== 'unknown' && result !== 'never' && (schema as Record<string, unknown>)?.nullable === true)
    return `${result} | null`
  return result
}

function schemaToTypeString(schema: SchemaLike, indent: string, ctx: ConversionContext): string {
  if (typeof schema === 'boolean') return schema ? 'unknown' : 'never'
  if (ctx.depth >= ctx.maxDepth) return 'unknown'
  if (ctx.seen.has(schema)) return 'unknown'
  ctx.seen.add(schema)
  const nextCtx = { ...ctx, depth: ctx.depth + 1 }

  try {
    if (schema.$ref) {
      const resolved = resolveRef(schema.$ref, ctx.root)
      if (!resolved) return 'unknown'
      return applyNullable(schemaToTypeString(resolved, indent, nextCtx), schema)
    }
    if (schema.anyOf) return applyNullable(schema.anyOf.map(s => schemaToTypeString(s as SchemaLike, indent, nextCtx)).join(' | '), schema)
    if (schema.oneOf) return applyNullable(schema.oneOf.map(s => schemaToTypeString(s as SchemaLike, indent, nextCtx)).join(' | '), schema)
    if (schema.allOf) return applyNullable(schema.allOf.map(s => schemaToTypeString(s as SchemaLike, indent, nextCtx)).join(' & '), schema)

    if (schema.enum) {
      if (schema.enum.length === 0) return 'never'
      return applyNullable(
        schema.enum.map(v => {
          if (v === null) return 'null'
          if (typeof v === 'string') return '"' + escapeStringLiteral(v) + '"'
          if (typeof v === 'object') return JSON.stringify(v) ?? 'unknown'
          return String(v)
        }).join(' | '),
        schema,
      )
    }
    if (schema.const !== undefined) {
      return applyNullable(
        schema.const === null ? 'null'
          : typeof schema.const === 'string' ? '"' + escapeStringLiteral(schema.const) + '"'
          : typeof schema.const === 'object' ? JSON.stringify(schema.const) ?? 'unknown'
          : String(schema.const),
        schema,
      )
    }

    const type = schema.type
    if (type === 'string') return applyNullable('string', schema)
    if (type === 'number' || type === 'integer') return applyNullable('number', schema)
    if (type === 'boolean') return applyNullable('boolean', schema)
    if (type === 'null') return 'null'

    if (type === 'array') {
      if (schema.items) {
        if (Array.isArray(schema.items))
          return applyNullable(`[${schema.items.map(s => schemaToTypeString(s as SchemaLike, indent, nextCtx)).join(', ')}]`, schema)
        return applyNullable(`${schemaToTypeString(schema.items as SchemaLike, indent, nextCtx)}[]`, schema)
      }
      return applyNullable('unknown[]', schema)
    }

    if (type === 'object' || schema.properties) {
      const props = schema.properties || {}
      const required = new Set(schema.required || [])
      const lines: string[] = []

      for (const [propName, propSchema] of Object.entries(props)) {
        if (typeof propSchema === 'boolean') {
          const boolType = propSchema ? 'unknown' : 'never'
          const opt = required.has(propName) ? '' : '?'
          lines.push(`${indent}    ${quoteProp(propName)}${opt}: ${boolType};`)
          continue
        }
        const propType = schemaToTypeString(propSchema as SchemaLike, indent + '    ', nextCtx)
        const desc = (propSchema as JSONSchema7).description
        const format = (propSchema as JSONSchema7).format
        if (desc || format) {
          const descText = desc ? escapeJsDoc(desc.replace(/\r?\n/g, ' ')) : undefined
          const formatTag = format ? `@format ${escapeJsDoc(format)}` : undefined
          if (descText && formatTag) {
            lines.push(`${indent}    /**`)
            lines.push(`${indent}     * ${descText}`)
            lines.push(`${indent}     * ${formatTag}`)
            lines.push(`${indent}     */`)
          } else {
            lines.push(`${indent}    /** ${descText ?? formatTag} */`)
          }
        }
        const opt = required.has(propName) ? '' : '?'
        lines.push(`${indent}    ${quoteProp(propName)}${opt}: ${propType};`)
      }

      if (schema.additionalProperties) {
        const valueType = schema.additionalProperties === true
          ? 'unknown'
          : schemaToTypeString(schema.additionalProperties as SchemaLike, indent + '    ', nextCtx)
        lines.push(`${indent}    [key: string]: ${valueType};`)
      }

      if (lines.length === 0) {
        if (schema.additionalProperties === false) return applyNullable('{}', schema)
        return applyNullable('Record<string, unknown>', schema)
      }
      return applyNullable(`{\n${lines.join('\n')}\n${indent}}`, schema)
    }

    if (Array.isArray(type)) {
      return applyNullable(
        (type as string[]).map(t => {
          if (t === 'string') return 'string'
          if (t === 'number' || t === 'integer') return 'number'
          if (t === 'boolean') return 'boolean'
          if (t === 'null') return 'null'
          if (t === 'array') return 'unknown[]'
          if (t === 'object') return 'Record<string, unknown>'
          return 'unknown'
        }).join(' | '),
        schema,
      )
    }

    return 'unknown'
  } finally {
    ctx.seen.delete(schema)
  }
}

/** Convert a JSON Schema to a TypeScript type declaration string. */
export function jsonSchemaToType(schema: JSONSchema7, typeName: string): string {
  return `type ${typeName} = ${schemaToTypeString(schema, '', {
    root: schema,
    depth: 0,
    seen: new Set(),
    maxDepth: 20,
  })}`
}
