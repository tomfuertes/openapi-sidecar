# openapi-sidecar — Implementation Plan

**Package:** `openapi-sidecar`
**Repo:** `~/sandbox/git-repos/openapi-sidecar`
**npm:** `openapi-sidecar` (confirmed available)
**Date:** 2026-04-06
**Demo deadline:** April 20 (internal), April 22 (public)

---

## What It Is

A TypeScript SDK that takes an OpenAPI spec + auth credentials + a natural language query → explores the API via LLM-generated code executed in a sandbox → returns a structured JSON answer.

Built on `@cloudflare/codemode` (platform-agnostic core) with a custom `NodeExecutor` using `isolated-vm`. Model-agnostic via OpenRouter-compatible (OpenAI chat completions) LLM client.

## Architecture

```
Consumer
  │
  ▼
OpenAPISidecar({ spec, auth, llm })
  │
  ├── SpecParser          ← loads + dereferences OpenAPI 3.x spec
  │                         uses @apidevtools/swagger-parser
  │
  ├── TypeGenerator       ← @cloudflare/codemode core
  │                         Zod schemas → TS type defs for LLM context
  │
  ├── CodeSanitizer       ← @cloudflare/codemode core
  │                         AST validation via acorn
  │
  ├── AgentLoop           ← owns the LLM conversation
  │   │                     max N iterations (tunable, default 5)
  │   │                     bias to single-shot (code-mode strength)
  │   │
  │   ├── LLMClient       ← OpenAI-compatible chat completions
  │   │                     fetch-based, no SDK dependency
  │   │                     configurable: baseUrl, apiKey, model
  │   │
  │   └── Sandbox         ← executes LLM-generated code
  │       │
  │       └── NodeExecutor ← implements @cloudflare/codemode Executor interface
  │                          uses isolated-vm
  │                          proxy pattern: sandbox calls stubs,
  │                          host intercepts + injects auth + makes real HTTP requests
  │                          secrets never enter sandbox
  │
  └── ResponseFormatter   ← shapes output as { answer, data, meta }
```

## Error Model

- **Recoverable** (API 4xx/5xx, unexpected response shape, missing data) → agent self-corrects in next iteration within budget
- **Unrecoverable** (sandbox timeout, AST validation failure, auth rejected) → throw immediately to consumer

## Public API

```typescript
import { OpenAPISidecar } from 'openapi-sidecar'

const sidecar = new OpenAPISidecar({
  spec: './openapi.yaml',              // path, URL, or parsed object
  auth: { bearer: process.env.API_TOKEN },
  llm: {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_KEY,
    model: 'anthropic/claude-sonnet-4-20250514',
  },
  maxIterations: 5,                    // default 5, set 1 for pure single-shot
})

const result = await sidecar.query(
  "Where are we at in our current phase?"
)

// result: {
//   answer: string,          ← natural language summary
//   data: unknown,           ← raw structured data from API calls
//   meta: {
//     iterations: number,    ← how many agent loop cycles
//     endpoints_called: string[],  ← which API paths were hit
//     tokens: { prompt: number, completion: number },
//   }
// }
```

## Auth Config

MVP: simple bag of credentials.

```typescript
// Bearer token (most common)
auth: { bearer: 'xxx' }

// Custom header
auth: { header: { 'X-Api-Key': 'xxx' } }

// Query param
auth: { query: { api_key: 'xxx' } }

// Basic auth
auth: { basic: { username: 'x', password: 'y' } }
```

## Dependencies

### Runtime
- `@cloudflare/codemode` — type generation, code sanitization, Executor interface (zero-dep main entry)
- `isolated-vm` — V8 sandbox for NodeExecutor
- `@apidevtools/swagger-parser` — OpenAPI spec loading + $ref resolution
- `zod` — schema validation (peer dep, shared with codemode)

### Dev
- `typescript`
- `tsup` — build/bundle
- `vitest` — tests (when we get to eval suite)

## File Structure

```
openapi-sidecar/
├── src/
│   ├── index.ts                 ← public API: OpenAPISidecar class + types
│   ├── spec-parser.ts           ← load + dereference OpenAPI spec
│   ├── agent-loop.ts            ← LLM conversation loop (max iterations, code-mode bias)
│   ├── llm-client.ts            ← OpenAI-compatible chat completions (raw fetch)
│   ├── node-executor.ts         ← Executor impl using isolated-vm
│   ├── auth.ts                  ← auth config → request interceptor mapping
│   ├── prompt.ts                ← system prompt construction from spec + types
│   └── types.ts                 ← SidecarConfig, QueryResult, AuthConfig, etc.
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── PLAN.md                      ← this file
└── .gitignore
```

## Implementation Order

### Phase 1: Skeleton + spec parsing (~2 hours)
1. `package.json` with deps, scripts, tsup config
2. `tsconfig.json`
3. `types.ts` — all interfaces defined
4. `spec-parser.ts` — load OpenAPI spec from path/URL/object, dereference $refs
5. `index.ts` — `OpenAPISidecar` class shell with `query()` stub
6. Verify: can load EveryField's spec (once Hono API is up)

### Phase 2: LLM client + prompt engineering (~3 hours)
1. `llm-client.ts` — raw fetch to OpenAI-compatible endpoint, streaming optional
2. `prompt.ts` — construct system prompt:
   - Inject type definitions from spec (via @cloudflare/codemode type generator)
   - Inject available endpoint descriptions
   - Instruct LLM to write async JS function using `sidecar.*` proxy calls
   - Instruct to return structured data + natural language summary
3. Verify: LLM generates reasonable code for a sample query against a test spec

### Phase 3: NodeExecutor + sandbox (~3 hours)
1. `node-executor.ts` — implement `Executor` interface
   - Create isolated-vm isolate with timeout + memory limit
   - Inject proxy functions that route `sidecar.*` calls to host
   - Host-side: intercept calls, inject auth headers, make real HTTP requests
   - Capture console output
   - Return result or error
2. `auth.ts` — map auth config to request interceptor (adds headers/params)
3. Verify: can execute LLM-generated code, make real API calls, return data

### Phase 4: Agent loop + response formatting (~2 hours)
1. `agent-loop.ts` — the core loop:
   - Send prompt to LLM
   - Extract code from response
   - AST-validate via @cloudflare/codemode sanitizer
   - Execute in sandbox
   - If recoverable error + iterations remaining → feed error back to LLM → loop
   - If unrecoverable error → throw
   - If success → format response
2. Wire everything together in `index.ts`
3. Verify: end-to-end `sidecar.query("...")` against a live API

### Phase 5: EveryField integration (~2 hours)
1. In everyfield_v2 repo: `pnpm link ../openapi-sidecar`
2. Create a test script or API route that runs:
   ```typescript
   const sidecar = new OpenAPISidecar({
     spec: 'http://localhost:3000/api/v1/doc',
     auth: { bearer: DEV_TOKEN },
     llm: { baseUrl: OPENROUTER_URL, apiKey: OR_KEY, model: '...' }
   })
   const result = await sidecar.query("Where are we at in our current phase?")
   ```
3. Iterate on prompt engineering until the answer is useful
4. Wire into a dashboard widget or cron endpoint for demo day

## What's NOT in scope (future/hardening)

- Cloudflare DynamicWorkerExecutor adapter
- Plugin system for non-OpenAPI input formats
- OAuth2 token refresh
- Write/mutation support in the SDK
- Spec-aware auth validation (parsing securitySchemes)
- Hosted SaaS version with OpenRouter billing passthrough
- Eval suite / automated testing
- Web UI for managing specs + queries
- npm publish (do this after demo day)

## Competitive Positioning

Built on `@cloudflare/codemode`'s open-source core (type gen, code sanitization, Executor interface) but differs:
- **Platform-agnostic** — runs on any Node.js host via isolated-vm, not Cloudflare-locked
- **Model-agnostic** — any OpenRouter / OpenAI-compatible provider
- **Consumer-friendly** — one-line `query()` API, not MCP server plumbing
- **Standalone** — works as library or CLI, no Cloudflare account needed

## Related Issues

- SebastianGarces/everyfield_v2#1 — Hono API layer (prerequisite for EveryField integration)
