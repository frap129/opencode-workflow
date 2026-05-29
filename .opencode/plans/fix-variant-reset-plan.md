# Fix Model Variant Reset Bug — Implementation Plan

> **For agentic workers:** REQUIRED: Use subagent-driven-development (if subagents available). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the user's model variant when switching agents or dispatching subagents, by migrating prompt calls to the v2 SDK client which supports the `variant` field.

**Architecture:** Create a v2 SDK client alongside the existing v1 client. Add a helper to fetch the current session variant via `v2Client.session.get()`. Migrate all `session.prompt()` calls from the v1 client (which uses `{ path, body }` shape and has no `variant` field) to the v2 client (which uses flat params with `variant` support). The v1 `client` parameter is retained in function signatures only for backward compatibility but is no longer used for prompt calls.

**Tech Stack:** TypeScript, `@opencode-ai/sdk/v2/client`, Bun test runner

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `src/session.ts` | **Create** | v2 client factory + `getSessionVariant()` helper |
| `src/commands.ts` | **Modify** | Accept v2 client, use v2 client for prompt calls with variant |
| `src/tools/wrappers.ts` | **Modify** | Accept v2 client, use v2 client for prompt calls with variant |
| `src/index.ts` | **Modify** | Create v2 client, wire it into commands and tools |
| `tests/session.test.ts` | **Create** | Tests for `getSessionVariant` |
| `tests/commands.test.ts` | **Modify** | Update mocks to v2 shape, add variant preservation tests |
| `tests/wrappers.test.ts` | **Modify** | Update mocks to v2 shape, add variant preservation tests |

---

### Task 1: Create `src/session.ts` — v2 client factory and variant helper

**Files:**

- Create: `src/session.ts`
- Test: `tests/session.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/session.test.ts
import { describe, expect, test } from "bun:test"
import { getSessionVariant } from "../src/session"

describe("getSessionVariant", () => {
  test("returns variant when session has one set", async () => {
    const mockClient = {
      session: {
        get: async () => ({
          data: { model: { id: "anthropic/claude-sonnet", providerID: "anthropic", variant: "thinking" } },
        }),
      },
    }
    const variant = await getSessionVariant(mockClient as any, "sess-1")
    expect(variant).toBe("thinking")
  })

  test("returns undefined when session has no variant", async () => {
    const mockClient = {
      session: {
        get: async () => ({
          data: { model: { id: "anthropic/claude-sonnet", providerID: "anthropic" } },
        }),
      },
    }
    const variant = await getSessionVariant(mockClient as any, "sess-1")
    expect(variant).toBeUndefined()
  })

  test("returns undefined when session has no model", async () => {
    const mockClient = {
      session: {
        get: async () => ({ data: {} }),
      },
    }
    const variant = await getSessionVariant(mockClient as any, "sess-1")
    expect(variant).toBeUndefined()
  })

  test("returns undefined when session.get fails", async () => {
    const mockClient = {
      session: {
        get: async () => { throw new Error("network error") },
      },
    }
    const variant = await getSessionVariant(mockClient as any, "sess-1")
    expect(variant).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/session.test.ts`
Expected: FAIL — module `../src/session` does not exist

- [ ] **Step 3: Implement `src/session.ts`**

```ts
// src/session.ts
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client"

export type V2Client = OpencodeClient

export function createV2Client(serverUrl: URL, directory: string): V2Client {
  return createOpencodeClient({
    baseUrl: serverUrl.toString(),
    directory,
  })
}

export async function getSessionVariant(
  v2Client: V2Client,
  sessionID: string
): Promise<string | undefined> {
  try {
    const response = await v2Client.session.get({ sessionID })
    return response.data?.model?.variant
  } catch {
    return undefined
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/session.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Typecheck**

Run: `bun x tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/session.ts tests/session.test.ts
git commit -m "feat: add v2 client factory and getSessionVariant helper"
```

---

### Task 2: Migrate `src/commands.ts` to use v2 client with variant preservation

**Files:**

- Modify: `src/commands.ts`
- Modify: `tests/commands.test.ts`

**Key change:** All `session.prompt()` calls switch from `client.session.prompt()` (v1, `{ path, body }`) to `v2Client.session.prompt()` (v2, flat params with `variant`).

- [ ] **Step 1: Write failing tests for variant preservation**

Update `tests/commands.test.ts`:

Replace existing `mockClient()` to capture v2-shaped calls (since prompt calls now go through v2Client):

```ts
// The v2 client mock now handles BOTH session.get() AND session.prompt()
function mockV2Client(variant?: string) {
  const calls: any[] = []
  return {
    calls,
    session: {
      get: async () => ({
        data: variant ? { model: { variant } } : {},
      }),
      prompt: async (opts: any) => {
        calls.push(opts)
        return { data: {} }
      },
    },
  }
}
```

Update ALL existing `createCommandHook` calls to pass `v2Client` as the second argument. The old `mockClient()` is no longer needed for prompt calls — replace it with `mockV2Client()`. Update all assertions from v1 shape to v2 shape:
- `call.path.id` → `call.sessionID`
- `call.body.agent` → `call.agent`
- `call.body.parts` → `call.parts`
- `call.body.noReply` → `call.noReply`

Add new variant preservation tests:

```ts
test("preserves model variant when switching to brainstorm agent", async () => {
  const v2Client = mockV2Client("thinking")
  const hook = createCommandHook(
    null, // v1 client no longer used for prompts
    v2Client as any,
    "/test/project",
    mockBootstrapCheck("ready")
  )

  await invokeWorkflowCommand(hook, {
    command: "brainstorm", sessionID: "sess-1", arguments: "test",
  })

  expect(v2Client.calls).toHaveLength(1)
  expect(v2Client.calls[0].variant).toBe("thinking")
  expect(v2Client.calls[0].sessionID).toBe("sess-1")
})

test("works without variant set (variant is undefined)", async () => {
  const v2Client = mockV2Client()
  const hook = createCommandHook(
    null,
    v2Client as any,
    "/test/project",
    mockBootstrapCheck("ready")
  )

  await invokeWorkflowCommand(hook, {
    command: "brainstorm", sessionID: "sess-1", arguments: "test",
  })

  expect(v2Client.calls).toHaveLength(1)
  expect(v2Client.calls[0].variant).toBeUndefined()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/commands.test.ts`
Expected: FAIL — `createCommandHook` does not accept v2Client parameter yet

- [ ] **Step 3: Modify `src/commands.ts`**

Add import:
```ts
import { getSessionVariant, type V2Client } from "./session"
```

Change `createCommandHook` signature:
```ts
export function createCommandHook(
  client: any,
  v2Client: V2Client,
  projectDir: string,
  checkBootstrapFn: (dir: string) => Promise<BootstrapStatus> = defaultCheckBootstrap,
  runBootstrapFn: (dir: string) => Promise<void> = defaultRunBootstrap,
  forceBootstrapFn: (dir: string) => Promise<void> = defaultForceBootstrap
) {
```

Change workflow-init prompt call (around line 102-108) to use v2Client:
```ts
const initVariant = await getSessionVariant(v2Client, input.sessionID)
await v2Client.session.prompt({
  sessionID: input.sessionID,
  noReply: true,
  variant: initVariant,
  parts: [{ type: "text", text: "..." }],
})
```

Change phase command prompt call (around line 140-146) to use v2Client:
```ts
const variant = await getSessionVariant(v2Client, input.sessionID)
await v2Client.session.prompt({
  sessionID: input.sessionID,
  agent,
  variant,
  parts: [{ type: "text", text: entryPrompt }],
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/commands.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Typecheck**

Run: `bun x tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/commands.ts tests/commands.test.ts
git commit -m "fix: preserve model variant in command hook agent switches"
```

---

### Task 3: Migrate `src/tools/wrappers.ts` to use v2 client with variant preservation

**Files:**

- Modify: `src/tools/wrappers.ts`
- Modify: `tests/wrappers.test.ts`

**Key change:** `dispatchSubtask` switches from `client.session.prompt()` (v1) to `v2Client.session.prompt()` (v2) with variant.

- [ ] **Step 1: Write failing tests for variant preservation**

Update `tests/wrappers.test.ts`:

Replace `createMockClient()` with a v2-shaped mock that handles both `get` and `prompt`:

```ts
function createMockV2Client(variant?: string) {
  const calls: any[] = []
  return {
    client: {
      session: {
        get: async () => ({
          data: variant ? { model: { variant } } : {},
        }),
        prompt: async (opts: any) => {
          calls.push(opts)
          return { data: {} }
        },
      },
    },
    calls,
  }
}
```

Update `assertDispatchPayload` to use v2 flat shape:
```ts
function assertDispatchPayload(
  call: any,
  expectedSessionID: string,
  expectedAgent: string,
  promptSubstring: string
) {
  expect(call.sessionID).toBe(expectedSessionID)
  expect(call.noReply).toBe(true)
  expect(call.parts).toHaveLength(1)
  const part = call.parts[0]
  expect(part.type).toBe("subtask")
  expect(part.agent).toBe(expectedAgent)
  expect(part.prompt).toContain(promptSubstring)
  expect(typeof part.description).toBe("string")
  expect(part.description.length).toBeGreaterThan(0)
}
```

Update all tool factory calls to pass `v2Client`:
```ts
// Pattern for all tool creation calls:
const { client: v2Client, calls } = createMockV2Client()
const tool = createExploreTool(null, v2Client as any)  // v1 client no longer used
```

Add variant preservation tests:
```ts
test("preserves model variant in subtask dispatch", async () => {
  const { client: v2Client, calls } = createMockV2Client("thinking")
  const tool = createExploreTool(null, v2Client as any)
  await tool.execute(
    { prompt: "Find API handlers" },
    mockContext(testDir)
  )

  expect(calls).toHaveLength(1)
  expect(calls[0].variant).toBe("thinking")
})

test("works without variant set in subtask dispatch", async () => {
  const { client: v2Client, calls } = createMockV2Client()
  const tool = createExploreTool(null, v2Client as any)
  await tool.execute(
    { prompt: "Find API handlers" },
    mockContext(testDir)
  )

  expect(calls).toHaveLength(1)
  expect(calls[0].variant).toBeUndefined()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/wrappers.test.ts`
Expected: FAIL — tool factories don't accept v2Client parameter yet

- [ ] **Step 3: Modify `src/tools/wrappers.ts`**

Add import:
```ts
import { getSessionVariant, type V2Client } from "./session"
```

Update `dispatchSubtask` to accept v2Client and use it for prompt calls:
```ts
async function dispatchSubtask(
  client: any,
  v2Client: V2Client,
  sessionID: string,
  callerAgent: string,
  targetAgent: string,
  prompt: string,
  description: string,
  metadata: (input: { title?: string; metadata?: Record<string, any> }) => void
): Promise<string> {
  metadata({ title: `Dispatching subtask to ${targetAgent}` })

  try {
    const variant = await getSessionVariant(v2Client, sessionID)
    await v2Client.session.prompt({
      sessionID,
      agent: callerAgent,
      noReply: true,
      variant,
      parts: [
        {
          type: "subtask" as const,
          prompt,
          description,
          agent: targetAgent,
        },
      ],
    })

    return result({
      title: `Queued subtask: ${description}`,
      output: `Subtask dispatched to ${targetAgent}. It will run as a child session.`,
      metadata: { queued: true, targetAgent, description },
    })
  } catch (error: any) {
    return errorResult(
      `Failed to dispatch subtask to ${targetAgent}`,
      `Subtask dispatch failed: ${error.message}`,
      "DISPATCH_FAILED"
    )
  }
}
```

Update all 5 tool factory functions to accept and pass through v2Client:
```ts
export function createExploreTool(client: any, v2Client: V2Client) {
  return tool({
    // ... (description and args unchanged)
    async execute(args, context) {
      const promptError = validatePrompt(args.prompt)
      if (promptError) return promptError

      return dispatchSubtask(
        client,
        v2Client,
        context.sessionID,
        context.agent,
        "workflow-explore",
        args.prompt.trim(),
        `Explore: ${args.prompt.trim().slice(0, 80)}`,
        context.metadata
      )
    },
  })
}
```

Apply the same pattern to `createResearchTool`, `createProgrammerTool`, `createReviewSpecTool`, `createReviewPlanTool`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/wrappers.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Typecheck**

Run: `bun x tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/tools/wrappers.ts tests/wrappers.test.ts
git commit -m "fix: preserve model variant in subtask dispatch"
```

---

### Task 4: Wire v2 client into `src/index.ts`

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Update `src/index.ts` to create v2 client and pass it through**

```ts
import { createV2Client } from "./session"

export async function createPlugin(ctx: {
  client: any
  project?: any
  directory: string
  worktree: string
  serverUrl: URL
  $: any
}) {
  const { client, directory, serverUrl } = ctx
  const v2Client = createV2Client(serverUrl, directory)

  return {
    tool: {
      read_spec: createReadSpecTool(),
      write_spec: createWriteSpecTool(),
      read_plan: createReadPlanTool(),
      write_plan: createWritePlanTool(),

      explore: createExploreTool(client, v2Client),
      research: createResearchTool(client, v2Client),
      programmer: createProgrammerTool(client, v2Client),
      review_spec: createReviewSpecTool(client, v2Client),
      review_plan: createReviewPlanTool(client, v2Client),
    },

    config: createConfigHook(),

    "command.execute.before": createCommandHook(client, v2Client, directory),
  }
}
```

- [ ] **Step 2: Run all tests**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 3: Typecheck**

Run: `bun x tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "fix: wire v2 client into plugin entry for variant preservation"
```

---

## Summary of Changes

The fix adds a v2 SDK client (`@opencode-ai/sdk/v2/client`) that supports the `variant` field on `session.prompt()`. Before each agent-switching prompt call, `getSessionVariant()` fetches the current session's variant via `v2Client.session.get()` and passes it through to `v2Client.session.prompt()`, preventing the server from resetting it to `undefined` during agent switches.

**Key design decisions:**
- All `session.prompt()` calls are migrated from v1 client to v2 client. The v1 `client` param is retained in signatures for backward compatibility but is no longer used for prompt calls.
- `getSessionVariant` gracefully returns `undefined` on any error, so a failed variant fetch never blocks agent switching.
- No changes to agent frontmatter — variant is preserved dynamically from the session state rather than hardcoded per-agent.
