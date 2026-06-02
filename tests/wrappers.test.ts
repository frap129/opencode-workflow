// tests/wrappers.test.ts
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  createExploreTool,
  createResearchTool,
  createProgrammerTool,
  createReviewSpecTool,
  createReviewPlanTool,
  createInvestigateTool,
  createVerifySpecComplianceTool,
  createCodeReviewTool,
} from "../src/tools/wrappers"
import { cacheVariant, cacheModel } from "../src/session"

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
  cacheModel("test-session", undefined)
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

  test("preserves model in subtask dispatch", async () => {
    cacheModel("test-session", { providerID: "anthropic", modelID: "claude-sonnet" })
    const { client, calls } = createMockClient()
    const tool = createExploreTool(client)
    await tool.execute(
      { prompt: "Find API handlers" },
      mockContext(testDir)
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].body.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet" })
  })

  test("preserves both model and variant in subtask dispatch", async () => {
    cacheVariant("test-session", "thinking")
    cacheModel("test-session", { providerID: "openai", modelID: "gpt-4o" })
    const { client, calls } = createMockClient()
    const tool = createExploreTool(client)
    await tool.execute(
      { prompt: "Find API handlers" },
      mockContext(testDir)
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].body.variant).toBe("thinking")
    expect(calls[0].body.model).toEqual({ providerID: "openai", modelID: "gpt-4o" })
  })

  test("works without variant or model set in subtask dispatch", async () => {
    const { client, calls } = createMockClient()
    const tool = createExploreTool(client)
    await tool.execute(
      { prompt: "Find API handlers" },
      mockContext(testDir)
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].body.variant).toBeUndefined()
    expect(calls[0].body.model).toBeUndefined()
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
    const tool = createProgrammerTool(client, { getHeadSha: mock(async () => "abc") })
    const result = await tool.execute(
      { task_name: "User registration", prompt: "Implement the user registration endpoint" },
      mockContext(testDir)
    )

    const parsed = JSON.parse(result)
    assertSuccessResult(parsed, "workflow-programmer")

    expect(calls).toHaveLength(1)
    assertDispatchPayload(calls[0], "test-session", "workflow-programmer", "user registration endpoint")
  })

  test("rejects empty prompt", async () => {
    const { client, calls } = createMockClient()
    const tool = createProgrammerTool(client, { getHeadSha: mock(async () => "abc") })
    const result = await tool.execute({ task_name: "Test", prompt: "" }, mockContext(testDir))
    assertErrorResult(JSON.parse(result), "EMPTY_PROMPT")
    expect(calls).toHaveLength(0)
  })

  test("returns error when dispatch fails", async () => {
    const client = {
      session: {
        prompt: mock(async () => { throw new Error("server error") }),
      },
    }
    const tool = createProgrammerTool(client, { getHeadSha: mock(async () => "abc") })
    const result = await tool.execute(
      { task_name: "Test", prompt: "Build something" },
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
    await mkdir(join(testDir, ".opencode/plans"), { recursive: true })
    await writeFile(join(testDir, ".opencode/plans", "my-feature-plan.md"), "# My Feature Plan\n\n## Chunk 1: Foundation\n\nSome content\n")

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
    await mkdir(join(testDir, ".opencode/plans"), { recursive: true })
    await writeFile(join(testDir, ".opencode/plans", "my-feature-plan.md"), "# My Feature Plan\n\n## Chunk 1: Foundation\n\nSome content\n")

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
    await mkdir(join(testDir, ".opencode/plans"), { recursive: true })
    await writeFile(join(testDir, ".opencode/plans", "my-feature-plan.md"), "# My Feature Plan\n\n## Chunk 1: Foundation\n\nSome content\n")

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

// ── template adoption and new tools ─────────────────────────────────

test("explore prepends EXPLORE_TEMPLATE to the dispatched prompt", async () => {
  const { client } = createMockClient()
  const toolDef = createExploreTool(client)
  await toolDef.execute({ prompt: "find bootstrap logic" }, mockContext(testDir))

  const payload = client.session.prompt.mock.calls[0][0]
  expect(payload.body.parts[0].prompt).toContain("Explore the codebase")
  expect(payload.body.parts[0].prompt).toContain("find bootstrap logic")
  expect(payload.body.parts[0].agent).toBe("workflow-explore")
})

test("research prepends RESEARCH_TEMPLATE to the dispatched prompt", async () => {
  const { client } = createMockClient()
  const toolDef = createResearchTool(client)
  await toolDef.execute({ prompt: "find opencode permission docs" }, mockContext(testDir))

  const payload = client.session.prompt.mock.calls[0][0]
  expect(payload.body.parts[0].prompt).toContain("Research the topic")
  expect(payload.body.parts[0].prompt).toContain("find opencode permission docs")
  expect(payload.body.parts[0].agent).toBe("workflow-research")
})

test("review_spec fills the spec document reviewer template", async () => {
  const { client } = createMockClient()
  const toolDef = createReviewSpecTool(client)
  await toolDef.execute({ filename: "feature-spec.md" }, mockContext(testDir))

  const dispatched = client.session.prompt.mock.calls[0][0].body.parts[0].prompt
  expect(dispatched).toContain("feature-spec.md")
  expect(dispatched).toContain("Completeness")
})

test("review_plan extracts and sends only the requested chunk", async () => {
  await mkdir(join(testDir, ".opencode/plans"), { recursive: true })
  await writeFile(
    join(testDir, ".opencode/plans", "feature-plan.md"),
    [
      "# Plan",
      "",
      "## Chunk 1: Foundation",
      "A",
      "",
      "## Chunk 2: Tools",
      "B",
      "",
      "## Chunk 3: Integration",
      "C",
    ].join("\n")
  )

  const { client } = createMockClient()
  const toolDef = createReviewPlanTool(client)
  await toolDef.execute(
    { filename: "feature-plan.md", spec_filename: "feature-spec.md", chunk: 2 },
    mockContext(testDir)
  )

  const dispatched = client.session.prompt.mock.calls[0][0].body.parts[0].prompt
  expect(dispatched).toContain("feature-plan.md")
  expect(dispatched).toContain("feature-spec.md")
  expect(dispatched).toContain("## Chunk 2: Tools")
  expect(dispatched).not.toContain("## Chunk 1: Foundation")
  expect(dispatched).not.toContain("## Chunk 3: Integration")
})

test("review_plan returns CHUNK_NOT_FOUND when the requested chunk header is missing", async () => {
  await mkdir(join(testDir, ".opencode/plans"), { recursive: true })
  await writeFile(join(testDir, ".opencode/plans", "feature-plan.md"), "# Plan\n")

  const { client } = createMockClient()
  const toolDef = createReviewPlanTool(client)
  const raw = await toolDef.execute(
    { filename: "feature-plan.md", chunk: 2 },
    mockContext(testDir)
  )
  const result = JSON.parse(raw)

  expect(result.metadata.queued).toBe(false)
  expect(result.metadata.errorCode).toBe("CHUNK_NOT_FOUND")
  expect(result.output).toContain("Chunk 2")
})

test("review_plan rejects non-positive chunk number", async () => {
  const { client } = createMockClient()
  const toolDef = createReviewPlanTool(client)
  const result = await toolDef.execute(
    { filename: "my-feature-plan.md", chunk: 0 },
    mockContext(testDir)
  )
  assertErrorResult(JSON.parse(result), "INVALID_CHUNK")
  expect(client.session.prompt.mock.calls).toHaveLength(0)
})

test("investigate prepends investigate framing and uses workflow-explore", async () => {
  const { client } = createMockClient()
  const toolDef = createInvestigateTool(client)
  await toolDef.execute({ prompt: "why is bootstrap failing?" }, mockContext(testDir))

  const payload = client.session.prompt.mock.calls[0][0]
  expect(payload.body.parts[0].prompt).toContain("Investigate and debug")
  expect(payload.body.parts[0].prompt).toContain("why is bootstrap failing?")
  expect(payload.body.parts[0].agent).toBe("workflow-explore")
})

test("programmer fills template and records lastBaseSha before dispatch", async () => {
  const { client } = createMockClient()
  const getHeadSha = mock(async () => "1234567890abcdef1234567890abcdef12345678")
  const updateState = mock(() => {})
  const toolDef = createProgrammerTool(client, { getHeadSha, updateState })

  await toolDef.execute(
    {
      task_name: "Add prompt constants",
      prompt: "### Task 1\nImplement prompt constants",
      context: "This is the first task in Chunk 1",
    },
    mockContext(testDir)
  )

  expect(updateState).toHaveBeenCalledWith({
    lastBaseSha: "1234567890abcdef1234567890abcdef12345678",
  })

  const dispatched = client.session.prompt.mock.calls[0][0].body.parts[0].prompt
  expect(dispatched).toContain("Implement prompt constants")
  expect(dispatched).toContain("This is the first task in Chunk 1")
  expect(dispatched).toContain(testDir)
})

test("programmer rejects empty task_name", async () => {
  const { client } = createMockClient()
  const getHeadSha = mock(async () => "abc123")
  const toolDef = createProgrammerTool(client, { getHeadSha })
  const raw = await toolDef.execute(
    { task_name: "", prompt: "do something" },
    mockContext(testDir)
  )
  assertErrorResult(JSON.parse(raw), "EMPTY_TASK_NAME")
})

test("verify_spec_compliance fills requirements and report placeholders", async () => {
  const { client } = createMockClient()
  const toolDef = createVerifySpecComplianceTool(client)
  await toolDef.execute(
    { requirements: "Must add bash tool", report: "Added bash tool and tests" },
    mockContext(testDir)
  )

  const dispatched = client.session.prompt.mock.calls[0][0].body.parts[0].prompt
  expect(dispatched).toContain("Must add bash tool")
  expect(dispatched).toContain("Added bash tool and tests")
})

test("verify_spec_compliance rejects empty requirements", async () => {
  const { client } = createMockClient()
  const toolDef = createVerifySpecComplianceTool(client)
  const raw = await toolDef.execute(
    { requirements: "", report: "some report" },
    mockContext(testDir)
  )
  assertErrorResult(JSON.parse(raw), "EMPTY_REQUIREMENTS")
})

test("verify_spec_compliance rejects empty report", async () => {
  const { client } = createMockClient()
  const toolDef = createVerifySpecComplianceTool(client)
  const raw = await toolDef.execute(
    { requirements: "some requirements", report: "" },
    mockContext(testDir)
  )
  assertErrorResult(JSON.parse(raw), "EMPTY_REPORT")
})

test("code_review falls back to state lastBaseSha and current HEAD", async () => {
  const { client } = createMockClient()
  const getState = mock(() => ({ phase: "implement", lastBaseSha: "base-sha" }))
  const getHeadSha = mock(async () => "head-sha")
  const toolDef = createCodeReviewTool(client, { getState, getHeadSha })

  await toolDef.execute({ description: "Implemented tool registration" }, mockContext(testDir))

  const dispatched = client.session.prompt.mock.calls[0][0].body.parts[0].prompt
  expect(dispatched).toContain("base-sha")
  expect(dispatched).toContain("head-sha")
  expect(dispatched).toContain("Implemented tool registration")
})

test("code_review errors when no explicit or stored base SHA is available", async () => {
  const { client } = createMockClient()
  const getState = mock(() => ({ phase: "implement", lastBaseSha: null }))
  const getHeadSha = mock(async () => "head-sha")
  const toolDef = createCodeReviewTool(client, { getState, getHeadSha })

  const raw = await toolDef.execute({ description: "Implemented tool registration" }, mockContext(testDir))
  const result = JSON.parse(raw)

  expect(result.metadata.queued).toBe(false)
  expect(result.metadata.errorCode).toBe("MISSING_BASE_SHA")
})
