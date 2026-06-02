import { describe, expect, test, beforeEach } from "bun:test"
import { cacheVariant, getCachedVariant, cacheModel, getCachedModel, createChatMessageHook } from "../src/session"

describe("variant cache", () => {
  beforeEach(() => {
    // Clear cache state between tests by caching undefined
    cacheVariant("sess-1", undefined)
    cacheVariant("sess-2", undefined)
    cacheModel("sess-1", undefined)
    cacheModel("sess-2", undefined)
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

describe("model cache", () => {
  beforeEach(() => {
    cacheModel("sess-1", undefined)
    cacheModel("sess-2", undefined)
  })

  test("cacheModel stores and getCachedModel retrieves", () => {
    cacheModel("sess-1", { providerID: "anthropic", modelID: "claude-sonnet" })
    expect(getCachedModel("sess-1")).toEqual({ providerID: "anthropic", modelID: "claude-sonnet" })
  })

  test("getCachedModel returns undefined for unknown session", () => {
    expect(getCachedModel("unknown-session")).toBeUndefined()
  })

  test("cacheModel overwrites previous value", () => {
    cacheModel("sess-1", { providerID: "anthropic", modelID: "claude-sonnet" })
    cacheModel("sess-1", { providerID: "openai", modelID: "gpt-4o" })
    expect(getCachedModel("sess-1")).toEqual({ providerID: "openai", modelID: "gpt-4o" })
  })

  test("cacheModel can store undefined", () => {
    cacheModel("sess-1", { providerID: "anthropic", modelID: "claude-sonnet" })
    cacheModel("sess-1", undefined)
    expect(getCachedModel("sess-1")).toBeUndefined()
  })

  test("separate sessions have independent models", () => {
    cacheModel("sess-1", { providerID: "anthropic", modelID: "claude-sonnet" })
    cacheModel("sess-2", { providerID: "openai", modelID: "gpt-4o" })
    expect(getCachedModel("sess-1")).toEqual({ providerID: "anthropic", modelID: "claude-sonnet" })
    expect(getCachedModel("sess-2")).toEqual({ providerID: "openai", modelID: "gpt-4o" })
  })
})

describe("createChatMessageHook", () => {
  beforeEach(() => {
    cacheVariant("sess-1", undefined)
    cacheModel("sess-1", undefined)
  })

  test("caches variant from message input", async () => {
    const hook = createChatMessageHook()
    await hook({
      sessionID: "sess-1",
      variant: "thinking",
    })
    expect(getCachedVariant("sess-1")).toBe("thinking")
  })

  test("caches model from message input", async () => {
    const hook = createChatMessageHook()
    await hook({
      sessionID: "sess-1",
      model: { providerID: "anthropic", modelID: "claude-sonnet" },
    })
    expect(getCachedModel("sess-1")).toEqual({ providerID: "anthropic", modelID: "claude-sonnet" })
  })

  test("caches undefined when variant not present", async () => {
    cacheVariant("sess-1", "thinking")
    const hook = createChatMessageHook()
    await hook({
      sessionID: "sess-1",
    })
    expect(getCachedVariant("sess-1")).toBeUndefined()
  })

  test("caches undefined when model not present", async () => {
    cacheModel("sess-1", { providerID: "anthropic", modelID: "claude-sonnet" })
    const hook = createChatMessageHook()
    await hook({
      sessionID: "sess-1",
    })
    expect(getCachedModel("sess-1")).toBeUndefined()
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
    expect(getCachedModel("sess-1")).toEqual({ providerID: "anthropic", modelID: "claude-sonnet" })
  })

  test("overwrites model when user switches mid-session", async () => {
    const hook = createChatMessageHook()
    await hook({
      sessionID: "sess-1",
      model: { providerID: "anthropic", modelID: "claude-sonnet" },
      variant: "thinking",
    })
    await hook({
      sessionID: "sess-1",
      model: { providerID: "openai", modelID: "gpt-4o" },
      variant: "thinking",
    })
    expect(getCachedModel("sess-1")).toEqual({ providerID: "openai", modelID: "gpt-4o" })
  })
})
