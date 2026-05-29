import { describe, expect, test, beforeEach } from "bun:test"
import { cacheVariant, getCachedVariant, createChatMessageHook } from "../src/session"

describe("variant cache", () => {
  beforeEach(() => {
    // Clear cache state between tests by caching undefined
    cacheVariant("sess-1", undefined)
    cacheVariant("sess-2", undefined)
  })

  test("cacheVariant stores and getCachedVariant retrieves", () => {
    cacheVariant("sess-1", "thinking")
    expect(getCachedVariant("sess-1")).toBe("thinking")
  })

  test("getCachedVariant returns undefined for unknown session", () => {
    expect(getCachedVariant("unknown-session")).toBeUndefined()
  })

  test("cacheVariant overwrites previous value", () => {
    cacheVariant("sess-1", "thinking")
    cacheVariant("sess-1", "default")
    expect(getCachedVariant("sess-1")).toBe("default")
  })

  test("cacheVariant can store undefined", () => {
    cacheVariant("sess-1", "thinking")
    cacheVariant("sess-1", undefined)
    expect(getCachedVariant("sess-1")).toBeUndefined()
  })

  test("separate sessions have independent variants", () => {
    cacheVariant("sess-1", "thinking")
    cacheVariant("sess-2", "default")
    expect(getCachedVariant("sess-1")).toBe("thinking")
    expect(getCachedVariant("sess-2")).toBe("default")
  })
})

describe("createChatMessageHook", () => {
  beforeEach(() => {
    cacheVariant("sess-1", undefined)
  })

  test("caches variant from message input", async () => {
    const hook = createChatMessageHook()
    await hook({
      sessionID: "sess-1",
      variant: "thinking",
    })
    expect(getCachedVariant("sess-1")).toBe("thinking")
  })

  test("caches undefined when variant not present", async () => {
    cacheVariant("sess-1", "thinking")
    const hook = createChatMessageHook()
    await hook({
      sessionID: "sess-1",
    })
    expect(getCachedVariant("sess-1")).toBeUndefined()
  })

  test("handles full input shape with all optional fields", async () => {
    const hook = createChatMessageHook()
    await hook({
      sessionID: "sess-1",
      agent: "workflow-brainstorm",
      model: { providerID: "anthropic", modelID: "claude-sonnet" },
      messageID: "msg-1",
      variant: "thinking",
    })
    expect(getCachedVariant("sess-1")).toBe("thinking")
  })
})
