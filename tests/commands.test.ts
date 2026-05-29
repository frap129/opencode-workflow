// tests/commands.test.ts
import { describe, expect, test } from "bun:test"
import { createConfigHook, createCommandHook } from "../src/commands"
import { AGENT_NAMES } from "../src/constants"

// ── Config hook tests ─────────────────────────────────────────────

describe("createConfigHook", () => {
  test("registers three workflow commands", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    for (const cmd of ["brainstorm", "plan", "implement"]) {
      expect(config.command[cmd].template).toBeDefined()
      expect(typeof config.command[cmd].template).toBe("string")
      expect(config.command[cmd].description).toBeDefined()
      expect(typeof config.command[cmd].description).toBe("string")
    }
  })

  test("preserves existing commands", async () => {
    const config: any = { command: { existing: { template: "test", description: "existing" } } }
    const configHook = createConfigHook()
    await configHook(config)

    expect(config.command.existing).toBeDefined()
    expect(config.command.existing.template).toBe("test")
    expect(config.command.brainstorm).toBeDefined()
  })

  test("each command has an agent field for agent switching", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    expect(config.command.brainstorm.agent).toBe("workflow-brainstorm")
    expect(config.command.plan.agent).toBe("workflow-plan")
    expect(config.command.implement.agent).toBe("workflow-implement")
  })

  test("registers workflow-init command", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    expect(config.command["workflow-init"]).toBeDefined()
    expect(config.command["workflow-init"].description).toBeDefined()
  })
})

// ── Command execution hook tests ──────────────────────────────────

describe("createCommandHook", () => {
  /**
   * Mock client for capturing session.prompt() calls.
   * Returns the calls array for inspection.
   */
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

  /**
   * Mock checkBootstrapFn that returns a configurable status.
   */
  function mockBootstrapCheck(
    status: "ready" | "needs-bootstrap" | "partial"
  ) {
    return async (_dir: string) => {
      if (status === "partial") {
        return {
          status: "partial" as const,
          missing: ["workflow-explore"] as any,
          present: AGENT_NAMES.filter((n) => n !== "workflow-explore") as any,
        }
      }
      return { status } as any
    }
  }

  /**
   * Helper: invoke a command hook, catch the expected __WORKFLOW_HANDLED__ throw,
   * and return the client calls for inspection.
   */
  async function invokeWorkflowCommand(
    hook: Function,
    input: { command: string; sessionID: string; arguments: string }
  ) {
    const output = { parts: [] as any[] }
    try {
      await hook(input, output)
    } catch (e: any) {
      if (e.message !== "__WORKFLOW_HANDLED__") throw e
    }
  }

  test("brainstorm command submits entry prompt with correct agent", async () => {
    const v2Client = mockV2Client()
    const hook = createCommandHook(
      null,
      v2Client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "design a login page",
    })

    // Should have submitted a prompt to the session
    expect(v2Client.calls).toHaveLength(1)
    const call = v2Client.calls[0]
    expect(call.sessionID).toBe("sess-1")
    expect(call.noReply).toBeUndefined()
    expect(call.agent).toBe("workflow-brainstorm")
    expect(call.parts).toHaveLength(1)
    expect(call.parts[0].type).toBe("text")
    expect(call.parts[0].text).toContain("design a login page")
  })

  test("plan command submits entry prompt with correct agent", async () => {
    const v2Client = mockV2Client()
    const hook = createCommandHook(
      null,
      v2Client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "plan", sessionID: "sess-1", arguments: "implement auth flow",
    })

    expect(v2Client.calls).toHaveLength(1)
    const call = v2Client.calls[0]
    expect(call.agent).toBe("workflow-plan")
    expect(call.parts[0].text).toContain("implement auth flow")
  })

  test("implement command submits entry prompt with correct agent", async () => {
    const v2Client = mockV2Client()
    const hook = createCommandHook(
      null,
      v2Client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "implement", sessionID: "sess-1", arguments: "build the auth module",
    })

    expect(v2Client.calls).toHaveLength(1)
    const call = v2Client.calls[0]
    expect(call.agent).toBe("workflow-implement")
    expect(call.parts[0].text).toContain("build the auth module")
  })

  test("ignores non-workflow commands (does not throw)", async () => {
    const v2Client = mockV2Client()
    const hook = createCommandHook(
      null,
      v2Client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const input = { command: "dcp", sessionID: "sess-1", arguments: "stats" }
    const output = { parts: [] as any[] }
    // Should return normally without throwing
    await hook(input, output)

    expect(v2Client.calls).toHaveLength(0)
  })

  test("triggers bootstrap on needs-bootstrap status", async () => {
    let bootstrapCalled = false
    const v2Client = mockV2Client()

    // First call returns needs-bootstrap, runBootstrap sets it to ready,
    // second call returns ready
    let callCount = 0
    const dynamicCheck = async (_dir: string) => {
      callCount++
      if (callCount === 1) return { status: "needs-bootstrap" as const }
      return { status: "ready" as const }
    }

    const hook = createCommandHook(
      null,
      v2Client as any,
      "/test/project",
      dynamicCheck,
      async (_dir: string) => { bootstrapCalled = true }
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "test",
    })

    expect(bootstrapCalled).toBe(true)
    // After bootstrap, the command should still submit the entry prompt
    expect(v2Client.calls).toHaveLength(1)
  })

  test("throws on partial bootstrap (does not auto-fix)", async () => {
    const v2Client = mockV2Client()
    const hook = createCommandHook(
      null,
      v2Client as any,
      "/test/project",
      mockBootstrapCheck("partial")
    )

    const input = { command: "brainstorm", sessionID: "sess-1", arguments: "test" }
    const output = { parts: [] as any[] }

    // Should throw with the partial bootstrap error, NOT __WORKFLOW_HANDLED__
    await expect(hook(input, output)).rejects.toThrow("partial agent installation")
    expect(v2Client.calls).toHaveLength(0)
  })

  test("entry prompt includes user arguments when provided", async () => {
    const v2Client = mockV2Client()
    const hook = createCommandHook(
      null,
      v2Client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "user request here",
    })

    const promptText = v2Client.calls[0].parts[0].text
    expect(promptText).toContain("user request here")
  })

  test("entry prompt works with empty arguments", async () => {
    const v2Client = mockV2Client()
    const hook = createCommandHook(
      null,
      v2Client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "",
    })

    expect(v2Client.calls).toHaveLength(1)
    // Should still submit a valid entry prompt even without args
    expect(v2Client.calls[0].parts[0].type).toBe("text")
    expect(v2Client.calls[0].parts[0].text.length).toBeGreaterThan(0)
  })

  test("aborts command pipeline after submitting entry prompt", async () => {
    const v2Client = mockV2Client()
    const hook = createCommandHook(
      null,
      v2Client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const input = { command: "brainstorm", sessionID: "sess-1", arguments: "test" }
    const output = { parts: [] as any[] }

    // The hook should throw a sentinel error to abort the pipeline
    // so opencode doesn't also send the template to the LLM
    await expect(hook(input, output)).rejects.toThrow("__WORKFLOW_HANDLED__")

    // But it should have submitted the prompt before throwing
    expect(v2Client.calls).toHaveLength(1)
  })

  test("re-running same command is a fresh invocation (no toggle state)", async () => {
    const v2Client = mockV2Client()
    const hook = createCommandHook(
      null,
      v2Client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    // First invocation
    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "first topic",
    })

    // Second invocation of the same command
    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "second topic",
    })

    // Both should produce entry prompts (no toggle-off behavior)
    expect(v2Client.calls).toHaveLength(2)
    expect(v2Client.calls[0].parts[0].text).toContain("first topic")
    expect(v2Client.calls[1].parts[0].text).toContain("second topic")
  })

  test("workflow-init calls forceBootstrap and posts confirmation with noReply", async () => {
    let forceBootstrapCalled = false
    const v2Client = mockV2Client()
    const hook = createCommandHook(
      null,
      v2Client as any,
      "/test/project",
      mockBootstrapCheck("ready"),
      async () => {},
      async () => { forceBootstrapCalled = true }
    )

    await invokeWorkflowCommand(hook, {
      command: "workflow-init", sessionID: "sess-1", arguments: "",
    })

    expect(forceBootstrapCalled).toBe(true)
    expect(v2Client.calls).toHaveLength(1)
    expect(v2Client.calls[0].noReply).toBe(true)
    expect(v2Client.calls[0].parts[0].text).toContain("regenerated")
  })

  test("workflow-init throws __WORKFLOW_HANDLED__", async () => {
    const v2Client = mockV2Client()
    const hook = createCommandHook(
      null,
      v2Client as any,
      "/test/project",
      mockBootstrapCheck("ready"),
      async () => {},
      async () => {}
    )

    const input = { command: "workflow-init", sessionID: "sess-1", arguments: "" }
    const output = { parts: [] as any[] }
    await expect(hook(input, output)).rejects.toThrow("__WORKFLOW_HANDLED__")
  })

  test("preserves model variant when switching to brainstorm agent", async () => {
    const v2Client = mockV2Client("thinking")
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
})
