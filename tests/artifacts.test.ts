// tests/artifacts.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  createReadSpecTool,
  createWriteSpecTool,
  createReadPlanTool,
  createWritePlanTool,
  createEditSpecTool,
  createEditPlanTool,
} from "../src/tools/artifacts"
import { PLANS_DIR } from "../src/constants"

/**
 * Minimal mock ToolContext for direct execute() calls.
 * `directory` is the key field — artifact tools resolve paths relative to it.
 */
function mockContext(directory: string) {
  return {
    sessionID: "test-session",
    messageID: "test-message",
    agent: "test-agent",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  } as any
}

let testDir: string
let plansDir: string

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "wf-artifacts-"))
  plansDir = join(testDir, PLANS_DIR)
  await mkdir(plansDir, { recursive: true })
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

// ── write_spec ──────────────────────────────────────────────────────

describe("write_spec", () => {
  test("writes a valid spec file", async () => {
    const tool = createWriteSpecTool()
    const result = await tool.execute(
      { filename: "my-feature-spec.md", content: "# My Feature Spec\n\nDetails here." },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.output).toContain("my-feature-spec.md")
    expect(parsed.metadata.success).toBe(true)

    // Verify file actually exists with correct content
    const filePath = join(plansDir, "my-feature-spec.md")
    const content = await readFile(filePath, "utf-8")
    expect(content).toBe("# My Feature Spec\n\nDetails here.")
  })

  test("overwrites existing spec file", async () => {
    const tool = createWriteSpecTool()
    const ctx = mockContext(testDir)
    await tool.execute({ filename: "x-spec.md", content: "v1" }, ctx)
    await tool.execute({ filename: "x-spec.md", content: "v2" }, ctx)

    const content = await readFile(join(plansDir, "x-spec.md"), "utf-8")
    expect(content).toBe("v2")
  })

  test("rejects invalid filename (no -spec.md suffix)", async () => {
    const tool = createWriteSpecTool()
    const result = await tool.execute(
      { filename: "my-feature-plan.md", content: "content" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("INVALID_FILENAME")
  })

  test("rejects path traversal", async () => {
    const tool = createWriteSpecTool()
    const result = await tool.execute(
      { filename: "../escape-spec.md", content: "content" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("INVALID_FILENAME")
  })

  test("rejects subdirectory paths", async () => {
    const tool = createWriteSpecTool()
    const result = await tool.execute(
      { filename: "sub/dir-spec.md", content: "content" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("INVALID_FILENAME")
  })

  test("rejects uppercase filenames", async () => {
    const tool = createWriteSpecTool()
    const result = await tool.execute(
      { filename: "UPPER-spec.md", content: "content" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("INVALID_FILENAME")
  })

  test("rejects filename starting with dash", async () => {
    const tool = createWriteSpecTool()
    const result = await tool.execute(
      { filename: "-bad-spec.md", content: "content" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("INVALID_FILENAME")
  })

  test("rejects absolute paths", async () => {
    const tool = createWriteSpecTool()
    const result = await tool.execute(
      { filename: "/tmp/evil-spec.md", content: "content" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("INVALID_FILENAME")
  })
})

// ── read_spec ───────────────────────────────────────────────────────

describe("read_spec", () => {
  test("reads an existing spec file", async () => {
    await writeFile(join(plansDir, "my-feature-spec.md"), "# Feature Spec")
    const tool = createReadSpecTool()
    const result = await tool.execute(
      { filename: "my-feature-spec.md" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.output).toBe("# Feature Spec")
    expect(parsed.metadata.success).toBe(true)
  })

  test("returns error for non-existent file", async () => {
    const tool = createReadSpecTool()
    const result = await tool.execute(
      { filename: "missing-spec.md" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("FILE_NOT_FOUND")
  })

  test("rejects invalid filename", async () => {
    const tool = createReadSpecTool()
    const result = await tool.execute(
      { filename: "../etc/passwd" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("INVALID_FILENAME")
  })

  test("rejects plan filename in spec tool", async () => {
    const tool = createReadSpecTool()
    const result = await tool.execute(
      { filename: "my-feature-plan.md" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("INVALID_FILENAME")
  })

  test("rejects absolute paths", async () => {
    const tool = createReadSpecTool()
    const result = await tool.execute(
      { filename: "/etc/passwd" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("INVALID_FILENAME")
  })
})

// ── write_plan ──────────────────────────────────────────────────────

describe("write_plan", () => {
  test("writes a valid plan file", async () => {
    const tool = createWritePlanTool()
    const result = await tool.execute(
      { filename: "my-feature-plan.md", content: "# Plan\n\n## Tasks" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(true)

    const content = await readFile(join(plansDir, "my-feature-plan.md"), "utf-8")
    expect(content).toBe("# Plan\n\n## Tasks")
  })

  test("rejects spec filename in plan tool", async () => {
    const tool = createWritePlanTool()
    const result = await tool.execute(
      { filename: "my-feature-spec.md", content: "content" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("INVALID_FILENAME")
  })

  test("rejects path traversal", async () => {
    const tool = createWritePlanTool()
    const result = await tool.execute(
      { filename: "../escape-plan.md", content: "content" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("INVALID_FILENAME")
  })

  test("rejects absolute paths", async () => {
    const tool = createWritePlanTool()
    const result = await tool.execute(
      { filename: "/tmp/evil-plan.md", content: "content" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("INVALID_FILENAME")
  })
})

// ── read_plan ───────────────────────────────────────────────────────

describe("read_plan", () => {
  test("reads an existing plan file", async () => {
    await writeFile(join(plansDir, "my-feature-plan.md"), "# Plan Content")
    const tool = createReadPlanTool()
    const result = await tool.execute(
      { filename: "my-feature-plan.md" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.output).toBe("# Plan Content")
    expect(parsed.metadata.success).toBe(true)
  })

  test("returns error for non-existent file", async () => {
    const tool = createReadPlanTool()
    const result = await tool.execute(
      { filename: "missing-plan.md" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("FILE_NOT_FOUND")
  })

  test("rejects spec filename in plan tool", async () => {
    const tool = createReadPlanTool()
    const result = await tool.execute(
      { filename: "my-feature-spec.md" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("INVALID_FILENAME")
  })

  test("rejects absolute paths", async () => {
    const tool = createReadPlanTool()
    const result = await tool.execute(
      { filename: "/etc/shadow" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("INVALID_FILENAME")
  })
})

// ── plans directory auto-creation ───────────────────────────────────

describe("plans directory handling", () => {
  test("write_spec creates plans directory if missing", async () => {
    // Remove the pre-created plans dir
    await rm(plansDir, { recursive: true, force: true })

    const tool = createWriteSpecTool()
    const result = await tool.execute(
      { filename: "new-spec.md", content: "content" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(true)

    const content = await readFile(join(plansDir, "new-spec.md"), "utf-8")
    expect(content).toBe("content")
  })

  test("write_plan creates plans directory if missing", async () => {
    await rm(plansDir, { recursive: true, force: true })

    const tool = createWritePlanTool()
    const result = await tool.execute(
      { filename: "new-plan.md", content: "content" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(true)

    const content = await readFile(join(plansDir, "new-plan.md"), "utf-8")
    expect(content).toBe("content")
  })
})

// ── review nudges ───────────────────────────────────────────────────

describe("review nudges", () => {
  test("write_spec includes review nudge", async () => {
    const tool = createWriteSpecTool()
    const result = await tool.execute(
      { filename: "nudge-spec.md", content: "content" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(true)
    expect(parsed.output).toContain("✅ Wrote nudge-spec.md")
    expect(parsed.output).toContain("NEXT REQUIRED STEP")
    expect(parsed.output).toContain("review_spec")
  })

  test("write_plan includes review nudge", async () => {
    const tool = createWritePlanTool()
    const result = await tool.execute(
      { filename: "nudge-plan.md", content: "content" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(true)
    expect(parsed.output).toContain("✅ Wrote nudge-plan.md")
    expect(parsed.output).toContain("NEXT REQUIRED STEP")
    expect(parsed.output).toContain("review_plan")
  })
})

// ── edit_spec ───────────────────────────────────────────────────────

describe("edit_spec", () => {
  test("replaces exactly one matching block and includes strong nudge for review", async () => {
    await writeFile(join(plansDir, "my-feature-spec.md"), "# Title\n\nOld section.\n\nFin.")
    const tool = createEditSpecTool()
    const result = await tool.execute(
      { filename: "my-feature-spec.md", old_text: "Old section.", new_text: "New section." },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(true)
    expect(parsed.output).toContain("✅ Updated my-feature-spec.md")
    expect(parsed.output).toContain("NEXT REQUIRED STEP")
    expect(parsed.output).toContain("review_spec")

    const content = await readFile(join(plansDir, "my-feature-spec.md"), "utf-8")
    expect(content).toBe("# Title\n\nNew section.\n\nFin.")
  })

  test("errors when old_text matches multiple locations", async () => {
    await writeFile(join(plansDir, "dup-spec.md"), "repeat repeat")
    const tool = createEditSpecTool()
    const result = await tool.execute(
      { filename: "dup-spec.md", old_text: "repeat", new_text: "once" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("AMBIGUOUS_MATCH")
  })
})

// ── edit_plan ───────────────────────────────────────────────────────

describe("edit_plan", () => {
  test("errors when old_text is missing (TEXT_NOT_FOUND)", async () => {
    await writeFile(join(plansDir, "my-feature-plan.md"), "# Plan\n\nSome content.")
    const tool = createEditPlanTool()
    const result = await tool.execute(
      { filename: "my-feature-plan.md", old_text: "nonexistent text", new_text: "replacement" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(false)
    expect(parsed.metadata.errorCode).toBe("TEXT_NOT_FOUND")
  })

  test("edit_plan includes strong nudge for review", async () => {
    await writeFile(join(plansDir, "my-feature-plan.md"), "# Plan\n\nOld content.")
    const tool = createEditPlanTool()
    const result = await tool.execute(
      { filename: "my-feature-plan.md", old_text: "Old content.", new_text: "New content." },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(true)
    expect(parsed.output).toContain("✅ Updated my-feature-plan.md")
    expect(parsed.output).toContain("NEXT REQUIRED STEP")
    expect(parsed.output).toContain("review_plan")
  })

  test("allows empty new_text for deletion", async () => {
    await writeFile(join(plansDir, "delete-plan.md"), "Keep this. Remove this.")
    const tool = createEditPlanTool()
    const result = await tool.execute(
      { filename: "delete-plan.md", old_text: " Remove this.", new_text: "" },
      mockContext(testDir)
    )
    const parsed = JSON.parse(result)
    expect(parsed.metadata.success).toBe(true)

    const content = await readFile(join(plansDir, "delete-plan.md"), "utf-8")
    expect(content).toBe("Keep this.")
  })
})
