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
