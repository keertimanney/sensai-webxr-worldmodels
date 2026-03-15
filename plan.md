# AI Agent Architecture Plan

## Context

We need a two-tier AI agent system for the WebXR room viewer. A **Main Agent** orchestrates **Scout subagents** that analyze specific room objects (couch, TV, dining table, etc.) via screenshots and suggest alternatives. The user interacts only with the Main Agent through a chat panel. For the prototype, object screenshots are manually placed in an `attributes/` directory.

**SDK choice: Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`) — gives us `generateObject()` with Zod for type-safe structured output, `streamText()` for streaming chat, provider abstraction, and built-in tool calling. Since the SDK is server-side, we use a Vite `configureServer` plugin to expose API routes — no separate backend needed.

---

## Architecture Overview

```
Browser                                    Vite Dev Server
┌──────────────────────┐                  ┌──────────────────────────────┐
│  Chat Panel (DOM)    │  fetch /api/*    │  Vite Plugin (configureServer)│
│  ┌────────────────┐  │ ──────────────►  │  ┌──────────────────────┐    │
│  │ ChatManager    │  │                  │  │ POST /api/chat       │    │
│  │ (browser-side) │  │  ◄────────────── │  │  → MainAgent         │    │
│  └────────────────┘  │  streamed JSON   │  │  → ScoutAgent(s)     │    │
│                      │                  │  │  → Vercel AI SDK     │    │
│  3D Scene (Three.js) │                  │  │  → Claude API        │    │
└──────────────────────┘                  │  └──────────────────────┘    │
                                          └──────────────────────────────┘
```

The browser only does `fetch('/api/chat', { body: userMessage })`. All LLM logic lives server-side in the Vite plugin, where the Vercel AI SDK has full Node.js access.

---

## 1. Attributes Directory Structure

Under `public/attributes/` (served as static assets by Vite):

```
public/attributes/
  manifest.json              ← master index of all objects
  couch/
    screenshot_front.png
    metadata.json
  television/
    screenshot_front.png
    metadata.json
  dining_table/
    screenshot_front.png
    metadata.json
```

**manifest.json** — lists all objects with IDs, labels, categories, approximate world positions, and screenshot paths.

**metadata.json** (per object) — description, style, material, color, and screenshot entries with view angles.

---

## 2. New Files

```
src/
  server/
    apiPlugin.ts        ← Vite plugin with configureServer hook, exposes POST /api/chat
    mainAgent.ts        ← MainAgent: conversation mgmt, planning via generateObject(), scout dispatch
    scoutAgent.ts       ← ScoutAgent: vision analysis via generateObject() with Zod schema
    prompts.ts          ← system prompts for main agent and scouts
    schemas.ts          ← Zod schemas: AgentPlan, ScoutResult, Alternative
  agents/
    types.ts            ← shared TypeScript interfaces (used by both server and browser)
    chatManager.ts      ← browser-side: DOM chat panel, fetch to /api/chat, render responses
```

**Modified files:**
- `vite.config.ts` — register the `apiPlugin`
- `index.ts` — create `ChatManager`, wire to DOM after scene loads
- `index.html` — add chat panel HTML
- `package.json` — add `ai`, `@ai-sdk/anthropic`, `zod`

---

## 3. End-to-End Flow

User asks: *"Can you suggest alternatives for the couch?"*

```
Browser                          Server (Vite plugin)
───────                          ────────────────────
1. User types message
2. ChatManager → fetch POST /api/chat
   { message: "suggest alternatives for the couch", history: [...] }
                                 3. MainAgent.plan()
                                    └─ generateObject() with Zod AgentPlan schema
                                    └─ Claude returns: { needsScouts: true, targets: ["couch"] }
                                 4. ScoutAgent.analyze("couch")
                                    └─ reads public/attributes/couch/screenshot_front.png
                                    └─ reads public/attributes/couch/metadata.json
                                    └─ generateObject() with vision + Zod ScoutResult schema
                                    └─ Claude returns: { analysis: "...", alternatives: [...] }
                                 5. MainAgent.synthesize(scoutResults)
                                    └─ streamText() with conversation + scout results
                                    └─ streams response back
6. ChatManager renders streamed
   response in chat panel
```

**3 LLM calls**: plan (`generateObject`) → scout vision (`generateObject`) → synthesize (`streamText`)

---

## 4. Key Components

### Vite API Plugin (`src/server/apiPlugin.ts`)
- `configureServer` hook adds `POST /api/chat` middleware
- Parses request body (message + conversation history)
- Instantiates MainAgent + ScoutAgent with Vercel AI SDK
- Returns streaming response via `streamText().toDataStreamResponse()`
- Reads `ANTHROPIC_API_KEY` from `.env` (server-side, never exposed to browser)

### Zod Schemas (`src/server/schemas.ts`)
```typescript
// Planning step — structured output
const AgentPlanSchema = z.object({
  needsScouts: z.boolean(),
  targetObjects: z.array(z.string()),    // object IDs from manifest
  scoutObjective: z.string(),
  directResponse: z.string().optional(), // if no scouts needed
});

// Scout result — structured output from vision call
const ScoutResultSchema = z.object({
  analysis: z.string(),
  alternatives: z.array(z.object({
    name: z.string(),
    description: z.string(),
    style: z.string(),
    reasoning: z.string(),
  })),
});
```

### MainAgent (`src/server/mainAgent.ts`)
- **plan()**: `generateObject({ schema: AgentPlanSchema, ... })` — decides which objects need scouts
- **dispatchScouts()**: runs ScoutAgent.analyze() in parallel via `Promise.all()`
- **synthesize()**: `streamText()` — converts scout results into conversational streamed response
- State: `idle → planning → scouting → synthesizing → done`

### ScoutAgent (`src/server/scoutAgent.ts`)
- Stateless — single `generateObject()` call per task
- Reads screenshot from filesystem (`fs.readFileSync`), converts to base64
- Sends as image content block with metadata context
- Returns Zod-validated `ScoutResult` — no manual JSON parsing needed

### ChatManager (`src/agents/chatManager.ts`) — browser-side
- Binds to DOM elements (input, messages container, send button)
- `fetch('/api/chat', { method: 'POST', body })` on send
- Reads streaming response, renders tokens incrementally
- Shows typing indicator during request
- Maintains conversation history client-side

---

## 5. Prototype Scope

### Build now:
- `src/server/` — apiPlugin, mainAgent, scoutAgent, prompts, schemas
- `src/agents/` — types, chatManager
- Chat panel HTML/CSS in `index.html`
- `public/attributes/` with 2-3 hand-placed objects + screenshots
- `.env` with `ANTHROPIC_API_KEY` (server-side only, secure)
- Wiring: `vite.config.ts` + `index.ts`

### Stub/skip for prototype:
- Scout visual spheres navigating the scene (just do the LLM calls)
- ECS components for agent state
- Companion color changes based on agent state
- XR spatial result panels (desktop chat is sufficient)

### Deferred to production:
- Automatic screenshot generation from rendered scene
- Dedicated backend (Vercel Edge Functions / Cloudflare Worker)
- Voice input/output
- Object replacement visualization in 3D
- Multi-room support

---

## 6. Implementation Order

1. **Dependencies + API plugin** — install `ai`, `@ai-sdk/anthropic`, `zod`; create `apiPlugin.ts` with a basic echo endpoint; add `.env`; register plugin in `vite.config.ts`
2. **Schemas + Scout** — `schemas.ts`, `scoutAgent.ts`; test with a single screenshot via curl to `/api/chat`
3. **Main Agent** — `mainAgent.ts`, `prompts.ts`; test full plan→scout→synthesize flow
4. **Chat UI** — `chatManager.ts`, `index.html` additions, wire in `index.ts`
5. **Attributes data** — create manifest + metadata for 2-3 objects, place screenshots
6. **End-to-end test** — full flow from chat input to streamed response

---

## 7. Verification

- `npm run dev` starts Vite with the API plugin active
- `curl -X POST http://localhost:8081/api/chat -H 'Content-Type: application/json' -d '{"message":"hello"}'` — verify server responds
- Open browser, check chat panel renders at bottom of screen
- Type "What objects are in this room?" → main agent responds from manifest (no scouts, direct response)
- Type "Suggest alternatives for the couch" → scout dispatched → vision analysis → streamed response with alternatives
- Check terminal for Vercel AI SDK logs
- Verify API key is **not** in browser network tab (server-side only)
