// tests/wrappers.test.ts
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  createExploreTool,
  createResearchTool,
  createProgrammerTool,
  createReviewSpecTool,
  createReviewPlanTool,
} from "../src/tools/wrappers"
import { cacheVariant } from "../src/session"

/**
 * Creates a mock client that records calls to session.prompt().
 * Uses v1 shape: { path: { id }, body: { ... } }
 */
function createMockClient() {
  const calls: any[] = []
  const client = {
    session: {
      prompt: mock(async (options: any) => {
        calls.push(options)
        return { data: { id: "msg-123" } }
      }),
    },
  }
  return { client, calls }
}

function mockContext(directory: string) {
  return {
    sessionID: "test-session",
    messageID: "test-message",
    agent: "workflow-brainstorm",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  } as any
}

/**
 * Assert the full dispatch payload shape matches v1 subtask requirements.
 * Verifies: path.id, body.noReply, single part with type/prompt/description/agent.
 */
function assertDispatchPayload(
  call: any,
  expectedSessionID: string,
  expectedAgent: string,
  promptSubstring: string
) {
  expect(call.path.id).toBe(expectedSessionID)
  expect(call.body.noReply).toBe(true)
  expect(call.body.parts).toHaveLength(1)
  const part = call.body.parts[0]
  expect(part.type).toBe("subtask")
  expect(part.agent).toBe(expectedAgent)
  expect(part.prompt).toContain(promptSubstring)
  expect(typeof part.description).toBe("string")
  expect(part.description.length).toBeGreaterThan(0)
}

/**
 * Assert the full structured success result shape.
 * Verifies: title, output, metadata.queued, metadata.targetAgent, metadata.description.
 */
function assertSuccessResult(parsed: any, expectedAgent: string) {
  expect(typeof parsed.title).toBe("string")
  expect(parsed.title.length).toBeGreaterThan(0)
  expect(typeof parsed.output).toBe("string")
  expect(parsed.output.length).toBeGreaterThan(0)
  expect(parsed.metadata.queued).toBe(true)
  expect(parsed.metadata.targetAgent).toBe(expectedAgent)
  expect(typeof parsed.metadata.description).toBe("string")
  expect(parsed.metadata.description.length).toBeGreaterThan(0)
}

/**
 * Assert the full structured error result shape.
 * Verifies: title, output, metadata.queued=false, metadata.errorCode.
 */
function assertErrorResult(parsed: any, expectedErrorCode: string) {
  expect(typeof parsed.title).toBe("string")
  expect(parsed.title.length).toBeGreaterThan(0)
  expect(typeof parsed.output).toBe("string")
  expect(parsed.output.length).toBeGreaterThan(0)
  expect(parsed.metadata.queued).toBe(false)
  expect(parsed.metadata.errorCode).toBe(expectedErrorCode)
}

let testDir: string

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "wf-wrappers-"))
  cacheVariant("test-session", undefined)
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

// ── explore ─────────────────────────────────────────────────────────

describe("explore", () => {
  test("dispatches subtask to workflow-explore with correct prompt", async () => {
    const { client, calls } = createMockClient()
    const tool = createExploreTool(client)
    const result = await tool.execute(
      { prompt: "Find all API endpoint handlers" },
      mockContext(testDir)
    )

    const parsed = JSON.parse(result)
    assertSuccessResult(parsed, "workflow-explore")

    expect(calls).toHaveLength(1)
    assertDispatchPayload(calls[0], "test-session", "workflow-explore", "Find all API endpoint handlers")
  })

  test("rejects empty prompt", async () => {
    const { client, calls } = createMockClient()
    const tool = createExploreTool(client)
    const result = await tool.execute(
      { prompt: "" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "EMPTY_PROMPT")
    expect(calls).toHaveLength(0)
  })

  test("rejects whitespace-only prompt", async () => {
    const { client, calls } = createMockClient()
    const tool = createExploreTool(client)
    const result = await tool.execute(
      { prompt: "   " },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "EMPTY_PROMPT")
    expect(calls).toHaveLength(0)
  })

  test("returns error when subtask dispatch fails", async () => {
    const client = {
      session: {
        prompt: mock(async () => {
          throw new Error("network failure")
        }),
      },
    }
    const tool = createExploreTool(client)
    const result = await tool.execute(
      { prompt: "Find API handlers" },
      mockContext(testDir)
    )

    const parsed = JSON.parse(result)
    assertErrorResult(parsed, "DISPATCH_FAILED")
    expect(parsed.output).toContain("network failure")
  })

  test("preserves model variant in subtask dispatch", async () => {
    cacheVariant("test-session", "thinking")
    const { client, calls } = createMockClient()
    const tool = createExploreTool(client)
    await tool.execute(
      { prompt: "Find API handlers" },
      mockContext(testDir)
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].body.variant).toBe("thinking")
  })

  test("works without variant set in subtask dispatch", async () => {
    const { client, calls } = createMockClient()
    const tool = createExploreTool(client)
    await tool.execute(
      { prompt: "Find API handlers" },
      mockContext(testDir)
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].body.variant).toBeUndefined()
  })
})

// ── research ────────────────────────────────────────────────────────

describe("research", () => {
  test("dispatches subtask to workflow-research with correct prompt", async () => {
    const { client, calls } = createMockClient()
    const tool = createResearchTool(client)
    const result = await tool.execute(
      { prompt: "Investigate OAuth2 token refresh patterns" },
      mockContext(testDir)
    )

    const parsed = JSON.parse(result)
    assertSuccessResult(parsed, "workflow-research")

    expect(calls).toHaveLength(1)
    assertDispatchPayload(calls[0], "test-session", "workflow-research", "OAuth2 token refresh")
  })

  test("rejects empty prompt", async () => {
    const { client, calls } = createMockClient()
    const tool = createResearchTool(client)
    const result = await tool.execute({ prompt: "" }, mockContext(testDir))
    assertErrorResult(JSON.parse(result), "EMPTY_PROMPT")
    expect(calls).toHaveLength(0)
  })

  test("returns error when dispatch fails", async () => {
    const client = {
      session: {
        prompt: mock(async () => { throw new Error("timeout") }),
      },
    }
    const tool = createResearchTool(client)
    const result = await tool.execute(
      { prompt: "Research something" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "DISPATCH_FAILED")
  })
})

// ── programmer ──────────────────────────────────────────────────────

describe("programmer", () => {
  test("dispatches subtask to workflow-programmer with correct prompt", async () => {
    const { client, calls } = createMockClient()
    const tool = createProgrammerTool(client)
    const result = await tool.execute(
      { prompt: "Implement the user registration endpoint" },
      mockContext(testDir)
    )

    const parsed = JSON.parse(result)
    assertSuccessResult(parsed, "workflow-programmer")

    expect(calls).toHaveLength(1)
    assertDispatchPayload(calls[0], "test-session", "workflow-programmer", "user registration endpoint")
  })

  test("rejects empty prompt", async () => {
    const { client, calls } = createMockClient()
    const tool = createProgrammerTool(client)
    const result = await tool.execute({ prompt: "" }, mockContext(testDir))
    assertErrorResult(JSON.parse(result), "EMPTY_PROMPT")
    expect(calls).toHaveLength(0)
  })

  test("returns error when dispatch fails", async () => {
    const client = {
      session: {
        prompt: mock(async () => { throw new Error("server error") }),
      },
    }
    const tool = createProgrammerTool(client)
    const result = await tool.execute(
      { prompt: "Build something" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "DISPATCH_FAILED")
  })
})

// ── review_spec ─────────────────────────────────────────────────────

describe("review_spec", () => {
  test("dispatches subtask to workflow-reviewer for spec review", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewSpecTool(client)
    const result = await tool.execute(
      { filename: "my-feature-spec.md" },
      mockContext(testDir)
    )

    const parsed = JSON.parse(result)
    assertSuccessResult(parsed, "workflow-reviewer")

    expect(calls).toHaveLength(1)
    assertDispatchPayload(calls[0], "test-session", "workflow-reviewer", "my-feature-spec.md")
    expect(calls[0].body.parts[0].prompt).toContain("spec")
  })

  test("includes optional prompt in subtask", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewSpecTool(client)
    await tool.execute(
      { filename: "my-feature-spec.md", prompt: "Focus on security concerns" },
      mockContext(testDir)
    )

    expect(calls[0].body.parts[0].prompt).toContain("Focus on security concerns")
  })

  test("rejects invalid spec filename", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewSpecTool(client)
    const result = await tool.execute(
      { filename: "my-feature-plan.md" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "INVALID_FILENAME")
    expect(calls).toHaveLength(0)
  })

  test("rejects path traversal in filename", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewSpecTool(client)
    const result = await tool.execute(
      { filename: "../escape-spec.md" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "INVALID_FILENAME")
    expect(calls).toHaveLength(0)
  })

  test("rejects absolute path in filename", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewSpecTool(client)
    const result = await tool.execute(
      { filename: "/tmp/evil-spec.md" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "INVALID_FILENAME")
    expect(calls).toHaveLength(0)
  })

  test("returns error when dispatch fails", async () => {
    const client = {
      session: {
        prompt: mock(async () => { throw new Error("dispatch error") }),
      },
    }
    const tool = createReviewSpecTool(client)
    const result = await tool.execute(
      { filename: "my-feature-spec.md" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "DISPATCH_FAILED")
  })
})

// ── review_plan ─────────────────────────────────────────────────────

describe("review_plan", () => {
  test("dispatches subtask to workflow-reviewer for plan review", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewPlanTool(client)
    const result = await tool.execute(
      { filename: "my-feature-plan.md" },
      mockContext(testDir)
    )

    const parsed = JSON.parse(result)
    assertSuccessResult(parsed, "workflow-reviewer")

    expect(calls).toHaveLength(1)
    assertDispatchPayload(calls[0], "test-session", "workflow-reviewer", "my-feature-plan.md")
    expect(calls[0].body.parts[0].prompt).toContain("plan")
  })

  test("includes optional prompt in subtask", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewPlanTool(client)
    await tool.execute(
      { filename: "my-feature-plan.md", prompt: "Check task granularity" },
      mockContext(testDir)
    )

    expect(calls[0].body.parts[0].prompt).toContain("Check task granularity")
  })

  test("rejects invalid plan filename", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewPlanTool(client)
    const result = await tool.execute(
      { filename: "my-feature-spec.md" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "INVALID_FILENAME")
    expect(calls).toHaveLength(0)
  })

  test("rejects path traversal in filename", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewPlanTool(client)
    const result = await tool.execute(
      { filename: "../escape-plan.md" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "INVALID_FILENAME")
    expect(calls).toHaveLength(0)
  })

  test("rejects absolute path in filename", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewPlanTool(client)
    const result = await tool.execute(
      { filename: "/tmp/evil-plan.md" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "INVALID_FILENAME")
    expect(calls).toHaveLength(0)
  })

  test("returns error when dispatch fails", async () => {
    const client = {
      session: {
        prompt: mock(async () => { throw new Error("dispatch error") }),
      },
    }
    const tool = createReviewPlanTool(client)
    const result = await tool.execute(
      { filename: "my-feature-plan.md" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "DISPATCH_FAILED")
  })
})
