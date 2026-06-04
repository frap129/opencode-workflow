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
  dispatchSubtask,
  extractTask,
} from "../src/tools/wrappers"
import { cacheVariant, cacheModel } from "../src/session"
import { getState, resetState, updateState } from "../src/state"

/**
 * Creates a mock client that records calls to session.prompt().
 * Returns text parts so the direct synchronous path is taken.
 */
function createMockClient() {
  const calls: any[] = []
  const client = {
    session: {
      prompt: mock(async (options: any) => {
        calls.push(options)
        return { data: { info: {}, parts: [{ type: "text", text: "Subtask completed successfully." }] } }
      }),
      children: mock(async () => ({ data: [] })),
      messages: mock(async () => ({ data: [] })),
    },
    event: {
      subscribe: mock(async () => ({
        stream: (async function* () {})(),
      })),
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
  expect(call.body.noReply).toBe(false)
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
  expect(parsed.metadata.queued).toBe(false)
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
  resetState()
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
        children: mock(async () => ({ data: [] })),
        messages: mock(async () => ({ data: [] })),
      },
      event: {
        subscribe: mock(async () => ({
          stream: (async function* () {})(),
        })),
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
        children: mock(async () => ({ data: [] })),
        messages: mock(async () => ({ data: [] })),
      },
      event: { subscribe: mock(async () => ({ stream: (async function* () {})() })) },
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

const samplePlanText = [
  "# Implementation Plan",
  "",
  "## Chunk 1: Setup",
  "",
  "### Task 1: Add constants",
  "",
  "Step 1: Write test...",
  "Step 2: Implement...",
  "",
  "### Task 2: Add middleware",
  "",
  "Step 1: Write middleware test...",
  "",
  "### Task 3: Final wiring",
  "",
  "Step 1: Wire it up...",
].join("\n")

function programmerDeps(overrides: {
  activePlanFilename?: string | null
  planText?: string | null
  headSha?: string
} = {}) {
  return {
    getState: mock(() => ({
      phase: "implement" as const,
      lastBaseSha: null,
      dispatchInProgress: false,
      activePlanFilename: "activePlanFilename" in overrides ? overrides.activePlanFilename! : "my-plan.md",
    })),
    readPlanFile: mock(async () => {
      if (overrides.planText === null) throw new Error("ENOENT")
      return overrides.planText ?? samplePlanText
    }),
    getHeadSha: mock(async () => overrides.headSha ?? "abc123"),
    updateState: mock(() => {}),
  }
}

describe("programmer", () => {
  test("rejects task: 0 -> INVALID_TASK_NUMBER", async () => {
    const { client } = createMockClient()
    const tool = createProgrammerTool(client, programmerDeps())
    const result = await tool.execute({ task: 0 }, mockContext(testDir))
    assertErrorResult(JSON.parse(result), "INVALID_TASK_NUMBER")
  })

  test("rejects negative task -> INVALID_TASK_NUMBER", async () => {
    const { client } = createMockClient()
    const tool = createProgrammerTool(client, programmerDeps())
    const result = await tool.execute({ task: -1 }, mockContext(testDir))
    assertErrorResult(JSON.parse(result), "INVALID_TASK_NUMBER")
  })

  test("rejects non-integer task -> INVALID_TASK_NUMBER", async () => {
    const { client } = createMockClient()
    const tool = createProgrammerTool(client, programmerDeps())
    const result = await tool.execute({ task: 1.5 }, mockContext(testDir))
    assertErrorResult(JSON.parse(result), "INVALID_TASK_NUMBER")
  })

  test("rejects old-style { task_name, prompt } input -> INVALID_TASK_NUMBER", async () => {
    const { client } = createMockClient()
    const tool = createProgrammerTool(client, programmerDeps())
    const result = await tool.execute(
      { task_name: "some-task", prompt: "do stuff" } as any,
      mockContext(testDir),
    )
    assertErrorResult(JSON.parse(result), "INVALID_TASK_NUMBER")
  })

  test("fails with NO_ACTIVE_PLAN when activePlanFilename is null", async () => {
    const { client } = createMockClient()
    const deps = programmerDeps({ activePlanFilename: null })
    const tool = createProgrammerTool(client, deps)
    const result = await tool.execute({ task: 1 }, mockContext(testDir))
    const parsed = JSON.parse(result)
    assertErrorResult(parsed, "NO_ACTIVE_PLAN")
    expect(parsed.output).toContain("read_plan")
    expect(parsed.output).toContain("write_plan")
    expect(parsed.output).toContain("edit_plan")
    expect(parsed.output).toContain("review_plan")
  })

  test("fails with PLAN_READ_FAILED when active plan file cannot be read", async () => {
    const { client } = createMockClient()
    const tool = createProgrammerTool(client, programmerDeps({ planText: null }))
    const result = await tool.execute({ task: 1 }, mockContext(testDir))
    const parsed = JSON.parse(result)
    assertErrorResult(parsed, "PLAN_READ_FAILED")
    expect(parsed.output).toContain("my-plan.md")
  })

  test("fails with TASK_NOT_FOUND when task number missing from plan", async () => {
    const { client } = createMockClient()
    const tool = createProgrammerTool(client, programmerDeps())
    const result = await tool.execute({ task: 99 }, mockContext(testDir))
    const parsed = JSON.parse(result)
    assertErrorResult(parsed, "TASK_NOT_FOUND")
    expect(parsed.output).toContain("### Task 99:")
  })

  test("fails with DUPLICATE_TASK when task heading appears more than once", async () => {
    const dupPlan = "### Task 1: First\ncontent\n### Task 1: Second\ncontent"
    const { client } = createMockClient()
    const tool = createProgrammerTool(client, programmerDeps({ planText: dupPlan }))
    const result = await tool.execute({ task: 1 }, mockContext(testDir))
    assertErrorResult(JSON.parse(result), "DUPLICATE_TASK")
  })

  test("dispatches with verbatim extracted task block, excludes later tasks, includes notes, records lastBaseSha", async () => {
    const { client, calls } = createMockClient()
    const deps = programmerDeps({ headSha: "sha-abc" })
    const tool = createProgrammerTool(client, deps)
    const result = await tool.execute(
      { task: 2, notes: "Focus on error handling" },
      mockContext(testDir)
    )

    const parsed = JSON.parse(result)
    assertSuccessResult(parsed, "workflow-programmer")

    expect(deps.updateState).toHaveBeenCalledWith({ lastBaseSha: "sha-abc" })

    expect(calls).toHaveLength(1)
    const dispatched = calls[0].body.parts[0].prompt
    expect(dispatched).toContain("### Task 2: Add middleware")
    expect(dispatched).toContain("Step 1: Write middleware test...")
    expect(dispatched).not.toContain("### Task 3")
    expect(dispatched).not.toContain("### Task 1")
    expect(dispatched).toContain("Focus on error handling")
    expect(calls[0].body.parts[0].description).toBe("Implement: Add middleware")
  })

  test("dispatches with 'No additional notes provided.' when notes omitted", async () => {
    const { client, calls } = createMockClient()
    const tool = createProgrammerTool(client, programmerDeps())
    await tool.execute({ task: 1 }, mockContext(testDir))

    const dispatched = calls[0].body.parts[0].prompt
    expect(dispatched).toContain("No additional notes provided.")
  })

  test("returns error when dispatch fails", async () => {
    const client = {
      session: {
        prompt: mock(async () => { throw new Error("server error") }),
        children: mock(async () => ({ data: [] })),
        messages: mock(async () => ({ data: [] })),
      },
      event: { subscribe: mock(async () => ({ stream: (async function* () {})() })) },
    }
    const tool = createProgrammerTool(client, programmerDeps())
    const result = await tool.execute({ task: 1 }, mockContext(testDir))
    assertErrorResult(JSON.parse(result), "DISPATCH_FAILED")
  })

  test("successful dispatch appends NEXT REQUIRED REVIEWS nudge", async () => {
    const { client } = createMockClient()
    const tool = createProgrammerTool(client, programmerDeps())
    const result = await tool.execute({ task: 1 }, mockContext(testDir))
    const parsed = JSON.parse(result)

    expect(parsed.output).toContain("NEXT REQUIRED REVIEWS")
    expect(parsed.output).toContain("verify_spec_compliance")
    expect(parsed.output).toContain("code_review")
    expect(parsed.output).toContain("1. run verify_spec_compliance")
    expect(parsed.output).toContain("2. then run code_review")

    // verify_spec_compliance must appear before code_review in the nudge
    const nudgeStart = parsed.output.indexOf("NEXT REQUIRED REVIEWS")
    const specIdx = parsed.output.indexOf("verify_spec_compliance", nudgeStart)
    const codeIdx = parsed.output.indexOf("code_review", nudgeStart)
    expect(specIdx).toBeLessThan(codeIdx)
  })

  test("error dispatch does NOT include NEXT REQUIRED REVIEWS nudge", async () => {
    const client = {
      session: {
        prompt: mock(async () => { throw new Error("server error") }),
        children: mock(async () => ({ data: [] })),
        messages: mock(async () => ({ data: [] })),
      },
      event: { subscribe: mock(async () => ({ stream: (async function* () {})() })) },
    }
    const tool = createProgrammerTool(client, programmerDeps())
    const result = await tool.execute({ task: 1 }, mockContext(testDir))
    const parsed = JSON.parse(result)
    expect(parsed.output).not.toContain("NEXT REQUIRED REVIEWS")
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
        children: mock(async () => ({ data: [] })),
        messages: mock(async () => ({ data: [] })),
      },
      event: { subscribe: mock(async () => ({ stream: (async function* () {})() })) },
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

    // Assert activePlanFilename is already set at dispatch time, then throw
    const client = {
      session: {
        prompt: mock(async () => {
          expect(getState().activePlanFilename).toBe("my-feature-plan.md")
          throw new Error("dispatch error")
        }),
        children: mock(async () => ({ data: [] })),
        messages: mock(async () => ({ data: [] })),
      },
      event: { subscribe: mock(async () => ({ stream: (async function* () {})() })) },
    }
    const tool = createReviewPlanTool(client)
    const result = await tool.execute(
      { filename: "my-feature-plan.md", chunk: 1 },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "DISPATCH_FAILED")
    expect(getState().activePlanFilename).toBe("my-feature-plan.md")
  })

  test("sets activePlanFilename in state after successful file read", async () => {
    await mkdir(join(testDir, ".opencode/plans"), { recursive: true })
    await writeFile(join(testDir, ".opencode/plans", "my-feature-plan.md"), "# My Feature Plan\n\nSome content\n")

    const { client } = createMockClient()
    const tool = createReviewPlanTool(client)
    await tool.execute(
      { filename: "my-feature-plan.md" },
      mockContext(testDir)
    )

    expect(getState().activePlanFilename).toBe("my-feature-plan.md")
  })

  test("does NOT set activePlanFilename when file not found", async () => {
    updateState({ activePlanFilename: "existing-plan.md" })

    const { client } = createMockClient()
    const tool = createReviewPlanTool(client)
    const result = await tool.execute(
      { filename: "nonexistent-plan.md" },
      mockContext(testDir)
    )

    assertErrorResult(JSON.parse(result), "FILE_NOT_FOUND")
    expect(getState().activePlanFilename).toBe("existing-plan.md")
  })

  test("does NOT set activePlanFilename when chunk not found", async () => {
    await mkdir(join(testDir, ".opencode/plans"), { recursive: true })
    await writeFile(join(testDir, ".opencode/plans", "my-feature-plan.md"), "# My Feature Plan\n\nSome content\n")

    const { client } = createMockClient()
    const tool = createReviewPlanTool(client)
    const result = await tool.execute(
      { filename: "my-feature-plan.md", chunk: 99 },
      mockContext(testDir)
    )

    assertErrorResult(JSON.parse(result), "CHUNK_NOT_FOUND")
    expect(getState().activePlanFilename).toBeNull()
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

test("programmer fills template with task block from active plan and records lastBaseSha", async () => {
  const { client } = createMockClient()
  const deps = programmerDeps({ headSha: "1234567890abcdef" })
  const toolDef = createProgrammerTool(client, deps)

  await toolDef.execute({ task: 1, notes: "First task in Chunk 1" }, mockContext(testDir))

  expect(deps.updateState).toHaveBeenCalledWith({ lastBaseSha: "1234567890abcdef" })

  const dispatched = client.session.prompt.mock.calls[0][0].body.parts[0].prompt
  expect(dispatched).toContain("### Task 1: Add constants")
  expect(dispatched).toContain("First task in Chunk 1")
  expect(dispatched).toContain(testDir)
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

// ── dispatchSubtask direct tests ────────────────────────────────────

const noopMetadata = () => {}

function createDeferredPromptResult() {
  let resolve!: (value: {
    data: { info: {}; parts: Array<{ type: "text"; text: string }> }
  }) => void
  let reject!: (error: Error) => void

  const promise = new Promise<{
    data: { info: {}; parts: Array<{ type: "text"; text: string }> }
  }>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, resolve, reject }
}

function createDispatchMockClient(overrides: {
  promptResult?: Promise<any>
  childrenResults?: Array<Promise<any>>
  messagesResult?: Promise<any>
  subscribeStream?: AsyncIterable<any>
} = {}) {
  const callOrder: string[] = []
  let childReadIndex = 0
  const prompt = mock(async () => {
    callOrder.push("prompt")
    return await (overrides.promptResult ?? Promise.resolve({ data: { info: {}, parts: [] } }))
  })
  const children = mock(async () => {
    callOrder.push("children")
    const next = overrides.childrenResults?.[childReadIndex]
      ?? overrides.childrenResults?.at(-1)
      ?? Promise.resolve({ data: [] })
    childReadIndex += 1
    return await next
  })
  const messages = mock(async () => {
    callOrder.push("messages")
    return await (overrides.messagesResult ?? Promise.resolve({ data: [] }))
  })
  const subscribe = mock(async () => {
    callOrder.push("subscribe")
    return {
      stream:
        overrides.subscribeStream ??
        (async function* () {
          yield { type: "session.idle", properties: { sessionID: "target-child" } }
        })(),
    }
  })

  return {
    callOrder,
    session: {
      prompt,
      children,
      messages,
    },
    event: { subscribe },
  }
}

test("second dispatch throws before any second SDK round-trip while the first child is still running", async () => {
  resetState()
  const deferred = createDeferredPromptResult()
  const client = createDispatchMockClient({ promptResult: deferred.promise })

  const firstDispatch = dispatchSubtask(
    client,
    "session-1",
    "workflow-plan",
    "workflow-reviewer",
    "review this",
    "Review plan",
    noopMetadata,
  )

  // Allow the first dispatch to progress through children/subscribe to prompt
  await new Promise((r) => setTimeout(r, 10))

  const promptCallsBefore = client.session.prompt.mock.calls.length

  await expect(
    dispatchSubtask(
      client,
      "session-1",
      "workflow-plan",
      "workflow-reviewer",
      "review this again",
      "Review plan again",
      noopMetadata,
    ),
  ).rejects.toThrow(/SERIAL-ONLY/)

  // The second dispatch must not have added any SDK calls
  expect(client.session.prompt.mock.calls.length).toBe(promptCallsBefore)

  deferred.resolve({
    data: {
      info: {},
      parts: [{ type: "text", text: "WORKFLOW_VERDICT: APPROVED" }],
    },
  })

  const firstResult = JSON.parse(await firstDispatch)
  expect(firstResult.output).toContain("WORKFLOW_VERDICT: APPROVED")
  expect(getState().dispatchInProgress).toBe(false)
  // Verify noReply: false was used
  expect(client.session.prompt.mock.calls[0][0].body.noReply).toBe(false)
})

test("dispatchSubtask subscribes before dispatch, ignores unrelated idle events, and reads only the one new child session", async () => {
  resetState()
  const client = createDispatchMockClient({
    promptResult: Promise.resolve({ data: { info: {}, parts: [] } }),
    childrenResults: [
      Promise.resolve({
        data: [
          { id: "older-child", parentID: "session-1" },
          { id: "existing-later-child", parentID: "session-1" },
        ],
      }),
      Promise.resolve({
        data: [
          { id: "older-child", parentID: "session-1" },
          { id: "target-child", parentID: "session-1" },
          { id: "existing-later-child", parentID: "session-1" },
        ],
      }),
    ],
    messagesResult: Promise.resolve({
      data: [{ parts: [{ type: "text", text: "WORKFLOW_VERDICT: APPROVED" }] }],
    }),
    subscribeStream: (async function* () {
      yield { type: "session.idle", properties: { sessionID: "older-child" } }
      yield { type: "session.idle", properties: { sessionID: "target-child" } }
    })(),
  })

  const parsed = JSON.parse(
    await dispatchSubtask(
      client,
      "session-1",
      "workflow-plan",
      "workflow-reviewer",
      "review this",
      "Review plan",
      noopMetadata,
    ),
  )

  expect(client.event.subscribe).toHaveBeenCalledTimes(1)
  expect(client.callOrder.indexOf("subscribe")).toBeLessThan(client.callOrder.indexOf("prompt"))
  expect(client.session.prompt.mock.calls[0][0].body.noReply).toBe(false)
  expect(client.session.messages).toHaveBeenCalledWith({ path: { id: "target-child" } })
  expect(parsed.output).toContain("WORKFLOW_VERDICT: APPROVED")
})

test("dispatchSubtask throws when fallback cannot identify exactly one new child session", async () => {
  resetState()
  const client = createDispatchMockClient({
    promptResult: Promise.resolve({ data: { info: {}, parts: [] } }),
    childrenResults: [
      Promise.resolve({ data: [{ id: "older-child", parentID: "session-1" }] }),
      Promise.resolve({
        data: [
          { id: "older-child", parentID: "session-1" },
          { id: "new-child-a", parentID: "session-1" },
          { id: "new-child-b", parentID: "session-1" },
        ],
      }),
    ],
  })

  await expect(
    dispatchSubtask(
      client,
      "session-1",
      "workflow-plan",
      "workflow-reviewer",
      "review this",
      "Review plan",
      noopMetadata,
    ),
  ).rejects.toThrow(/exactly one new child session/)
})

test("dispatchSubtask throws when fallback returns no text", async () => {
  resetState()
  const client = createDispatchMockClient({
    promptResult: Promise.resolve({ data: { info: {}, parts: [] } }),
    childrenResults: [
      Promise.resolve({ data: [] }),
      Promise.resolve({ data: [{ id: "target-child", parentID: "session-1" }] }),
    ],
    messagesResult: Promise.resolve({ data: [{ parts: [] }] }),
  })

  await expect(
    dispatchSubtask(
      client,
      "session-1",
      "workflow-plan",
      "workflow-reviewer",
      "review this",
      "Review plan",
      noopMetadata,
    ),
  ).rejects.toThrow(/completed without text output/)
})

test("dispatchSubtask releases the lock when subscribe fails", async () => {
  resetState()
  const client = createDispatchMockClient()
  client.event.subscribe = mock(async () => {
    throw new Error("subscribe failed")
  })

  await expect(
    dispatchSubtask(
      client,
      "session-1",
      "workflow-plan",
      "workflow-reviewer",
      "review this",
      "Review plan",
      noopMetadata,
    ),
  ).rejects.toThrow("subscribe failed")

  expect(getState().dispatchInProgress).toBe(false)
})

test("dispatchSubtask releases the lock when the SDK call rejects", async () => {
  resetState()
  const client = createDispatchMockClient({ promptResult: Promise.reject(new Error("sdk failed")) })

  await expect(
    dispatchSubtask(
      client,
      "session-1",
      "workflow-plan",
      "workflow-reviewer",
      "review this",
      "Review plan",
      noopMetadata,
    ),
  ).rejects.toThrow("sdk failed")

  expect(getState().dispatchInProgress).toBe(false)
})

test("dispatchSubtask throws when the event stream ends before the correlated child goes idle", async () => {
  resetState()
  const client = createDispatchMockClient({
    promptResult: Promise.resolve({ data: { info: {}, parts: [] } }),
    childrenResults: [
      Promise.resolve({ data: [] }),
      Promise.resolve({ data: [{ id: "target-child", parentID: "session-1" }] }),
    ],
    subscribeStream: (async function* () {
      yield { type: "session.idle", properties: { sessionID: "other-child" } }
    })(),
  })

  await expect(
    dispatchSubtask(
      client,
      "session-1",
      "workflow-plan",
      "workflow-reviewer",
      "review this",
      "Review plan",
      noopMetadata,
      { idleTimeoutMs: 5 },
    ),
  ).rejects.toThrow(/Event stream ended before child session target-child became idle/)
})

// ── extractTask ─────────────────────────────────────────────────────

describe("extractTask", () => {
  const samplePlan = [
    "# Implementation Plan",
    "",
    "## Chunk 1: Setup",
    "",
    "### Task 1: Add constants",
    "",
    "Step 1: Write test...",
    "Step 2: Implement...",
    "",
    "### Task 2: Add middleware",
    "",
    "Step 1: Write test...",
    "",
    "### Task 3: Final wiring",
    "",
    "Step 1: Wire it up...",
  ].join("\n")

  test("extracts middle task (Task 2) with content up to next task", () => {
    const result = extractTask(samplePlan, 2)
    expect(result).not.toBeNull()
    expect(result!.startsWith("### Task 2: Add middleware")).toBe(true)
    expect(result).toContain("Step 1: Write test...")
    expect(result).not.toContain("### Task 3")
    expect(result).not.toContain("### Task 1")
  })

  test("extracts final task (Task 3) through EOF", () => {
    const result = extractTask(samplePlan, 3)
    expect(result).not.toBeNull()
    expect(result!.startsWith("### Task 3: Final wiring")).toBe(true)
    expect(result).toContain("Step 1: Wire it up...")
  })

  test("extracts first task", () => {
    const result = extractTask(samplePlan, 1)
    expect(result).not.toBeNull()
    expect(result!.startsWith("### Task 1: Add constants")).toBe(true)
    expect(result).toContain("Step 2: Implement...")
    expect(result).not.toContain("### Task 2")
  })

  test("returns null for missing task number", () => {
    const result = extractTask(samplePlan, 99)
    expect(result).toBeNull()
  })

  test("returns 'DUPLICATE' error string for duplicate task headings", () => {
    const dupPlan = [
      "### Task 1: First version",
      "content A",
      "### Task 1: Second version",
      "content B",
    ].join("\n")
    const result = extractTask(dupPlan, 1)
    expect(result).toBe("DUPLICATE")
  })

  test("preserves verbatim content including blank lines", () => {
    const planWithBlanks = [
      "### Task 1: Setup",
      "",
      "- [ ] Step 1: do thing",
      "",
      "```ts",
      "const x = 1",
      "```",
      "",
      "### Task 2: Next",
    ].join("\n")
    const result = extractTask(planWithBlanks, 1)
    expect(result).toContain("```ts\nconst x = 1\n```")
    expect(result).not.toContain("### Task 2")
  })

  test("does not stop early at ### Task heading inside a fenced code block", () => {
    const plan = [
      "### Task 1: Setup",
      "",
      "Do some setup.",
      "",
      "```markdown",
      "### Task 2: Example heading in docs",
      "This is just an example.",
      "```",
      "",
      "More Task 1 content after the fence.",
      "",
      "### Task 2: Real task two",
      "Task 2 content.",
    ].join("\n")
    const result = extractTask(plan, 1)
    expect(result).not.toBeNull()
    expect(result).toContain("### Task 2: Example heading in docs")
    expect(result).toContain("More Task 1 content after the fence.")
    expect(result).not.toContain("Task 2 content.")
  })

  test("does not report DUPLICATE for ### Task heading inside a fenced code block", () => {
    const plan = [
      "### Task 1: Real task",
      "",
      "Some content.",
      "",
      "```",
      "### Task 1: This is inside a code block",
      "```",
      "",
      "More content.",
      "",
      "### Task 2: Next task",
    ].join("\n")
    const result = extractTask(plan, 1)
    expect(result).not.toBe("DUPLICATE")
    expect(result).not.toBeNull()
    expect(result).toContain("### Task 1: This is inside a code block")
    expect(result).toContain("More content.")
    expect(result).not.toContain("### Task 2")
  })

  test("does not stop early at ### Task heading inside a ~~~ fenced code block", () => {
    const plan = [
      "### Task 1: Setup",
      "",
      "Do some setup.",
      "",
      "~~~",
      "### Task 2: Example heading in docs",
      "This is just an example.",
      "~~~",
      "",
      "More Task 1 content after the fence.",
      "",
      "### Task 2: Real task two",
      "Task 2 content.",
    ].join("\n")
    const result = extractTask(plan, 1)
    expect(result).not.toBeNull()
    expect(result).toContain("### Task 2: Example heading in docs")
    expect(result).toContain("More Task 1 content after the fence.")
    expect(result).not.toContain("Task 2 content.")
  })

  test("does not report DUPLICATE for ### Task heading inside an indented fenced code block", () => {
    // Regression: fence opening indented up to 3 spaces is valid per CommonMark.
    // The embedded heading has NO leading spaces so it WOULD match ^### Task
    // if the parser failed to recognise the indented fence as a code block.
    const plan = [
      "### Task 1: Real task",
      "",
      "Some content.",
      "",
      "   ```",
      "### Task 1: This heading is inside an indented fence",
      "   ```",
      "",
      "More content.",
      "",
      "### Task 2: Next task",
    ].join("\n")
    const result = extractTask(plan, 1)
    expect(result).not.toBe("DUPLICATE")
    expect(result).not.toBeNull()
    expect(result).toContain("### Task 1: This heading is inside an indented fence")
    expect(result).toContain("More content.")
    expect(result).not.toContain("### Task 2")
  })

  test("does not stop early when ~~~ appears inside a backtick-fenced block", () => {
    const plan = [
      "### Task 1: Setup",
      "",
      "```markdown",
      "~~~",
      "nested tilde content",
      "~~~",
      "### Task 2: Fake heading inside backtick fence",
      "```",
      "",
      "More Task 1 content.",
      "",
      "### Task 2: Real task two",
      "Task 2 content.",
    ].join("\n")
    const result = extractTask(plan, 1)
    expect(result).not.toBeNull()
    expect(result).toContain("### Task 2: Fake heading inside backtick fence")
    expect(result).toContain("More Task 1 content.")
    expect(result).not.toContain("Task 2 content.")
  })

  test("does not report DUPLICATE when ``` appears inside a tilde-fenced block", () => {
    const plan = [
      "### Task 1: Setup",
      "",
      "~~~",
      "```",
      "### Task 1: Duplicate-looking heading inside tilde fence",
      "```",
      "~~~",
      "",
      "More content.",
      "",
      "### Task 2: Next task",
    ].join("\n")
    const result = extractTask(plan, 1)
    expect(result).not.toBe("DUPLICATE")
    expect(result).not.toBeNull()
    expect(result).toContain("### Task 1: Duplicate-looking heading inside tilde fence")
    expect(result).toContain("More content.")
  })

  test("does not stop early when inner ``` appears inside an outer ```` fence", () => {
    const plan = [
      "### Task 1: Setup",
      "",
      "````markdown",
      "```",
      "inner code",
      "```",
      "### Task 2: Example heading inside outer fence",
      "````",
      "",
      "More Task 1 content.",
      "",
      "### Task 2: Real task two",
      "Task 2 content.",
    ].join("\n")
    const result = extractTask(plan, 1)
    expect(result).not.toBeNull()
    expect(result).toContain("### Task 2: Example heading inside outer fence")
    expect(result).toContain("More Task 1 content.")
    expect(result).not.toContain("Task 2 content.")
  })

  test("does not report DUPLICATE when inner ~~~ appears inside an outer ~~~~ fence", () => {
    const plan = [
      "### Task 1: Real task",
      "",
      "~~~~",
      "~~~",
      "### Task 1: Looks like a duplicate but inside outer fence",
      "~~~",
      "~~~~",
      "",
      "More content.",
      "",
      "### Task 2: Next task",
    ].join("\n")
    const result = extractTask(plan, 1)
    expect(result).not.toBe("DUPLICATE")
    expect(result).not.toBeNull()
    expect(result).toContain("### Task 1: Looks like a duplicate but inside outer fence")
    expect(result).toContain("More content.")
  })

  test("ignores malformed headings (no colon, non-numeric)", () => {
    const malformedPlan = [
      "### Task 1 no colon here",
      "not a real task",
      "### Task One: spelled out",
      "also not real",
      "### Task 1: Real task",
      "real content",
    ].join("\n")
    const result = extractTask(malformedPlan, 1)
    expect(result).not.toBeNull()
    expect(result!.startsWith("### Task 1: Real task")).toBe(true)
    expect(result).toContain("real content")
    // The malformed lines should not be matched as task headings
    expect(result).not.toContain("no colon here")
  })
})

test("dispatchSubtask times out when the correlated child never goes idle", async () => {
  resetState()
  const neverEnds = {
    async *[Symbol.asyncIterator]() {
      await new Promise(() => {})
    },
  }

  const client = createDispatchMockClient({
    promptResult: Promise.resolve({ data: { info: {}, parts: [] } }),
    childrenResults: [
      Promise.resolve({ data: [] }),
      Promise.resolve({ data: [{ id: "target-child", parentID: "session-1" }] }),
    ],
    subscribeStream: neverEnds,
  })

  await expect(
    dispatchSubtask(
      client,
      "session-1",
      "workflow-plan",
      "workflow-reviewer",
      "review this",
      "Review plan",
      noopMetadata,
      { idleTimeoutMs: 5 },
    ),
  ).rejects.toThrow(/Timed out waiting for child session target-child/)
})
