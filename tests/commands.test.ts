import { describe, expect, test, mock } from "bun:test"
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

  test("commands have agent field for persistent agent switching", async () => {
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
   * Mock client that captures session.prompt() calls.
   * Uses v1 shape: { path: { id }, body: { ... } }
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
   * Helper: invoke a phase command hook and return the output for inspection.
   * Phase commands return normally (no throw) and write to output.parts.
   */
  async function invokePhaseCommand(
    hook: Function,
    input: { command: string; sessionID: string; arguments: string }
  ) {
    const output = { parts: [] as any[] }
    await hook(input, output)
    return output
  }

  /**
   * Helper: invoke a non-phase command hook (workflow-init), catching
   * the expected __WORKFLOW_HANDLED__ throw.
   */
  async function invokeWorkflowInit(
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

  test("brainstorm command writes entry prompt to output.parts", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const output = await invokePhaseCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "design a login page",
    })

    expect(client.calls).toHaveLength(0)
    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].type).toBe("text")
    expect(output.parts[0].text).toContain("design a login page")
  })

  test("plan command writes entry prompt to output.parts", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const output = await invokePhaseCommand(hook, {
      command: "plan", sessionID: "sess-1", arguments: "implement auth flow",
    })

    expect(client.calls).toHaveLength(0)
    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].text).toContain("implement auth flow")
  })

  test("implement command writes entry prompt to output.parts", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const output = await invokePhaseCommand(hook, {
      command: "implement", sessionID: "sess-1", arguments: "build the auth module",
    })

    expect(client.calls).toHaveLength(0)
    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].text).toContain("build the auth module")
  })

  test("ignores non-workflow commands (does not throw)", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const input = { command: "dcp", sessionID: "sess-1", arguments: "stats" }
    const output = { parts: [] as any[] }
    await hook(input, output)

    expect(client.calls).toHaveLength(0)
  })

  test("triggers bootstrap on needs-bootstrap status", async () => {
    let bootstrapCalled = false
    const client = mockClient()

    let callCount = 0
    const dynamicCheck = async (_dir: string) => {
      callCount++
      if (callCount === 1) return { status: "needs-bootstrap" as const }
      return { status: "ready" as const }
    }

    const hook = createCommandHook(
      client,
      "/test/project",
      dynamicCheck,
      async (_dir: string) => { bootstrapCalled = true }
    )

    const output = await invokePhaseCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "test",
    })

    expect(bootstrapCalled).toBe(true)
    expect(output.parts).toHaveLength(1)
  })

  test("throws on partial bootstrap (does not auto-fix)", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("partial")
    )

    const input = { command: "brainstorm", sessionID: "sess-1", arguments: "test" }
    const output = { parts: [] as any[] }

    await expect(hook(input, output)).rejects.toThrow("partial agent installation")
    expect(client.calls).toHaveLength(0)
  })

  test("entry prompt includes user arguments when provided", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const output = await invokePhaseCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "user request here",
    })

    expect(output.parts[0].text).toContain("user request here")
  })

  test("entry prompt works with empty arguments", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const output = await invokePhaseCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "",
    })

    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].type).toBe("text")
    expect(output.parts[0].text.length).toBeGreaterThan(0)
  })

  test("phase commands return normally (no pipeline abort) for persistent agent switch", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const input = { command: "brainstorm", sessionID: "sess-1", arguments: "test" }
    const output = { parts: [] as any[] }

    // Should NOT throw — returns normally so opencode applies persistent switch
    await hook(input, output)
    expect(output.parts).toHaveLength(1)
    expect(client.calls).toHaveLength(0)
  })

  test("re-running same command is a fresh invocation (no toggle state)", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const output1 = await invokePhaseCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "first topic",
    })

    const output2 = await invokePhaseCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "second topic",
    })

    expect(output1.parts[0].text).toContain("first topic")
    expect(output2.parts[0].text).toContain("second topic")
  })

  test("workflow-init calls forceBootstrap and posts confirmation with noReply", async () => {
    let forceBootstrapCalled = false
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready"),
      async () => {},
      async () => { forceBootstrapCalled = true }
    )

    await invokeWorkflowInit(hook, {
      command: "workflow-init", sessionID: "sess-1", arguments: "",
    })

    expect(forceBootstrapCalled).toBe(true)
    expect(client.calls).toHaveLength(1)
    expect(client.calls[0].body.noReply).toBe(true)
    expect(client.calls[0].body.parts[0].text).toContain("regenerated")
  })

  test("workflow-init throws __WORKFLOW_HANDLED__", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready"),
      async () => {},
      async () => {}
    )

    const input = { command: "workflow-init", sessionID: "sess-1", arguments: "" }
    const output = { parts: [] as any[] }
    await expect(hook(input, output)).rejects.toThrow("__WORKFLOW_HANDLED__")
  })

  test("brainstorm command injects the brainstorming skill text and user args", async () => {
    const client = mockClient()
    const updateState = mock(() => {})
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready"),
      async () => {},
      async () => {},
      updateState
    )

    const output = await invokePhaseCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "prompt injection for workflow plugin",
    })

    const promptText = output.parts[0].text
    expect(promptText).toContain("# Brainstorming Ideas Into Designs")
    expect(promptText).toContain("HARD-GATE")
    expect(promptText).toContain("The user wants to brainstorm: prompt injection for workflow plugin")
    expect(updateState).toHaveBeenCalledWith({ phase: "brainstorm" })
  })

  test("plan command injects the writing-plans skill text and user args", async () => {
    const client = mockClient()
    const updateState = mock(() => {})
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready"),
      async () => {},
      async () => {},
      updateState
    )

    const output = await invokePhaseCommand(hook, {
      command: "plan", sessionID: "sess-1", arguments: "prompt-injection-spec.md",
    })

    const promptText = output.parts[0].text
    expect(promptText).toContain("# Writing Plans")
    expect(promptText).toContain("subagent-driven-development")
    expect(promptText).toContain("The user wants to plan: prompt-injection-spec.md")
    expect(updateState).toHaveBeenCalledWith({ phase: "plan" })
  })

  test("implement command injects the subagent-driven-development skill text and user args", async () => {
    const client = mockClient()
    const updateState = mock(() => {})
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready"),
      async () => {},
      async () => {},
      updateState
    )

    const output = await invokePhaseCommand(hook, {
      command: "implement", sessionID: "sess-1", arguments: "prompt-injection-plan.md",
    })

    const promptText = output.parts[0].text
    expect(promptText).toContain("# Subagent-Driven Development")
    expect(promptText).toContain("spec compliance")
    expect(promptText).toContain("code quality")
    expect(promptText).toContain("The user wants to implement: prompt-injection-plan.md")
    expect(updateState).toHaveBeenCalledWith({ phase: "implement" })
  })

  test("empty brainstorm args still inject skill text and brainstorm fallback question", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const output = await invokePhaseCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "",
    })

    const promptText = output.parts[0].text
    expect(promptText).toContain("# Brainstorming Ideas Into Designs")
    expect(promptText).toContain("Ask the user what they'd like to brainstorm.")
  })

  test("empty plan args still inject skill text and plan fallback question", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const output = await invokePhaseCommand(hook, {
      command: "plan", sessionID: "sess-1", arguments: "",
    })

    const promptText = output.parts[0].text
    expect(promptText).toContain("# Writing Plans")
    expect(promptText).toContain("Ask the user which spec to create a plan for.")
  })

  test("empty implement args still inject skill text and implement fallback question", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const output = await invokePhaseCommand(hook, {
      command: "implement", sessionID: "sess-1", arguments: "",
    })

    const promptText = output.parts[0].text
    expect(promptText).toContain("# Subagent-Driven Development")
    expect(promptText).toContain("Ask the user which plan to implement.")
  })
})
