// tests/index.test.ts
import { describe, expect, test } from "bun:test"
import { createPlugin } from "../src/index"

describe("createPlugin", () => {
  /**
   * Minimal mock PluginInput for testing the plugin factory.
   */
  function mockPluginInput(overrides?: Partial<any>) {
    return {
      client: {
        session: {
          prompt: async () => ({ data: {} }),
        },
      },
      project: { name: "test" },
      directory: "/test/project",
      worktree: "/test/project",
      serverUrl: new URL("http://localhost:3000"),
      $: (() => {}) as any,
      ...overrides,
    }
  }

  test("returns hooks object with required keys", async () => {
    const hooks = await createPlugin(mockPluginInput())

    expect(hooks.tool).toBeDefined()
    expect(hooks.config).toBeDefined()
    expect(hooks["command.execute.before"]).toBeDefined()
  })

  test("registers all 9 workflow tools", async () => {
    const hooks = await createPlugin(mockPluginInput())

    const toolNames = Object.keys(hooks.tool!)
    expect(toolNames).toHaveLength(9)
    expect(toolNames).toContain("explore")
    expect(toolNames).toContain("research")
    expect(toolNames).toContain("programmer")
    expect(toolNames).toContain("review_spec")
    expect(toolNames).toContain("review_plan")
    expect(toolNames).toContain("read_spec")
    expect(toolNames).toContain("write_spec")
    expect(toolNames).toContain("read_plan")
    expect(toolNames).toContain("write_plan")
  })

  test("each tool has execute function", async () => {
    const hooks = await createPlugin(mockPluginInput())

    for (const [name, toolDef] of Object.entries(hooks.tool!)) {
      expect(typeof (toolDef as any).execute).toBe("function")
    }
  })

  test("config hook is a function", async () => {
    const hooks = await createPlugin(mockPluginInput())
    expect(typeof hooks.config).toBe("function")
  })

  test("command.execute.before hook is a function", async () => {
    const hooks = await createPlugin(mockPluginInput())
    expect(typeof hooks["command.execute.before"]).toBe("function")
  })
})
