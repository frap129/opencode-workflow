// tests/commands.test.ts
import { describe, expect, test } from "bun:test"
import { createConfigHook, createCommandHook } from "../src/commands"
import { PHASE_TOOL_MATRIX, PHASE_AGENT_MAP, AGENT_NAMES } from "../src/constants"

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

  test("applies tool shaping for each phase agent", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    // Config hook should set up agent-level tool visibility
    expect(config.agent).toBeDefined()

    // For each phase, hidden tools should be set to false
    for (const [phase, matrix] of Object.entries(PHASE_TOOL_MATRIX)) {
      const agentName = PHASE_AGENT_MAP[phase as keyof typeof PHASE_AGENT_MAP]
      const agentConfig = config.agent[agentName]
      expect(agentConfig).toBeDefined()
      expect(agentConfig.tools).toBeDefined()

      for (const hiddenTool of matrix.hidden) {
        expect(agentConfig.tools[hiddenTool]).toBe(false)
      }
    }
  })

  test("does not disable allowed tools for any phase", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    for (const [phase, matrix] of Object.entries(PHASE_TOOL_MATRIX)) {
      const agentName = PHASE_AGENT_MAP[phase as keyof typeof PHASE_AGENT_MAP]
      const agentConfig = config.agent[agentName]

      for (const allowedTool of matrix.allowed) {
        // Allowed tools should either be true or not present (not false)
        if (agentConfig.tools[allowedTool] !== undefined) {
          expect(agentConfig.tools[allowedTool]).not.toBe(false)
        }
      }
    }
  })

  test("brainstorm agent denies code-editing and shell tools", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    const agentConfig = config.agent["workflow-brainstorm"]
    // Built-in tool posture: deny code-editing and shell mutation
    expect(agentConfig.tools.edit).toBe(false)
    expect(agentConfig.tools.write).toBe(false)
    expect(agentConfig.tools.bash).toBe(false)
  })

  test("plan agent denies code-editing and shell tools", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    const agentConfig = config.agent["workflow-plan"]
    expect(agentConfig.tools.edit).toBe(false)
    expect(agentConfig.tools.write).toBe(false)
    expect(agentConfig.tools.bash).toBe(false)
  })

  test("implement agent does not deny code-editing or shell tools", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    const agentConfig = config.agent["workflow-implement"]
    // Implementation phase should NOT deny these
    expect(agentConfig.tools.edit).not.toBe(false)
    expect(agentConfig.tools.write).not.toBe(false)
    expect(agentConfig.tools.bash).not.toBe(false)
  })

  test("read-only subagents deny code-editing and shell tools", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    const readOnlySubagents = ["workflow-explore", "workflow-research", "workflow-reviewer"]
    for (const agentName of readOnlySubagents) {
      const agentConfig = config.agent[agentName]
      expect(agentConfig).toBeDefined()
      expect(agentConfig.tools.edit).toBe(false)
      expect(agentConfig.tools.write).toBe(false)
      expect(agentConfig.tools.bash).toBe(false)
    }
  })

  test("programmer subagent does not deny code-editing or shell tools", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    const agentConfig = config.agent["workflow-programmer"]
    // Programmer should be able to edit/write/bash
    if (agentConfig?.tools) {
      expect(agentConfig.tools.edit).not.toBe(false)
      expect(agentConfig.tools.write).not.toBe(false)
      expect(agentConfig.tools.bash).not.toBe(false)
    }
    // If no tools config at all, that's fine — means nothing is denied
  })
})

// ── Command execution hook tests ──────────────────────────────────

describe("createCommandHook", () => {
  /**
   * Mock client for capturing session.prompt() calls.
   * Returns the calls array for inspection.
   */
  function mockClient() {
    const calls: any[] = []
    return {
      calls,
      session: {
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
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "design a login page",
    })

    // Should have submitted a prompt to the session
    expect(client.calls).toHaveLength(1)
    const call = client.calls[0]
    expect(call.path.id).toBe("sess-1")
    expect(call.body.noReply).toBe(true)
    expect(call.body.agent).toBe("workflow-brainstorm")
    expect(call.body.parts).toHaveLength(1)
    expect(call.body.parts[0].type).toBe("text")
    expect(call.body.parts[0].text).toContain("design a login page")
  })

  test("plan command submits entry prompt with correct agent", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "plan", sessionID: "sess-1", arguments: "implement auth flow",
    })

    expect(client.calls).toHaveLength(1)
    const call = client.calls[0]
    expect(call.body.agent).toBe("workflow-plan")
    expect(call.body.parts[0].text).toContain("implement auth flow")
  })

  test("implement command submits entry prompt with correct agent", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "implement", sessionID: "sess-1", arguments: "build the auth module",
    })

    expect(client.calls).toHaveLength(1)
    const call = client.calls[0]
    expect(call.body.agent).toBe("workflow-implement")
    expect(call.body.parts[0].text).toContain("build the auth module")
  })

  test("ignores non-workflow commands (does not throw)", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const input = { command: "dcp", sessionID: "sess-1", arguments: "stats" }
    const output = { parts: [] as any[] }
    // Should return normally without throwing
    await hook(input, output)

    expect(client.calls).toHaveLength(0)
  })

  test("triggers bootstrap on needs-bootstrap status", async () => {
    let bootstrapCalled = false
    const client = mockClient()

    // First call returns needs-bootstrap, runBootstrap sets it to ready,
    // second call returns ready
    let callCount = 0
    const dynamicCheck = async (_dir: string) => {
      callCount++
      if (callCount === 1) return { status: "needs-bootstrap" as const }
      return { status: "ready" as const }
    }

    const hook = createCommandHook(
      client as any,
      "/test/project",
      dynamicCheck,
      async (_dir: string) => { bootstrapCalled = true }
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "test",
    })

    expect(bootstrapCalled).toBe(true)
    // After bootstrap, the command should still submit the entry prompt
    expect(client.calls).toHaveLength(1)
  })

  test("throws on partial bootstrap (does not auto-fix)", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("partial")
    )

    const input = { command: "brainstorm", sessionID: "sess-1", arguments: "test" }
    const output = { parts: [] as any[] }

    // Should throw with the partial bootstrap error, NOT __WORKFLOW_HANDLED__
    await expect(hook(input, output)).rejects.toThrow("partial agent installation")
    expect(client.calls).toHaveLength(0)
  })

  test("entry prompt includes user arguments when provided", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "user request here",
    })

    const promptText = client.calls[0].body.parts[0].text
    expect(promptText).toContain("user request here")
  })

  test("entry prompt works with empty arguments", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "",
    })

    expect(client.calls).toHaveLength(1)
    // Should still submit a valid entry prompt even without args
    expect(client.calls[0].body.parts[0].type).toBe("text")
    expect(client.calls[0].body.parts[0].text.length).toBeGreaterThan(0)
  })

  test("aborts command pipeline after submitting entry prompt", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const input = { command: "brainstorm", sessionID: "sess-1", arguments: "test" }
    const output = { parts: [] as any[] }

    // The hook should throw a sentinel error to abort the pipeline
    // so opencode doesn't also send the template to the LLM
    await expect(hook(input, output)).rejects.toThrow("__WORKFLOW_HANDLED__")

    // But it should have submitted the prompt before throwing
    expect(client.calls).toHaveLength(1)
  })

  test("re-running same command is a fresh invocation (no toggle state)", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
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
    expect(client.calls).toHaveLength(2)
    expect(client.calls[0].body.parts[0].text).toContain("first topic")
    expect(client.calls[1].body.parts[0].text).toContain("second topic")
  })
})
