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
    const variant = await getSessionVariant(mockClient, "sess-1")
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
    const variant = await getSessionVariant(mockClient, "sess-1")
    expect(variant).toBeUndefined()
  })

  test("returns undefined when session has no model", async () => {
    const mockClient = {
      session: {
        get: async () => ({ data: {} }),
      },
    }
    const variant = await getSessionVariant(mockClient, "sess-1")
    expect(variant).toBeUndefined()
  })

  test("returns undefined when session.get fails", async () => {
    const mockClient = {
      session: {
        get: async () => { throw new Error("network error") },
      },
    }
    const variant = await getSessionVariant(mockClient, "sess-1")
    expect(variant).toBeUndefined()
  })

  test("passes sessionID to client.session.get via v1 path shape", async () => {
    let capturedOptions: any
    const mockClient = {
      session: {
        get: async (opts: any) => {
          capturedOptions = opts
          return { data: { model: { variant: "thinking" } } }
        },
      },
    }
    await getSessionVariant(mockClient, "sess-42")
    expect(capturedOptions.path.id).toBe("sess-42")
  })
})
