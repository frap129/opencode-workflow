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

  test("createPlugin registers all 14 workflow tools", async () => {
    const hooks = await createPlugin(mockPluginInput())
    const toolNames = Object.keys(hooks.tool).sort()

    expect(toolNames).toEqual([
      "code_review",
      "edit_plan",
      "edit_spec",
      "explore",
      "investigate",
      "programmer",
      "read_plan",
      "read_spec",
      "research",
      "review_plan",
      "review_spec",
      "verify_spec_compliance",
      "write_plan",
      "write_spec",
    ])
  })

  test("every registered workflow tool exposes an execute function", async () => {
    const hooks = await createPlugin(mockPluginInput())
    for (const toolDef of Object.values(hooks.tool)) {
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
