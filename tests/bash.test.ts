// tests/bash.test.ts
import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBashTool } from "../src/tools/bash"

function mockContext(dir: string) {
  return {
    sessionID: "test-session",
    messageID: "test-message",
    agent: "test-agent",
    directory: dir,
    worktree: dir,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  } as any
}

let testDir: string

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), "wf-bash-"))
})

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe("bash tool", () => {
  test("smoke test: stdout, stderr, exit code 0", async () => {
    const tool = createBashTool()
    const raw = await tool.execute(
      { command: "echo hello && echo err >&2 && exit 0" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(raw)
    expect(parsed.metadata.stdout).toContain("hello")
    expect(parsed.metadata.stderr).toContain("err")
    expect(parsed.metadata.exitCode).toBe(0)
    expect(parsed.metadata.success).toBe(true)
  })

  test("non-zero exit code", async () => {
    const tool = createBashTool()
    const raw = await tool.execute({ command: "exit 42" }, mockContext(testDir))
    const parsed = JSON.parse(raw)
    expect(parsed.metadata.exitCode).toBe(42)
    expect(parsed.metadata.success).toBe(false)
  })

  test("output truncation", async () => {
    const tool = createBashTool({ outputLimitBytes: 20 })
    const raw = await tool.execute(
      { command: "printf '%0.s1234567890' {1..5}" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(raw)
    expect(parsed.metadata.stdout).toContain("[truncated at 20 bytes]")
  })

  test("timeout", async () => {
    const tool = createBashTool({ timeoutMs: 200 })
    const raw = await tool.execute({ command: "sleep 10" }, mockContext(testDir))
    const parsed = JSON.parse(raw)
    expect(parsed.metadata.timedOut).toBe(true)
    expect(parsed.metadata.success).toBe(false)
  })
})
