import { describe, expect, test, beforeEach } from "bun:test"
import { createConfigHook, createCommandHook } from "../src/commands"
import { AGENT_NAMES } from "../src/constants"
import { cacheVariant } from "../src/session"

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

  beforeEach(() => {
    // Clear variant cache between tests
    cacheVariant("sess-1", undefined)
  })

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
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "design a login page",
    })

    expect(client.calls).toHaveLength(1)
    const call = client.calls[0]
    expect(call.path.id).toBe("sess-1")
    expect(call.body.noReply).toBeUndefined()
    expect(call.body.agent).toBe("workflow-brainstorm")
    expect(call.body.parts).toHaveLength(1)
    expect(call.body.parts[0].type).toBe("text")
    expect(call.body.parts[0].text).toContain("design a login page")
  })

  test("plan command submits entry prompt with correct agent", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
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
      client,
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

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "test",
    })

    expect(bootstrapCalled).toBe(true)
    expect(client.calls).toHaveLength(1)
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

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "user request here",
    })

    const promptText = client.calls[0].body.parts[0].text
    expect(promptText).toContain("user request here")
  })

  test("entry prompt works with empty arguments", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "",
    })

    expect(client.calls).toHaveLength(1)
    expect(client.calls[0].body.parts[0].type).toBe("text")
    expect(client.calls[0].body.parts[0].text.length).toBeGreaterThan(0)
  })

  test("aborts command pipeline after submitting entry prompt", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const input = { command: "brainstorm", sessionID: "sess-1", arguments: "test" }
    const output = { parts: [] as any[] }

    await expect(hook(input, output)).rejects.toThrow("__WORKFLOW_HANDLED__")
    expect(client.calls).toHaveLength(1)
  })

  test("re-running same command is a fresh invocation (no toggle state)", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "first topic",
    })

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "second topic",
    })

    expect(client.calls).toHaveLength(2)
    expect(client.calls[0].body.parts[0].text).toContain("first topic")
    expect(client.calls[1].body.parts[0].text).toContain("second topic")
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

    await invokeWorkflowCommand(hook, {
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

  test("preserves model variant when switching to brainstorm agent", async () => {
    cacheVariant("sess-1", "thinking")
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "test",
    })

    expect(client.calls).toHaveLength(1)
    expect(client.calls[0].body.variant).toBe("thinking")
    expect(client.calls[0].path.id).toBe("sess-1")
  })

  test("works without variant set (variant is undefined)", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "test",
    })

    expect(client.calls).toHaveLength(1)
    expect(client.calls[0].body.variant).toBeUndefined()
  })
})
