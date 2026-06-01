import { describe, test, expect } from "bun:test"
import { getHeadSha } from "../src/git"

describe("getHeadSha", () => {
  test("returns a 40-character hex SHA for the current repo", async () => {
    const sha = await getHeadSha(process.cwd())
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
  })

  test("throws for non-existent directory", async () => {
    await expect(getHeadSha("/tmp/nonexistent-dir-12345")).rejects.toThrow()
  })

  test("throws for directory that is not a git repo", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const dir = await mkdtemp(`${tmpdir()}/git-test-`)
    try {
      await expect(getHeadSha(dir)).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true })
    }
  })
})
