import { jsonSchemaToType } from '@cloudflare/codemode'
import type { JSONSchema7 } from 'json-schema'
import type { ToolDefinition, EndpointDescriptor } from './types.js'

/**
 * TypeScript interfaces describing the OpenAPI spec shape available via api.spec().
 * Mirrored from @cloudflare/codemode's SPEC_TYPES.
 */
const SPEC_TYPES = `
interface OperationObject {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: Array<{
    name: string;
    in: "query" | "header" | "path" | "cookie";
    required?: boolean;
    schema?: unknown;
    description?: string;
  }>;
  requestBody?: {
    required?: boolean;
    description?: string;
    content?: Record<string, { schema?: unknown }>;
  };
  responses?: Record<string, {
    description?: string;
    content?: Record<string, { schema?: unknown }>;
  }>;
}

interface PathItem {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
  parameters?: OperationObject["parameters"];
}

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, PathItem>;
  servers?: Array<{ url: string; description?: string }>;
  components?: Record<string, unknown>;
  tags?: Array<{ name: string; description?: string }>;
}

declare const api: {
  spec(): Promise<OpenApiSpec>;
};`

/**
 * Generate TypeScript type declarations from endpoint response schemas.
 * Uses @cloudflare/codemode's jsonSchemaToType for the conversion.
 */
function generateResponseTypes(endpoints: EndpointDescriptor[]): string {
  const types: string[] = []
  const seen = new Set<string>()

  for (const ep of endpoints) {
    if (!ep.responseSchema) continue

    // Derive a type name from the path: /api/v1/churches → Churches, /api/v1/churches/{id} → Church
    const segments = ep.path.split('/').filter(Boolean)
    const last = segments[segments.length - 1]
    if (!last || last.startsWith('{')) continue // skip path-param-only segments

    const typeName = last.charAt(0).toUpperCase() + last.slice(1)
    if (seen.has(typeName)) continue
    seen.add(typeName)

    try {
      const typeDecl = jsonSchemaToType(ep.responseSchema as JSONSchema7, typeName + 'Response')
      types.push(typeDecl)
    } catch {
      // Schema too complex — skip
    }
  }

  return types.join('\n\n')
}

/**
 * Build the two tool definitions (search + execute) for the LLM.
 * Accepts endpoints to generate typed response info for the execute tool.
 */
export function buildTools(endpoints: EndpointDescriptor[]): ToolDefinition[] {
  const responseTypes = generateResponseTypes(endpoints)

  const requestTypes = `
interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

declare const api: {
  request(options: RequestOptions): Promise<unknown>;
};

${responseTypes}`

  return [
    {
      type: 'function',
      function: {
        name: 'search',
        description: `Search the OpenAPI spec. All $refs are pre-resolved inline.

Types:
${SPEC_TYPES}

Your code must be an async arrow function that returns the result.

Examples:

// List all paths
async () => {
  const spec = await api.spec();
  return Object.keys(spec.paths);
}

// Find endpoints by keyword
async () => {
  const spec = await api.spec();
  const results = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (typeof op === 'object' && op.summary?.toLowerCase().includes('search_term')) {
        results.push({ method: method.toUpperCase(), path, summary: op.summary, parameters: op.parameters });
      }
    }
  }
  return results;
}

// Get full details for a specific endpoint
async () => {
  const spec = await api.spec();
  return spec.paths['/your/endpoint']?.get;
}`,
        parameters: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'JavaScript async arrow function to search the spec',
            },
          },
          required: ['code'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'execute',
        description: `Execute API calls and return a structured result. First use 'search' to find the right endpoints and their parameters.

Available in your code:
${requestTypes}

Your code must be an async arrow function. Chain multiple requests with filtering, grouping, and transformation logic — do all the work in code, not across multiple tool calls.

Return: { answer: "natural language summary", data: <relevant structured data> }

Examples:

// Chain: fetch, filter, count
async () => {
  const churches = (await api.request({ method: "GET", path: "/api/v1/churches" })).data;
  const phase2 = churches.filter(c => c.currentPhase === 2);
  return {
    answer: \`Found \${phase2.length} phase 2 churches.\`,
    data: phase2.map(c => ({ id: c.id, name: c.name }))
  };
}

// Chain: fetch related resources, join, summarize
async () => {
  const churches = (await api.request({ method: "GET", path: "/api/v1/churches" })).data;
  const people = (await api.request({ method: "GET", path: "/api/v1/people" })).data;
  const phase2Ids = new Set(churches.filter(c => c.currentPhase === 2).map(c => c.id));
  const matched = people.filter(p => phase2Ids.has(p.churchId));
  return {
    answer: \`\${matched.length} people across \${phase2Ids.size} phase 2 churches.\`,
    data: matched
  };
}`,
        parameters: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'JavaScript async arrow function to execute',
            },
          },
          required: ['code'],
          additionalProperties: false,
        },
      },
    },
  ]
}
