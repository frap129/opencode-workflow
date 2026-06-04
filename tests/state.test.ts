// tests/state.test.ts
import { describe, test, expect, beforeEach } from "bun:test"
import { getState, updateState, resetState } from "../src/state"

describe("WorkflowState", () => {
  beforeEach(() => {
    resetState()
  })

  test("getState returns initial state", () => {
    const state = getState()
    expect(state.phase).toBeNull()
    expect(state.lastBaseSha).toBeNull()
  })

  test("updateState updates phase", () => {
    updateState({ phase: "brainstorm" })
    expect(getState().phase).toBe("brainstorm")
    expect(getState().lastBaseSha).toBeNull()
  })

  test("updateState updates lastBaseSha", () => {
    updateState({ lastBaseSha: "abc123" })
    expect(getState().lastBaseSha).toBe("abc123")
    expect(getState().phase).toBeNull()
  })

  test("updateState merges partial updates", () => {
    updateState({ phase: "plan" })
    updateState({ lastBaseSha: "def456" })
    const state = getState()
    expect(state.phase).toBe("plan")
    expect(state.lastBaseSha).toBe("def456")
  })

  test("resetState clears all state", () => {
    updateState({ phase: "implement", lastBaseSha: "abc" })
    resetState()
    const state = getState()
    expect(state.phase).toBeNull()
    expect(state.lastBaseSha).toBeNull()
  })

  test("activePlanFilename defaults to null", () => {
    resetState()
    expect(getState().activePlanFilename).toBeNull()
  })

  test("updateState sets activePlanFilename", () => {
    resetState()
    updateState({ activePlanFilename: "my-feature-plan.md" })
    expect(getState().activePlanFilename).toBe("my-feature-plan.md")
  })

  test("resetState clears activePlanFilename", () => {
    updateState({ activePlanFilename: "my-feature-plan.md" })
    resetState()
    expect(getState().activePlanFilename).toBeNull()
  })

  test("getState returns a copy (mutations don't affect internal state)", () => {
    const state = getState()
    state.phase = "implement" as any
    expect(getState().phase).toBeNull()
  })
})
