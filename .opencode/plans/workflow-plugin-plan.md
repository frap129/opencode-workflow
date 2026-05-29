# Workflow Plugin Implementation Plan

> **For agentic workers:** REQUIRED: Use subagent-driven-development (if subagents available). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an opencode plugin that provides phase-oriented workflow commands (`/brainstorm`, `/plan`, `/implement`), generates dedicated agents, and routes work through native subtasks.

**Architecture:** A single TypeScript plugin registers 9 workflow tools and 3 slash commands via opencode's plugin hooks. Agent markdown files are generated on first run into `.opencode/agents/`. Wrapper tools dispatch native subtasks via `client.session.prompt()` with `SubtaskPartInput`. Artifact tools enforce scoped read/write to `.opencode/plans/`. Phase-specific tool visibility is enforced through agent markdown `tools` frontmatter.

**Tech Stack:** TypeScript, `@opencode-ai/plugin` v1.1.57 (Zod 4 via `tool.schema`), Bun runtime, opencode SDK client for subtask dispatch.

**Spec:** `.opencode/plans/workflow-plugin-spec.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/constants.ts` | All shared constants: agent names, file paths, regex patterns, phase-to-agent mapping, phase tool matrix |
| `src/bootstrap.ts` | Check for agent files, generate all 7 on first run, directory creation, all-or-nothing logic |
| `src/agents.ts` | Markdown content strings for all 7 generated agent files |
| `src/tools/artifacts.ts` | `read_spec`, `write_spec`, `read_plan`, `write_plan` tool definitions |
| `src/tools/wrappers.ts` | `explore`, `research`, `programmer`, `review_spec`, `review_plan` tool definitions |
| `src/commands.ts` | `config` hook (command registration + tool shaping), `command.execute.before` hook (bootstrap gate + entry prompt) |
| `src/index.ts` | Plugin entry point: composes all hooks and tools into the returned `Hooks` object |
| `package.json` | Project metadata, dependencies |
| `tsconfig.json` | TypeScript config |
| `opencode.jsonc` | Plugin registration for local development |
| `tests/constants.test.ts` | Regex pattern validation tests |
| `tests/artifacts.test.ts` | Artifact tool unit tests |
| `tests/wrappers.test.ts` | Wrapper tool unit tests |
| `tests/bootstrap.test.ts` | Bootstrap logic unit tests |
| `tests/commands.test.ts` | Command registration and hook tests |

---

## Chunk 1: Project Setup, Constants, and Bootstrap

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `opencode.jsonc`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "opencode-workflow",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "bun test",
    "typecheck": "bun x tsc --noEmit"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "^1.1.57",
    "@types/bun": "latest"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "types": ["bun"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create `opencode.jsonc`**

This registers the plugin for local development.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file://src/index.ts"
  ]
}
```

- [ ] **Step 4: Install dependencies**

Run: `bun install`
Expected: `node_modules/` created, lockfile generated, zero errors.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json opencode.jsonc bun.lock
git commit -m "chore: scaffold project with package.json, tsconfig, opencode config"
```

---

### Task 2: Constants module

**Files:**
- Create: `src/constants.ts`
- Create: `tests/constants.test.ts`

- [ ] **Step 1: Write tests for filename regex patterns**

```typescript
// tests/constants.test.ts
import { describe, expect, test } from "bun:test"
import {
  SPEC_FILENAME_REGEX,
  PLAN_FILENAME_REGEX,
  AGENT_NAMES,
  PHASE_AGENT_MAP,
  PHASE_TOOL_MATRIX,
} from "../src/constants"

describe("SPEC_FILENAME_REGEX", () => {
  test("accepts valid spec filenames", () => {
    expect(SPEC_FILENAME_REGEX.test("my-feature-spec.md")).toBe(true)
    expect(SPEC_FILENAME_REGEX.test("auth.login-spec.md")).toBe(true)
    expect(SPEC_FILENAME_REGEX.test("v2_api-spec.md")).toBe(true)
    expect(SPEC_FILENAME_REGEX.test("a-spec.md")).toBe(true)
    expect(SPEC_FILENAME_REGEX.test("0-spec.md")).toBe(true)
  })

  test("rejects invalid spec filenames", () => {
    expect(SPEC_FILENAME_REGEX.test("")).toBe(false)
    expect(SPEC_FILENAME_REGEX.test("spec.md")).toBe(false)
    expect(SPEC_FILENAME_REGEX.test("-bad-spec.md")).toBe(false)
    expect(SPEC_FILENAME_REGEX.test(".hidden-spec.md")).toBe(false)
    expect(SPEC_FILENAME_REGEX.test("my-feature-plan.md")).toBe(false)
    expect(SPEC_FILENAME_REGEX.test("../escape-spec.md")).toBe(false)
    expect(SPEC_FILENAME_REGEX.test("sub/dir-spec.md")).toBe(false)
    expect(SPEC_FILENAME_REGEX.test("UPPER-spec.md")).toBe(false)
    expect(SPEC_FILENAME_REGEX.test("my feature-spec.md")).toBe(false)
  })
})

describe("PLAN_FILENAME_REGEX", () => {
  test("accepts valid plan filenames", () => {
    expect(PLAN_FILENAME_REGEX.test("my-feature-plan.md")).toBe(true)
    expect(PLAN_FILENAME_REGEX.test("auth.login-plan.md")).toBe(true)
    expect(PLAN_FILENAME_REGEX.test("v2_api-plan.md")).toBe(true)
    expect(PLAN_FILENAME_REGEX.test("a-plan.md")).toBe(true)
  })

  test("rejects invalid plan filenames", () => {
    expect(PLAN_FILENAME_REGEX.test("")).toBe(false)
    expect(PLAN_FILENAME_REGEX.test("plan.md")).toBe(false)
    expect(PLAN_FILENAME_REGEX.test("-bad-plan.md")).toBe(false)
    expect(PLAN_FILENAME_REGEX.test("my-feature-spec.md")).toBe(false)
    expect(PLAN_FILENAME_REGEX.test("../escape-plan.md")).toBe(false)
    expect(PLAN_FILENAME_REGEX.test("sub/dir-plan.md")).toBe(false)
  })
})

describe("AGENT_NAMES", () => {
  test("contains all 7 required agents", () => {
    expect(AGENT_NAMES).toHaveLength(7)
    expect(AGENT_NAMES).toContain("workflow-brainstorm")
    expect(AGENT_NAMES).toContain("workflow-plan")
    expect(AGENT_NAMES).toContain("workflow-implement")
    expect(AGENT_NAMES).toContain("workflow-explore")
    expect(AGENT_NAMES).toContain("workflow-research")
    expect(AGENT_NAMES).toContain("workflow-programmer")
    expect(AGENT_NAMES).toContain("workflow-reviewer")
  })
})

describe("PHASE_AGENT_MAP", () => {
  test("maps each command to the correct agent", () => {
    expect(PHASE_AGENT_MAP.brainstorm).toBe("workflow-brainstorm")
    expect(PHASE_AGENT_MAP.plan).toBe("workflow-plan")
    expect(PHASE_AGENT_MAP.implement).toBe("workflow-implement")
  })
})

describe("PHASE_TOOL_MATRIX", () => {
  test("brainstorm phase has correct tools", () => {
    const bs = PHASE_TOOL_MATRIX.brainstorm
    expect(bs.allowed).toEqual(
      expect.arrayContaining(["explore", "research", "read_spec", "write_spec", "review_spec"])
    )
    expect(bs.hidden).toEqual(
      expect.arrayContaining(["programmer", "review_plan", "read_plan", "write_plan"])
    )
  })

  test("plan phase has correct tools", () => {
    const pl = PHASE_TOOL_MATRIX.plan
    expect(pl.allowed).toEqual(
      expect.arrayContaining(["explore", "research", "read_spec", "read_plan", "write_plan", "review_plan"])
    )
    expect(pl.hidden).toEqual(
      expect.arrayContaining(["programmer", "write_spec", "review_spec"])
    )
  })

  test("implement phase has correct tools", () => {
    const im = PHASE_TOOL_MATRIX.implement
    expect(im.allowed).toEqual(
      expect.arrayContaining(["explore", "research", "programmer", "read_plan", "review_plan"])
    )
    expect(im.hidden).toEqual(
      expect.arrayContaining(["write_spec", "write_plan"])
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/constants.test.ts`
Expected: FAIL — module `../src/constants` not found.

- [ ] **Step 3: Implement `src/constants.ts`**

```typescript
// src/constants.ts

/** All 7 required workflow agent names */
export const AGENT_NAMES = [
  "workflow-brainstorm",
  "workflow-plan",
  "workflow-implement",
  "workflow-explore",
  "workflow-research",
  "workflow-programmer",
  "workflow-reviewer",
] as const

export type AgentName = (typeof AGENT_NAMES)[number]

/** Phase command names */
export type PhaseName = "brainstorm" | "plan" | "implement"

/** Maps each phase command to its agent name */
export const PHASE_AGENT_MAP: Record<PhaseName, AgentName> = {
  brainstorm: "workflow-brainstorm",
  plan: "workflow-plan",
  implement: "workflow-implement",
}

/** Regex for valid spec filenames: lowercase alphanumeric start, then [a-z0-9._-]*, ending with -spec.md */
export const SPEC_FILENAME_REGEX = /^[a-z0-9][a-z0-9._-]*-spec\.md$/

/** Regex for valid plan filenames: same pattern but ending with -plan.md */
export const PLAN_FILENAME_REGEX = /^[a-z0-9][a-z0-9._-]*-plan\.md$/

/** Phase tool matrix: which workflow tools are allowed/hidden per phase */
export const PHASE_TOOL_MATRIX: Record<
  PhaseName,
  { allowed: string[]; hidden: string[] }
> = {
  brainstorm: {
    allowed: ["explore", "research", "read_spec", "write_spec", "review_spec"],
    hidden: ["programmer", "review_plan", "read_plan", "write_plan"],
  },
  plan: {
    allowed: ["explore", "research", "read_spec", "read_plan", "write_plan", "review_plan"],
    hidden: ["programmer", "write_spec", "review_spec"],
  },
  implement: {
    allowed: ["explore", "research", "programmer", "read_plan", "review_plan"],
    hidden: ["write_spec", "write_plan"],
  },
}

/** Relative path from project root to agents directory */
export const AGENTS_DIR = ".opencode/agents"

/** Relative path from project root to plans directory */
export const PLANS_DIR = ".opencode/plans"

/** Returns the agent filename for a given agent name */
export function agentFilename(name: AgentName): string {
  return `${name}.md`
}

/** Returns the full relative path for an agent file */
export function agentFilePath(name: AgentName): string {
  return `${AGENTS_DIR}/${agentFilename(name)}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/constants.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/constants.ts tests/constants.test.ts
git commit -m "feat: add constants module with agent names, regex patterns, phase tool matrix"
```

---

### Task 3: Bootstrap module

**Files:**
- Create: `src/bootstrap.ts`
- Create: `tests/bootstrap.test.ts`

- [ ] **Step 1: Write tests for bootstrap logic**

```typescript
// tests/bootstrap.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  checkBootstrapStatus,
  runBootstrap,
  formatPartialBootstrapError,
} from "../src/bootstrap"
import { AGENT_NAMES, AGENTS_DIR, PLANS_DIR } from "../src/constants"

let testDir: string

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "wf-bootstrap-"))
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe("checkBootstrapStatus", () => {
  test("returns 'needs-bootstrap' when no agent files exist", async () => {
    const result = await checkBootstrapStatus(testDir)
    expect(result.status).toBe("needs-bootstrap")
  })

  test("returns 'ready' when all agent files exist", async () => {
    const agentsDir = join(testDir, AGENTS_DIR)
    await mkdir(agentsDir, { recursive: true })
    for (const name of AGENT_NAMES) {
      await writeFile(join(agentsDir, `${name}.md`), `# ${name}`)
    }
    const result = await checkBootstrapStatus(testDir)
    expect(result.status).toBe("ready")
  })

  test("returns 'partial' when some but not all agent files exist", async () => {
    const agentsDir = join(testDir, AGENTS_DIR)
    await mkdir(agentsDir, { recursive: true })
    // Create only the first 3 agents
    for (const name of AGENT_NAMES.slice(0, 3)) {
      await writeFile(join(agentsDir, `${name}.md`), `# ${name}`)
    }
    const result = await checkBootstrapStatus(testDir)
    expect(result.status).toBe("partial")
    expect(result.missing).toHaveLength(4)
  })
})

describe("runBootstrap", () => {
  test("creates all 7 agent files when none exist", async () => {
    await runBootstrap(testDir)

    const agentsDir = join(testDir, AGENTS_DIR)
    const files = await readdir(agentsDir)
    expect(files).toHaveLength(7)
    for (const name of AGENT_NAMES) {
      const content = await readFile(join(agentsDir, `${name}.md`), "utf-8")
      expect(content.length).toBeGreaterThan(0)
    }
  })

  test("creates .opencode/plans/ directory", async () => {
    await runBootstrap(testDir)

    const plansDir = join(testDir, PLANS_DIR)
    const entries = await readdir(plansDir)
    expect(entries).toBeDefined()
  })

  test("creates .opencode/agents/ directory if missing", async () => {
    await runBootstrap(testDir)

    const agentsDir = join(testDir, AGENTS_DIR)
    const entries = await readdir(agentsDir)
    expect(entries).toHaveLength(7)
  })

  test("status is 'ready' when all files already exist (bootstrap not called)", async () => {
    const agentsDir = join(testDir, AGENTS_DIR)
    await mkdir(agentsDir, { recursive: true })
    for (const name of AGENT_NAMES) {
      await writeFile(join(agentsDir, `${name}.md`), "user-edited content")
    }

    const status = await checkBootstrapStatus(testDir)
    expect(status.status).toBe("ready")
  })

  test("cleans up on partial write failure (no partial files left)", async () => {
    // Inject a failing content generator to simulate mid-bootstrap failure
    const agentsDir = join(testDir, AGENTS_DIR)
    let callCount = 0
    const failingGenerator = (name: string): string => {
      callCount++
      if (callCount > 3) throw new Error("simulated write failure")
      return `---\nname: ${name}\n---\n# ${name}\n`
    }

    await expect(runBootstrap(testDir, failingGenerator)).rejects.toThrow(
      "simulated write failure"
    )

    // Verify no agent files exist in target (all cleaned up)
    try {
      const files = await readdir(agentsDir)
      const workflowFiles = files.filter((f) => f.startsWith("workflow-"))
      expect(workflowFiles).toHaveLength(0)
    } catch {
      // Directory might not exist either — that's fine
    }

    // Verify no staging directory left behind
    const opencodeDir = join(testDir, ".opencode")
    try {
      const entries = await readdir(opencodeDir)
      expect(entries).not.toContain(".agents-staging")
    } catch {
      // .opencode dir might not exist — that's fine
    }

    // Status should still be needs-bootstrap
    const status = await checkBootstrapStatus(testDir)
    expect(status.status).toBe("needs-bootstrap")
  })

  test("refuses to run when status is not 'needs-bootstrap'", async () => {
    // Bootstrap once (succeeds)
    await runBootstrap(testDir)
    const status = await checkBootstrapStatus(testDir)
    expect(status.status).toBe("ready")

    // Attempting bootstrap again should throw
    await expect(runBootstrap(testDir)).rejects.toThrow(
      "already bootstrapped"
    )
  })

  test("no staging directory left behind after success", async () => {
    await runBootstrap(testDir)
    const opencodeDir = join(testDir, ".opencode")
    const entries = await readdir(opencodeDir)
    expect(entries).not.toContain(".agents-staging")
  })
})

describe("formatPartialBootstrapError", () => {
  test("produces actionable error message listing missing files", () => {
    const msg = formatPartialBootstrapError(
      ["workflow-explore", "workflow-research"],
      ["workflow-brainstorm", "workflow-plan", "workflow-implement",
       "workflow-programmer", "workflow-reviewer"]
    )
    expect(msg).toContain("partial agent installation detected")
    expect(msg).toContain("workflow-explore.md")
    expect(msg).toContain("workflow-research.md")
    expect(msg).toContain("5 of 7")
    expect(msg).toContain("Delete all")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/bootstrap.test.ts`
Expected: FAIL — module `../src/bootstrap` not found.

- [ ] **Step 3: Implement `src/bootstrap.ts`**

```typescript
// src/bootstrap.ts
import { mkdir, writeFile, access, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { AGENT_NAMES, AGENTS_DIR, PLANS_DIR, type AgentName } from "./constants"
import { getAgentContent } from "./agents"

export type BootstrapStatus =
  | { status: "ready" }
  | { status: "needs-bootstrap" }
  | { status: "partial"; missing: AgentName[]; present: AgentName[] }

/**
 * Check whether the required workflow agent files exist.
 * Returns 'ready' if all exist, 'needs-bootstrap' if all missing,
 * 'partial' if some but not all exist.
 */
export async function checkBootstrapStatus(
  projectDir: string
): Promise<BootstrapStatus> {
  const agentsDir = join(projectDir, AGENTS_DIR)

  const results = await Promise.all(
    AGENT_NAMES.map(async (name) => {
      const filePath = join(agentsDir, `${name}.md`)
      try {
        await access(filePath)
        return { name, exists: true }
      } catch {
        return { name, exists: false }
      }
    })
  )

  const present = results.filter((r) => r.exists).map((r) => r.name)
  const missing = results.filter((r) => !r.exists).map((r) => r.name)

  if (missing.length === 0) return { status: "ready" }
  if (present.length === 0) return { status: "needs-bootstrap" }
  return { status: "partial", missing, present }
}

/**
 * Generate all 7 workflow agent files and ensure required directories exist.
 * All-or-nothing: writes all files to a staging directory, then moves each
 * file to the target. On any failure, removes both staging dir and any files
 * already moved to the target, leaving a clean 'needs-bootstrap' state.
 *
 * Refuses to run if agents are already bootstrapped (status != 'needs-bootstrap').
 *
 * @param contentGenerator - optional override for agent content (used in tests for failure injection)
 */
export async function runBootstrap(
  projectDir: string,
  contentGenerator?: (name: AgentName) => string
): Promise<void> {
  // Refuse to run if already bootstrapped
  const status = await checkBootstrapStatus(projectDir)
  if (status.status === "ready") {
    throw new Error("Workflow agents are already bootstrapped")
  }
  if (status.status === "partial") {
    throw new Error("Partial bootstrap detected — cannot auto-bootstrap")
  }

  const agentsDir = join(projectDir, AGENTS_DIR)
  const plansDir = join(projectDir, PLANS_DIR)
  const stagingDir = join(projectDir, ".opencode/.agents-staging")
  const getContent = contentGenerator ?? getAgentContent

  // Ensure target directories exist
  await mkdir(agentsDir, { recursive: true })
  await mkdir(plansDir, { recursive: true })

  // Write all files to staging first
  await mkdir(stagingDir, { recursive: true })
  const movedFiles: string[] = []
  try {
    // Stage all files
    for (const name of AGENT_NAMES) {
      const content = getContent(name)
      await writeFile(join(stagingDir, `${name}.md`), content, "utf-8")
    }

    // Move files to final location one by one, tracking what moved
    for (const name of AGENT_NAMES) {
      const target = join(agentsDir, `${name}.md`)
      await rename(join(stagingDir, `${name}.md`), target)
      movedFiles.push(target)
    }
  } catch (error) {
    // Clean up: remove any files already moved to target
    for (const file of movedFiles) {
      await rm(file, { force: true }).catch(() => {})
    }
    // Remove staging dir
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    throw error
  } finally {
    // Clean up empty staging dir on success
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Format a user-facing error message for partial bootstrap state.
 */
export function formatPartialBootstrapError(
  missing: AgentName[],
  present: AgentName[]
): string {
  const missingList = missing.map((n) => `  - .opencode/agents/${n}.md`).join("\n")
  return [
    "Workflow plugin error: partial agent installation detected.",
    "",
    "Missing agent files:",
    missingList,
    "",
    `${present.length} of 7 agent files exist. The workflow plugin requires all 7.`,
    "",
    "To recover, either:",
    "  1. Delete all .opencode/agents/workflow-*.md files and re-run the command (triggers fresh bootstrap)",
    "  2. Manually create the missing files listed above",
  ].join("\n")
}
```

- [ ] **Step 4: Create `src/agents.ts` build-order stub**

This stub provides the `getAgentContent` function with minimal valid agent markdown so that bootstrap tests can run. The full agent content (system prompts, permissions, tool configs matching the spec's agent contracts) is implemented in Chunk 4, Task 14 which replaces this stub entirely. This is safe because: (a) bootstrap only runs on first install when no agent files exist, (b) agent files are user-owned after creation so the stub content is never "silently upgraded", and (c) a real developer would execute the full plan sequentially, so the stub is replaced before any real usage.

```typescript
// src/agents.ts
import type { AgentName } from "./constants"

/** Returns the markdown content for a generated agent file.
 *  Build-order stub — replaced with full agent content in Chunk 4, Task 14.
 */
export function getAgentContent(name: AgentName): string {
  return `---\nname: ${name}\n---\n\n# ${name}\n\nWorkflow agent.\n`
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/bootstrap.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Run typecheck on all source files**

Run: `bun x tsc --noEmit`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add src/bootstrap.ts src/agents.ts tests/bootstrap.test.ts
git commit -m "feat: add bootstrap module with agent file check and generation"
```

---

## Chunk 2: Artifact Tools

### Task 4: Artifact tool tests

**Files:**
- Create: `tests/artifacts.test.ts`

- [ ] **Step 1: Write artifact tool unit tests**

The artifact tools (`read_spec`, `write_spec`, `read_plan`, `write_plan`) are scoped file operations inside `.opencode/plans/`. Each tool validates filenames against the appropriate regex pattern and confines all I/O to that directory. These tests validate filename acceptance/rejection, path traversal prevention, read/write behavior, and structured result format.

The tools are defined with `tool()` from `@opencode-ai/plugin`, so each has an `execute(args, context)` method. Tests invoke `execute()` directly with a mock `ToolContext`.

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/artifacts.test.ts`
Expected: FAIL — module `../src/tools/artifacts` not found.

---

### Task 5: Artifact tool implementation

**Files:**
- Create: `src/tools/artifacts.ts`

- [ ] **Step 1: Implement artifact tools**

Each factory function returns a `ToolDefinition` created with `tool()` from `@opencode-ai/plugin`. All four tools share two internal helpers: `validateFilename()` and `resolvePlanPath()`. The tools use `context.directory` (not `process.cwd()`) to locate the project root.

Tool results are JSON strings with `{ title, output, metadata }` structure per the spec's artifact tool contract.

Note: The filename regex `^[a-z0-9]...` already rejects absolute paths (which start with `/`) and path traversal (which starts with `.`), satisfying the spec's "reject absolute paths outside the plans directory" and "reject path traversal" requirements.

```typescript
// src/tools/artifacts.ts
import { tool } from "@opencode-ai/plugin"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { PLANS_DIR, SPEC_FILENAME_REGEX, PLAN_FILENAME_REGEX } from "../constants"

/** Structured tool result — serialized to JSON for the model */
interface ToolResult {
  title: string
  output: string
  metadata: {
    success: boolean
    errorCode?: string
    [key: string]: unknown
  }
}

function result(r: ToolResult): string {
  return JSON.stringify(r)
}

function errorResult(title: string, message: string, errorCode: string): string {
  return result({ title, output: message, metadata: { success: false, errorCode } })
}

function validateFilename(filename: string, pattern: RegExp, kind: string): string | null {
  if (!pattern.test(filename)) {
    return errorResult(
      `Invalid ${kind} filename`,
      `"${filename}" is not a valid ${kind} filename. Must match: ${pattern.toString()}. ` +
        `Must be a simple basename (no paths), start with lowercase alphanumeric, ` +
        `and end with -${kind}.md`,
      "INVALID_FILENAME"
    )
  }
  return null
}

function resolvePlanPath(directory: string, filename: string): string {
  return join(directory, PLANS_DIR, filename)
}

export function createReadSpecTool() {
  return tool({
    description:
      "Read a spec artifact file from .opencode/plans/. " +
      "Filename must be a simple basename matching the pattern: " +
      "[a-z0-9][a-z0-9._-]*-spec.md",
    args: {
      filename: tool.schema.string().describe(
        "Spec filename (e.g. 'my-feature-spec.md'). Must end with -spec.md."
      ),
    },
    async execute(args, context) {
      const validationError = validateFilename(args.filename, SPEC_FILENAME_REGEX, "spec")
      if (validationError) return validationError

      const filePath = resolvePlanPath(context.directory, args.filename)
      context.metadata({ title: `Reading ${args.filename}` })

      try {
        const content = await readFile(filePath, "utf-8")
        return result({
          title: `Read ${args.filename}`,
          output: content,
          metadata: { success: true, filename: args.filename },
        })
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return errorResult(
            `File not found: ${args.filename}`,
            `Spec file "${args.filename}" does not exist in ${PLANS_DIR}/`,
            "FILE_NOT_FOUND"
          )
        }
        throw err
      }
    },
  })
}

export function createWriteSpecTool() {
  return tool({
    description:
      "Write (create or replace) a spec artifact file in .opencode/plans/. " +
      "Filename must be a simple basename matching the pattern: " +
      "[a-z0-9][a-z0-9._-]*-spec.md",
    args: {
      filename: tool.schema.string().describe(
        "Spec filename (e.g. 'my-feature-spec.md'). Must end with -spec.md."
      ),
      content: tool.schema.string().describe("Full file content to write."),
    },
    async execute(args, context) {
      const validationError = validateFilename(args.filename, SPEC_FILENAME_REGEX, "spec")
      if (validationError) return validationError

      const filePath = resolvePlanPath(context.directory, args.filename)
      context.metadata({ title: `Writing ${args.filename}` })

      // Ensure plans directory exists
      await mkdir(join(context.directory, PLANS_DIR), { recursive: true })
      await writeFile(filePath, args.content, "utf-8")

      return result({
        title: `Wrote ${args.filename}`,
        output: `Successfully wrote ${args.filename} to ${PLANS_DIR}/`,
        metadata: { success: true, filename: args.filename, bytes: args.content.length },
      })
    },
  })
}

export function createReadPlanTool() {
  return tool({
    description:
      "Read a plan artifact file from .opencode/plans/. " +
      "Filename must be a simple basename matching the pattern: " +
      "[a-z0-9][a-z0-9._-]*-plan.md",
    args: {
      filename: tool.schema.string().describe(
        "Plan filename (e.g. 'my-feature-plan.md'). Must end with -plan.md."
      ),
    },
    async execute(args, context) {
      const validationError = validateFilename(args.filename, PLAN_FILENAME_REGEX, "plan")
      if (validationError) return validationError

      const filePath = resolvePlanPath(context.directory, args.filename)
      context.metadata({ title: `Reading ${args.filename}` })

      try {
        const content = await readFile(filePath, "utf-8")
        return result({
          title: `Read ${args.filename}`,
          output: content,
          metadata: { success: true, filename: args.filename },
        })
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return errorResult(
            `File not found: ${args.filename}`,
            `Plan file "${args.filename}" does not exist in ${PLANS_DIR}/`,
            "FILE_NOT_FOUND"
          )
        }
        throw err
      }
    },
  })
}

export function createWritePlanTool() {
  return tool({
    description:
      "Write (create or replace) a plan artifact file in .opencode/plans/. " +
      "Filename must be a simple basename matching the pattern: " +
      "[a-z0-9][a-z0-9._-]*-plan.md",
    args: {
      filename: tool.schema.string().describe(
        "Plan filename (e.g. 'my-feature-plan.md'). Must end with -plan.md."
      ),
      content: tool.schema.string().describe("Full file content to write."),
    },
    async execute(args, context) {
      const validationError = validateFilename(args.filename, PLAN_FILENAME_REGEX, "plan")
      if (validationError) return validationError

      const filePath = resolvePlanPath(context.directory, args.filename)
      context.metadata({ title: `Writing ${args.filename}` })

      await mkdir(join(context.directory, PLANS_DIR), { recursive: true })
      await writeFile(filePath, args.content, "utf-8")

      return result({
        title: `Wrote ${args.filename}`,
        output: `Successfully wrote ${args.filename} to ${PLANS_DIR}/`,
        metadata: { success: true, filename: args.filename, bytes: args.content.length },
      })
    },
  })
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test tests/artifacts.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Run typecheck**

Run: `bun x tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/tools/artifacts.ts tests/artifacts.test.ts
git commit -m "feat: add artifact tools (read/write spec/plan) with path validation"
```

---

## Chunk 3: Wrapper Tools and Subtask Dispatch

Wrapper tools are thin dispatchers that build a subtask prompt and enqueue it via `client.session.prompt()` with `noReply: true`. Each wrapper targets a specific supporting agent. The `client` object is captured from `PluginInput` in the plugin factory closure and passed into the wrapper tool factories.

**Key API pattern** (from `@opencode-ai/plugin` SDK):

```typescript
await client.session.prompt({
  path: { id: sessionID },
  body: {
    noReply: true,
    parts: [{
      type: "subtask",
      prompt: "the full prompt for the subagent",
      description: "human-readable label",
      agent: "workflow-explore",
    }],
  },
})
```

Tools receive `ToolContext` (which has `sessionID` but not `client`). The wrapper factory functions accept `client` as a parameter so it can be captured once in the plugin entry point.

### Task 6: Wrapper tool tests

**Files:**
- Create: `tests/wrappers.test.ts`

- [ ] **Step 1: Write wrapper tool unit tests**

The wrapper tools (`explore`, `research`, `programmer`, `review_spec`, `review_plan`) each build a subtask prompt and dispatch it via `client.session.prompt()`. Tests mock `client` to capture the call and verify the correct subtask shape. Tests also verify validation (empty prompt, invalid filenames for review tools) and error handling (failed dispatch).

```typescript
// tests/wrappers.test.ts
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  createExploreTool,
  createResearchTool,
  createProgrammerTool,
  createReviewSpecTool,
  createReviewPlanTool,
} from "../src/tools/wrappers"

/**
 * Creates a mock client that records calls to session.prompt().
 * Returns the mock client and a function to retrieve captured calls.
 */
function createMockClient() {
  const calls: any[] = []
  const client = {
    session: {
      prompt: mock(async (options: any) => {
        calls.push(options)
        return { data: { id: "msg-123" } }
      }),
    },
  }
  return { client, calls }
}

function mockContext(directory: string) {
  return {
    sessionID: "test-session",
    messageID: "test-message",
    agent: "workflow-brainstorm",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  } as any
}

/**
 * Assert the full dispatch payload shape matches native subtask requirements.
 * Verifies: path.id, body.noReply, single part with type/prompt/description/agent.
 */
function assertDispatchPayload(
  call: any,
  expectedSessionID: string,
  expectedAgent: string,
  promptSubstring: string
) {
  expect(call.path.id).toBe(expectedSessionID)
  expect(call.body.noReply).toBe(true)
  expect(call.body.parts).toHaveLength(1)
  const part = call.body.parts[0]
  expect(part.type).toBe("subtask")
  expect(part.agent).toBe(expectedAgent)
  expect(part.prompt).toContain(promptSubstring)
  expect(typeof part.description).toBe("string")
  expect(part.description.length).toBeGreaterThan(0)
}

/**
 * Assert the full structured success result shape.
 * Verifies: title, output, metadata.queued, metadata.targetAgent, metadata.description.
 */
function assertSuccessResult(parsed: any, expectedAgent: string) {
  expect(typeof parsed.title).toBe("string")
  expect(parsed.title.length).toBeGreaterThan(0)
  expect(typeof parsed.output).toBe("string")
  expect(parsed.output.length).toBeGreaterThan(0)
  expect(parsed.metadata.queued).toBe(true)
  expect(parsed.metadata.targetAgent).toBe(expectedAgent)
  expect(typeof parsed.metadata.description).toBe("string")
  expect(parsed.metadata.description.length).toBeGreaterThan(0)
}

/**
 * Assert the full structured error result shape.
 * Verifies: title, output, metadata.queued=false, metadata.errorCode.
 */
function assertErrorResult(parsed: any, expectedErrorCode: string) {
  expect(typeof parsed.title).toBe("string")
  expect(parsed.title.length).toBeGreaterThan(0)
  expect(typeof parsed.output).toBe("string")
  expect(parsed.output.length).toBeGreaterThan(0)
  expect(parsed.metadata.queued).toBe(false)
  expect(parsed.metadata.errorCode).toBe(expectedErrorCode)
}

let testDir: string

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "wf-wrappers-"))
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

// ── explore ─────────────────────────────────────────────────────────

describe("explore", () => {
  test("dispatches subtask to workflow-explore with correct prompt", async () => {
    const { client, calls } = createMockClient()
    const tool = createExploreTool(client as any)
    const result = await tool.execute(
      { prompt: "Find all API endpoint handlers" },
      mockContext(testDir)
    )

    const parsed = JSON.parse(result)
    assertSuccessResult(parsed, "workflow-explore")

    expect(calls).toHaveLength(1)
    assertDispatchPayload(calls[0], "test-session", "workflow-explore", "Find all API endpoint handlers")
  })

  test("rejects empty prompt", async () => {
    const { client, calls } = createMockClient()
    const tool = createExploreTool(client as any)
    const result = await tool.execute(
      { prompt: "" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "EMPTY_PROMPT")
    expect(calls).toHaveLength(0)
  })

  test("rejects whitespace-only prompt", async () => {
    const { client, calls } = createMockClient()
    const tool = createExploreTool(client as any)
    const result = await tool.execute(
      { prompt: "   " },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "EMPTY_PROMPT")
    expect(calls).toHaveLength(0)
  })

  test("returns error when subtask dispatch fails", async () => {
    const client = {
      session: {
        prompt: mock(async () => {
          throw new Error("network failure")
        }),
      },
    }
    const tool = createExploreTool(client as any)
    const result = await tool.execute(
      { prompt: "Find API handlers" },
      mockContext(testDir)
    )

    const parsed = JSON.parse(result)
    assertErrorResult(parsed, "DISPATCH_FAILED")
    expect(parsed.output).toContain("network failure")
  })
})

// ── research ────────────────────────────────────────────────────────

describe("research", () => {
  test("dispatches subtask to workflow-research with correct prompt", async () => {
    const { client, calls } = createMockClient()
    const tool = createResearchTool(client as any)
    const result = await tool.execute(
      { prompt: "Investigate OAuth2 token refresh patterns" },
      mockContext(testDir)
    )

    const parsed = JSON.parse(result)
    assertSuccessResult(parsed, "workflow-research")

    expect(calls).toHaveLength(1)
    assertDispatchPayload(calls[0], "test-session", "workflow-research", "OAuth2 token refresh")
  })

  test("rejects empty prompt", async () => {
    const { client, calls } = createMockClient()
    const tool = createResearchTool(client as any)
    const result = await tool.execute({ prompt: "" }, mockContext(testDir))
    assertErrorResult(JSON.parse(result), "EMPTY_PROMPT")
    expect(calls).toHaveLength(0)
  })

  test("returns error when dispatch fails", async () => {
    const client = {
      session: { prompt: mock(async () => { throw new Error("timeout") }) },
    }
    const tool = createResearchTool(client as any)
    const result = await tool.execute(
      { prompt: "Research something" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "DISPATCH_FAILED")
  })
})

// ── programmer ──────────────────────────────────────────────────────

describe("programmer", () => {
  test("dispatches subtask to workflow-programmer with correct prompt", async () => {
    const { client, calls } = createMockClient()
    const tool = createProgrammerTool(client as any)
    const result = await tool.execute(
      { prompt: "Implement the user registration endpoint" },
      mockContext(testDir)
    )

    const parsed = JSON.parse(result)
    assertSuccessResult(parsed, "workflow-programmer")

    expect(calls).toHaveLength(1)
    assertDispatchPayload(calls[0], "test-session", "workflow-programmer", "user registration endpoint")
  })

  test("rejects empty prompt", async () => {
    const { client, calls } = createMockClient()
    const tool = createProgrammerTool(client as any)
    const result = await tool.execute({ prompt: "" }, mockContext(testDir))
    assertErrorResult(JSON.parse(result), "EMPTY_PROMPT")
    expect(calls).toHaveLength(0)
  })

  test("returns error when dispatch fails", async () => {
    const client = {
      session: { prompt: mock(async () => { throw new Error("server error") }) },
    }
    const tool = createProgrammerTool(client as any)
    const result = await tool.execute(
      { prompt: "Build something" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "DISPATCH_FAILED")
  })
})

// ── review_spec ─────────────────────────────────────────────────────

describe("review_spec", () => {
  test("dispatches subtask to workflow-reviewer for spec review", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewSpecTool(client as any)
    const result = await tool.execute(
      { filename: "my-feature-spec.md" },
      mockContext(testDir)
    )

    const parsed = JSON.parse(result)
    assertSuccessResult(parsed, "workflow-reviewer")

    expect(calls).toHaveLength(1)
    assertDispatchPayload(calls[0], "test-session", "workflow-reviewer", "my-feature-spec.md")
    expect(calls[0].body.parts[0].prompt).toContain("spec")
  })

  test("includes optional prompt in subtask", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewSpecTool(client as any)
    await tool.execute(
      { filename: "my-feature-spec.md", prompt: "Focus on security concerns" },
      mockContext(testDir)
    )

    expect(calls[0].body.parts[0].prompt).toContain("Focus on security concerns")
  })

  test("rejects invalid spec filename", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewSpecTool(client as any)
    const result = await tool.execute(
      { filename: "my-feature-plan.md" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "INVALID_FILENAME")
    expect(calls).toHaveLength(0)
  })

  test("rejects path traversal in filename", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewSpecTool(client as any)
    const result = await tool.execute(
      { filename: "../escape-spec.md" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "INVALID_FILENAME")
    expect(calls).toHaveLength(0)
  })

  test("rejects absolute path in filename", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewSpecTool(client as any)
    const result = await tool.execute(
      { filename: "/tmp/evil-spec.md" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "INVALID_FILENAME")
    expect(calls).toHaveLength(0)
  })

  test("returns error when dispatch fails", async () => {
    const client = {
      session: { prompt: mock(async () => { throw new Error("dispatch error") }) },
    }
    const tool = createReviewSpecTool(client as any)
    const result = await tool.execute(
      { filename: "my-feature-spec.md" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "DISPATCH_FAILED")
  })
})

// ── review_plan ─────────────────────────────────────────────────────

describe("review_plan", () => {
  test("dispatches subtask to workflow-reviewer for plan review", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewPlanTool(client as any)
    const result = await tool.execute(
      { filename: "my-feature-plan.md" },
      mockContext(testDir)
    )

    const parsed = JSON.parse(result)
    assertSuccessResult(parsed, "workflow-reviewer")

    expect(calls).toHaveLength(1)
    assertDispatchPayload(calls[0], "test-session", "workflow-reviewer", "my-feature-plan.md")
    expect(calls[0].body.parts[0].prompt).toContain("plan")
  })

  test("includes optional prompt in subtask", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewPlanTool(client as any)
    await tool.execute(
      { filename: "my-feature-plan.md", prompt: "Check task granularity" },
      mockContext(testDir)
    )

    expect(calls[0].body.parts[0].prompt).toContain("Check task granularity")
  })

  test("rejects invalid plan filename", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewPlanTool(client as any)
    const result = await tool.execute(
      { filename: "my-feature-spec.md" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "INVALID_FILENAME")
    expect(calls).toHaveLength(0)
  })

  test("rejects path traversal in filename", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewPlanTool(client as any)
    const result = await tool.execute(
      { filename: "../escape-plan.md" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "INVALID_FILENAME")
    expect(calls).toHaveLength(0)
  })

  test("rejects absolute path in filename", async () => {
    const { client, calls } = createMockClient()
    const tool = createReviewPlanTool(client as any)
    const result = await tool.execute(
      { filename: "/tmp/evil-plan.md" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "INVALID_FILENAME")
    expect(calls).toHaveLength(0)
  })

  test("returns error when dispatch fails", async () => {
    const client = {
      session: { prompt: mock(async () => { throw new Error("dispatch error") }) },
    }
    const tool = createReviewPlanTool(client as any)
    const result = await tool.execute(
      { filename: "my-feature-plan.md" },
      mockContext(testDir)
    )
    assertErrorResult(JSON.parse(result), "DISPATCH_FAILED")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/wrappers.test.ts`
Expected: FAIL — module `../src/tools/wrappers` not found.

---

### Task 7: Wrapper tool implementation

**Files:**
- Create: `src/tools/wrappers.ts`

- [ ] **Step 1: Implement `src/tools/wrappers.ts`**

All 5 wrapper tools follow the same pattern: validate input, build a subtask prompt, dispatch via `client.session.prompt()`, return structured result. A shared `dispatchSubtask()` helper eliminates duplication across the 5 tools.

The `client` parameter is typed as `any` because the full SDK client type is complex and we only use `client.session.prompt()`. Type safety comes from the call-site structure matching `SessionPromptData`.

```typescript
// src/tools/wrappers.ts
import { tool } from "@opencode-ai/plugin"
import { SPEC_FILENAME_REGEX, PLAN_FILENAME_REGEX } from "../constants"

// ── Shared helpers ──────────────────────────────────────────────────

function result(data: { title: string; output: string; metadata: Record<string, unknown> }): string {
  return JSON.stringify(data)
}

function errorResult(title: string, output: string, errorCode: string): string {
  return JSON.stringify({
    title,
    output,
    metadata: { queued: false, errorCode },
  })
}

function validatePrompt(prompt: string): string | null {
  if (!prompt || !prompt.trim()) {
    return errorResult(
      "Invalid prompt",
      "Prompt must be non-empty.",
      "EMPTY_PROMPT"
    )
  }
  return null
}

function validateFilename(filename: string, regex: RegExp, kind: string): string | null {
  if (!regex.test(filename)) {
    return errorResult(
      `Invalid ${kind} filename`,
      `Filename "${filename}" does not match the required ${kind} pattern. ` +
        `Expected a simple basename like "my-feature-${kind}.md".`,
      "INVALID_FILENAME"
    )
  }
  return null
}

/**
 * Dispatch a native subtask via client.session.prompt().
 * Returns a structured success or error result string.
 */
async function dispatchSubtask(
  client: any,
  sessionID: string,
  agent: string,
  prompt: string,
  description: string,
  metadata: (input: { title?: string; metadata?: Record<string, any> }) => void
): Promise<string> {
  metadata({ title: `Dispatching subtask to ${agent}` })

  try {
    await client.session.prompt({
      path: { id: sessionID },
      body: {
        noReply: true,
        parts: [
          {
            type: "subtask" as const,
            prompt,
            description,
            agent,
          },
        ],
      },
    })

    return result({
      title: `Queued subtask: ${description}`,
      output: `Subtask dispatched to ${agent}. It will run as a child session.`,
      metadata: { queued: true, targetAgent: agent, description },
    })
  } catch (error: any) {
    return errorResult(
      `Failed to dispatch subtask to ${agent}`,
      `Subtask dispatch failed: ${error.message}`,
      "DISPATCH_FAILED"
    )
  }
}

// ── Tool factories ──────────────────────────────────────────────────

/**
 * Create the `explore` wrapper tool.
 * Dispatches focused codebase exploration to workflow-explore.
 */
export function createExploreTool(client: any) {
  return tool({
    description:
      "Dispatch a focused codebase exploration task to the workflow-explore subagent. " +
      "Use this to find files, understand code structure, or locate specific patterns. " +
      "Runs as a native child session.",
    args: {
      prompt: tool.schema.string().describe(
        "What to explore in the codebase. Be specific about what you're looking for."
      ),
    },
    async execute(args, context) {
      const promptError = validatePrompt(args.prompt)
      if (promptError) return promptError

      return dispatchSubtask(
        client,
        context.sessionID,
        "workflow-explore",
        args.prompt.trim(),
        `Explore: ${args.prompt.trim().slice(0, 80)}`,
        context.metadata
      )
    },
  })
}

/**
 * Create the `research` wrapper tool.
 * Dispatches broader investigation to workflow-research.
 */
export function createResearchTool(client: any) {
  return tool({
    description:
      "Dispatch a research or investigation task to the workflow-research subagent. " +
      "Use this for documentation gathering, pattern analysis, or broader questions. " +
      "Runs as a native child session.",
    args: {
      prompt: tool.schema.string().describe(
        "What to research or investigate. Be specific about the question or topic."
      ),
    },
    async execute(args, context) {
      const promptError = validatePrompt(args.prompt)
      if (promptError) return promptError

      return dispatchSubtask(
        client,
        context.sessionID,
        "workflow-research",
        args.prompt.trim(),
        `Research: ${args.prompt.trim().slice(0, 80)}`,
        context.metadata
      )
    },
  })
}

/**
 * Create the `programmer` wrapper tool.
 * Dispatches implementation work to workflow-programmer.
 */
export function createProgrammerTool(client: any) {
  return tool({
    description:
      "Dispatch an implementation task to the workflow-programmer subagent. " +
      "Use this for writing code, creating files, running commands, and executing implementation work. " +
      "Runs as a native child session.",
    args: {
      prompt: tool.schema.string().describe(
        "What to implement. Include relevant context, file paths, and specific requirements."
      ),
    },
    async execute(args, context) {
      const promptError = validatePrompt(args.prompt)
      if (promptError) return promptError

      return dispatchSubtask(
        client,
        context.sessionID,
        "workflow-programmer",
        args.prompt.trim(),
        `Implement: ${args.prompt.trim().slice(0, 80)}`,
        context.metadata
      )
    },
  })
}

/**
 * Create the `review_spec` wrapper tool.
 * Dispatches spec review to workflow-reviewer with read_spec access.
 */
export function createReviewSpecTool(client: any) {
  return tool({
    description:
      "Dispatch a spec review task to the workflow-reviewer subagent. " +
      "The reviewer will read the named spec file using read_spec and provide structured feedback. " +
      "Runs as a native child session.",
    args: {
      filename: tool.schema.string().describe(
        "Spec filename to review (e.g. 'my-feature-spec.md'). Must end with -spec.md."
      ),
      prompt: tool.schema.string().optional().describe(
        "Optional review focus or specific questions for the reviewer."
      ),
    },
    async execute(args, context) {
      const filenameError = validateFilename(args.filename, SPEC_FILENAME_REGEX, "spec")
      if (filenameError) return filenameError

      const reviewPrompt = [
        `Review the spec file "${args.filename}" in .opencode/plans/.`,
        `Use the read_spec tool to read the current contents of "${args.filename}".`,
        `Provide a structured review covering completeness, clarity, and feasibility.`,
        args.prompt ? `\nSpecific focus: ${args.prompt}` : "",
      ].filter(Boolean).join("\n")

      return dispatchSubtask(
        client,
        context.sessionID,
        "workflow-reviewer",
        reviewPrompt,
        `Review spec: ${args.filename}`,
        context.metadata
      )
    },
  })
}

/**
 * Create the `review_plan` wrapper tool.
 * Dispatches plan review to workflow-reviewer with read_plan access.
 */
export function createReviewPlanTool(client: any) {
  return tool({
    description:
      "Dispatch a plan review task to the workflow-reviewer subagent. " +
      "The reviewer will read the named plan file using read_plan and provide structured feedback. " +
      "Runs as a native child session.",
    args: {
      filename: tool.schema.string().describe(
        "Plan filename to review (e.g. 'my-feature-plan.md'). Must end with -plan.md."
      ),
      prompt: tool.schema.string().optional().describe(
        "Optional review focus or specific questions for the reviewer."
      ),
    },
    async execute(args, context) {
      const filenameError = validateFilename(args.filename, PLAN_FILENAME_REGEX, "plan")
      if (filenameError) return filenameError

      const reviewPrompt = [
        `Review the plan file "${args.filename}" in .opencode/plans/.`,
        `Use the read_plan tool to read the current contents of "${args.filename}".`,
        `Provide a structured review covering task granularity, completeness, and executability.`,
        args.prompt ? `\nSpecific focus: ${args.prompt}` : "",
      ].filter(Boolean).join("\n")

      return dispatchSubtask(
        client,
        context.sessionID,
        "workflow-reviewer",
        reviewPrompt,
        `Review plan: ${args.filename}`,
        context.metadata
      )
    },
  })
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test tests/wrappers.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Run typecheck**

Run: `bun x tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/tools/wrappers.ts tests/wrappers.test.ts
git commit -m "feat: add wrapper tools (explore, research, programmer, review_spec, review_plan)"
```

- [ ] **Step 5: Manual integration smoke test (deferred to Chunk 4)**

Native subtask child sessions can only be verified with a running opencode instance. After the full plugin is assembled (Chunk 4, Task 13), perform a deterministic smoke test:

1. Start opencode in this project directory
2. In the chat, type: `/brainstorm Explore how error handling works in this project`
3. When the brainstorm agent calls the `explore` tool, verify:
   - A child session appears in the session list (visible via session picker or TUI)
   - The child session's agent is `workflow-explore`
   - The child session's prompt contains the explore text
4. If the child session does not appear, check the opencode logs for subtask dispatch errors

**Expected evidence:** A visible child session in the UI with `workflow-explore` agent assignment and a prompt derived from the `explore` tool call.

**If this fails:** The `client.session.prompt()` call shape may not match what opencode expects. Check the `noReply`, `parts[0].type`, and `parts[0].agent` fields against the SDK types.

---

## Chunk 4: Commands, Plugin Entry, Tool Shaping (Tasks 8–11)

### Task 8: Command hook tests

**Files:**
- Create: `tests/commands.test.ts`

- [ ] **Step 1: Write command registration and execution tests**

The commands module has two responsibilities:
1. `createConfigHook()` — registers 3 slash commands + applies tool shaping per phase agent in the `config` hook
2. `createCommandHook()` — intercepts command execution, gates on bootstrap, submits phase entry prompts via `command.execute.before`

Both are testable without a live opencode instance by providing mock config/input objects.

```typescript
// tests/commands.test.ts
import { describe, expect, test } from "bun:test"
import { createConfigHook, createCommandHook } from "../src/commands"
import { PHASE_AGENT_MAP, PHASE_TOOL_MATRIX, AGENT_NAMES } from "../src/constants"

// ── Config hook tests ─────────────────────────────────────────────

describe("createConfigHook", () => {
  test("registers all 3 phase commands", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    expect(config.command).toBeDefined()
    expect(config.command.brainstorm).toBeDefined()
    expect(config.command.plan).toBeDefined()
    expect(config.command.implement).toBeDefined()
  })

  test("each command has correct agent", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    expect(config.command.brainstorm.agent).toBe("workflow-brainstorm")
    expect(config.command.plan.agent).toBe("workflow-plan")
    expect(config.command.implement.agent).toBe("workflow-implement")
  })

  test("each command has template and description", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    for (const cmd of ["brainstorm", "plan", "implement"]) {
      expect(config.command[cmd].template).toBeDefined()
      expect(typeof config.command[cmd].template).toBe("string")
      expect(config.command[cmd].description).toBeDefined()
      expect(typeof config.command[cmd].description).toBe("string")
    }
  })

  test("preserves existing commands", async () => {
    const config: any = { command: { existing: { template: "test", description: "existing" } } }
    const configHook = createConfigHook()
    await configHook(config)

    expect(config.command.existing).toBeDefined()
    expect(config.command.existing.template).toBe("test")
    expect(config.command.brainstorm).toBeDefined()
  })

  test("applies tool shaping for each phase agent", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    // Config hook should set up agent-level tool visibility
    expect(config.agent).toBeDefined()

    // For each phase, hidden tools should be set to false
    for (const [phase, matrix] of Object.entries(PHASE_TOOL_MATRIX)) {
      const agentName = PHASE_AGENT_MAP[phase as keyof typeof PHASE_AGENT_MAP]
      const agentConfig = config.agent[agentName]
      expect(agentConfig).toBeDefined()
      expect(agentConfig.tools).toBeDefined()

      for (const hiddenTool of matrix.hidden) {
        expect(agentConfig.tools[hiddenTool]).toBe(false)
      }
    }
  })

  test("does not disable allowed tools for any phase", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    for (const [phase, matrix] of Object.entries(PHASE_TOOL_MATRIX)) {
      const agentName = PHASE_AGENT_MAP[phase as keyof typeof PHASE_AGENT_MAP]
      const agentConfig = config.agent[agentName]

      for (const allowedTool of matrix.allowed) {
        // Allowed tools should either be true or not present (not false)
        if (agentConfig.tools[allowedTool] !== undefined) {
          expect(agentConfig.tools[allowedTool]).not.toBe(false)
        }
      }
    }
  })

  test("brainstorm agent denies code-editing and shell tools", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    const agentConfig = config.agent["workflow-brainstorm"]
    // Built-in tool posture: deny code-editing and shell mutation
    expect(agentConfig.tools.edit).toBe(false)
    expect(agentConfig.tools.write).toBe(false)
    expect(agentConfig.tools.bash).toBe(false)
  })

  test("plan agent denies code-editing and shell tools", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    const agentConfig = config.agent["workflow-plan"]
    expect(agentConfig.tools.edit).toBe(false)
    expect(agentConfig.tools.write).toBe(false)
    expect(agentConfig.tools.bash).toBe(false)
  })

  test("implement agent does not deny code-editing or shell tools", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    const agentConfig = config.agent["workflow-implement"]
    // Implementation phase should NOT deny these
    expect(agentConfig.tools.edit).not.toBe(false)
    expect(agentConfig.tools.write).not.toBe(false)
    expect(agentConfig.tools.bash).not.toBe(false)
  })

  test("read-only subagents deny code-editing and shell tools", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    const readOnlySubagents = ["workflow-explore", "workflow-research", "workflow-reviewer"]
    for (const agentName of readOnlySubagents) {
      const agentConfig = config.agent[agentName]
      expect(agentConfig).toBeDefined()
      expect(agentConfig.tools.edit).toBe(false)
      expect(agentConfig.tools.write).toBe(false)
      expect(agentConfig.tools.bash).toBe(false)
    }
  })

  test("programmer subagent does not deny code-editing or shell tools", async () => {
    const config: any = {}
    const configHook = createConfigHook()
    await configHook(config)

    const agentConfig = config.agent["workflow-programmer"]
    // Programmer should be able to edit/write/bash
    if (agentConfig?.tools) {
      expect(agentConfig.tools.edit).not.toBe(false)
      expect(agentConfig.tools.write).not.toBe(false)
      expect(agentConfig.tools.bash).not.toBe(false)
    }
    // If no tools config at all, that's fine — means nothing is denied
  })
})

// ── Command execution hook tests ──────────────────────────────────

describe("createCommandHook", () => {
  /**
   * Mock client for capturing session.prompt() calls.
   * Returns the calls array for inspection.
   */
  function mockClient() {
    const calls: any[] = []
    return {
      calls,
      session: {
        prompt: async (opts: any) => {
          calls.push(opts)
          return { data: {} }
        },
      },
    }
  }

  /**
   * Mock checkBootstrapFn that returns a configurable status.
   */
  function mockBootstrapCheck(
    status: "ready" | "needs-bootstrap" | "partial"
  ) {
    return async (_dir: string) => {
      if (status === "partial") {
        return {
          status: "partial" as const,
          missing: ["workflow-explore"] as any,
          present: AGENT_NAMES.filter((n) => n !== "workflow-explore") as any,
        }
      }
      return { status } as any
    }
  }

  /**
   * Helper: invoke a command hook, catch the expected __WORKFLOW_HANDLED__ throw,
   * and return the client calls for inspection.
   */
  async function invokeWorkflowCommand(
    hook: Function,
    input: { command: string; sessionID: string; arguments: string }
  ) {
    const output = { parts: [] as any[] }
    try {
      await hook(input, output)
    } catch (e: any) {
      if (e.message !== "__WORKFLOW_HANDLED__") throw e
    }
  }

  test("brainstorm command submits entry prompt with correct agent", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "design a login page",
    })

    // Should have submitted a prompt to the session
    expect(client.calls).toHaveLength(1)
    const call = client.calls[0]
    expect(call.path.id).toBe("sess-1")
    expect(call.body.noReply).toBe(true)
    expect(call.body.agent).toBe("workflow-brainstorm")
    expect(call.body.parts).toHaveLength(1)
    expect(call.body.parts[0].type).toBe("text")
    expect(call.body.parts[0].text).toContain("design a login page")
  })

  test("plan command submits entry prompt with correct agent", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "plan", sessionID: "sess-1", arguments: "implement auth flow",
    })

    expect(client.calls).toHaveLength(1)
    const call = client.calls[0]
    expect(call.body.agent).toBe("workflow-plan")
    expect(call.body.parts[0].text).toContain("implement auth flow")
  })

  test("implement command submits entry prompt with correct agent", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "implement", sessionID: "sess-1", arguments: "build the auth module",
    })

    expect(client.calls).toHaveLength(1)
    const call = client.calls[0]
    expect(call.body.agent).toBe("workflow-implement")
    expect(call.body.parts[0].text).toContain("build the auth module")
  })

  test("ignores non-workflow commands (does not throw)", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const input = { command: "dcp", sessionID: "sess-1", arguments: "stats" }
    const output = { parts: [] as any[] }
    // Should return normally without throwing
    await hook(input, output)

    expect(client.calls).toHaveLength(0)
  })

  test("triggers bootstrap on needs-bootstrap status", async () => {
    let bootstrapCalled = false
    const client = mockClient()

    // First call returns needs-bootstrap, runBootstrap sets it to ready,
    // second call returns ready
    let callCount = 0
    const dynamicCheck = async (_dir: string) => {
      callCount++
      if (callCount === 1) return { status: "needs-bootstrap" as const }
      return { status: "ready" as const }
    }

    const hook = createCommandHook(
      client as any,
      "/test/project",
      dynamicCheck,
      async (_dir: string) => { bootstrapCalled = true }
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "test",
    })

    expect(bootstrapCalled).toBe(true)
    // After bootstrap, the command should still submit the entry prompt
    expect(client.calls).toHaveLength(1)
  })

  test("throws on partial bootstrap (does not auto-fix)", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("partial")
    )

    const input = { command: "brainstorm", sessionID: "sess-1", arguments: "test" }
    const output = { parts: [] as any[] }

    // Should throw with the partial bootstrap error, NOT __WORKFLOW_HANDLED__
    await expect(hook(input, output)).rejects.toThrow("partial agent installation")
    expect(client.calls).toHaveLength(0)
  })

  test("entry prompt includes user arguments when provided", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "user request here",
    })

    const promptText = client.calls[0].body.parts[0].text
    expect(promptText).toContain("user request here")
  })

  test("entry prompt works with empty arguments", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "",
    })

    expect(client.calls).toHaveLength(1)
    // Should still submit a valid entry prompt even without args
    expect(client.calls[0].body.parts[0].type).toBe("text")
    expect(client.calls[0].body.parts[0].text.length).toBeGreaterThan(0)
  })

  test("aborts command pipeline after submitting entry prompt", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    const input = { command: "brainstorm", sessionID: "sess-1", arguments: "test" }
    const output = { parts: [] as any[] }

    // The hook should throw a sentinel error to abort the pipeline
    // so opencode doesn't also send the template to the LLM
    await expect(hook(input, output)).rejects.toThrow("__WORKFLOW_HANDLED__")

    // But it should have submitted the prompt before throwing
    expect(client.calls).toHaveLength(1)
  })

  test("re-running same command is a fresh invocation (no toggle state)", async () => {
    const client = mockClient()
    const hook = createCommandHook(
      client as any,
      "/test/project",
      mockBootstrapCheck("ready")
    )

    // First invocation
    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "first topic",
    })

    // Second invocation of the same command
    await invokeWorkflowCommand(hook, {
      command: "brainstorm", sessionID: "sess-1", arguments: "second topic",
    })

    // Both should produce entry prompts (no toggle-off behavior)
    expect(client.calls).toHaveLength(2)
    expect(client.calls[0].body.parts[0].text).toContain("first topic")
    expect(client.calls[1].body.parts[0].text).toContain("second topic")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/commands.test.ts`
Expected: FAIL — module `../src/commands` not found.

---

### Task 9: Commands module

**Files:**
- Create: `src/commands.ts`

- [ ] **Step 1: Implement `src/commands.ts`**

The commands module exports two factory functions:
- `createConfigHook()` — returns the `config` callback that registers commands + tool shaping
- `createCommandHook(client, projectDir, checkBootstrapFn?, runBootstrapFn?)` — returns the `command.execute.before` callback

The command hook uses the DCP pattern: submit a `noReply: true` prompt with the entry text, then throw a sentinel error to abort the default command pipeline. This prevents the command's `template` from also being sent to the LLM.

```typescript
// src/commands.ts
import {
  PHASE_AGENT_MAP,
  PHASE_TOOL_MATRIX,
  type PhaseName,
} from "./constants"
import {
  checkBootstrapStatus as defaultCheckBootstrap,
  runBootstrap as defaultRunBootstrap,
  formatPartialBootstrapError,
  type BootstrapStatus,
} from "./bootstrap"
import type { AgentName } from "./constants"

/**
 * Phase entry prompt templates.
 * Each takes the user's arguments and returns the full entry prompt text.
 */
const ENTRY_PROMPTS: Record<PhaseName, (args: string) => string> = {
  brainstorm: (args) =>
    [
      "You are now in brainstorm mode.",
      "Your role is to explore ideas, ask clarifying questions, and help refine requirements into a spec.",
      "Use the explore and research tools to gather context. Use write_spec to save your findings.",
      "Use review_spec to get structured feedback on specs before finalizing.",
      "",
      args ? `The user wants to brainstorm: ${args}` : "Ask the user what they'd like to brainstorm.",
    ].join("\n"),

  plan: (args) =>
    [
      "You are now in plan mode.",
      "Your role is to turn an approved spec into an actionable implementation plan.",
      "Use read_spec to load the relevant spec. Use write_plan to create the plan.",
      "Use review_plan to get structured feedback on plans before finalizing.",
      "",
      args ? `The user wants to plan: ${args}` : "Ask the user which spec to plan for.",
    ].join("\n"),

  implement: (args) =>
    [
      "You are now in implement mode.",
      "Your role is to execute against an existing approved plan.",
      "Use read_plan to load the plan. Use the programmer tool for focused implementation work.",
      "Use explore and research for additional context as needed.",
      "",
      args ? `The user wants to implement: ${args}` : "Ask the user which plan to implement.",
    ].join("\n"),
}

/**
 * Creates the `config` hook callback.
 * Registers 3 slash commands and applies per-phase tool shaping.
 */
export function createConfigHook() {
  return async (config: any) => {
    // Register slash commands — the `agent` field on each command config
    // causes opencode to switch to that agent when the command is invoked.
    // Subsequent user messages stay on that agent (opencode-native behavior).
    config.command ??= {}
    for (const [phase, agent] of Object.entries(PHASE_AGENT_MAP)) {
      config.command[phase] = {
        template: `{{args}}`,
        description: `Enter ${phase} mode`,
        agent,
      }
    }

    // Apply tool shaping per phase agent
    config.agent ??= {}
    for (const [phase, matrix] of Object.entries(PHASE_TOOL_MATRIX)) {
      const agentName = PHASE_AGENT_MAP[phase as PhaseName]
      config.agent[agentName] ??= {}
      config.agent[agentName].tools ??= {}

      // Hide workflow tools per the phase matrix
      for (const hiddenTool of matrix.hidden) {
        config.agent[agentName].tools[hiddenTool] = false
      }
    }

    // Built-in tool posture: brainstorm and plan deny code-editing and shell tools
    const readOnlyPhases: PhaseName[] = ["brainstorm", "plan"]
    const deniedBuiltinTools = ["edit", "write", "bash"]
    for (const phase of readOnlyPhases) {
      const agentName = PHASE_AGENT_MAP[phase]
      for (const tool of deniedBuiltinTools) {
        config.agent[agentName].tools[tool] = false
      }
    }

    // Supporting subagent tool posture: enforce read-only / non-mutating contracts
    const readOnlySubagents = ["workflow-explore", "workflow-research", "workflow-reviewer"]
    for (const agentName of readOnlySubagents) {
      config.agent[agentName] ??= {}
      config.agent[agentName].tools ??= {}
      for (const tool of deniedBuiltinTools) {
        config.agent[agentName].tools[tool] = false
      }
    }
  }
}

/**
 * Creates the `command.execute.before` hook callback.
 * Gates on bootstrap status, submits phase entry prompts, then aborts pipeline.
 *
 * @param client - opencode SDK client (captured from PluginInput)
 * @param projectDir - project root directory
 * @param checkBootstrapFn - override for testing (defaults to checkBootstrapStatus)
 * @param runBootstrapFn - override for testing (defaults to runBootstrap)
 */
export function createCommandHook(
  client: any,
  projectDir: string,
  checkBootstrapFn: (dir: string) => Promise<BootstrapStatus> = defaultCheckBootstrap,
  runBootstrapFn: (dir: string) => Promise<void> = defaultRunBootstrap
) {
  const phaseNames = new Set(Object.keys(PHASE_AGENT_MAP))

  return async (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: any[] }
  ) => {
    // Only handle workflow commands
    if (!phaseNames.has(input.command)) return

    const phase = input.command as PhaseName
    const agent = PHASE_AGENT_MAP[phase]

    // Bootstrap gate
    const status = await checkBootstrapFn(projectDir)
    if (status.status === "needs-bootstrap") {
      await runBootstrapFn(projectDir)
    } else if (status.status === "partial") {
      const errorMsg = formatPartialBootstrapError(status.missing, status.present)
      throw new Error(errorMsg)
    }
    // status === "ready" — proceed

    // Build entry prompt
    const args = (input.arguments || "").trim()
    const entryPrompt = ENTRY_PROMPTS[phase](args)

    // Submit entry prompt to session with noReply.
    // Agent switching is handled by two complementary mechanisms:
    // 1. The command config's `agent` field (set in createConfigHook) tells opencode
    //    to switch the session's active agent when the command is invoked.
    // 2. The `body.agent` field on this prompt call ensures this specific message
    //    is routed to the correct agent.
    // The throw below aborts the command template pipeline but does NOT undo
    // the agent switch — this follows the same pattern used by the DCP plugin.
    // Runtime verification of this behavior is in Chunk 5, Task 13, Steps 5-6.
    await client.session.prompt({
      path: { id: input.sessionID },
      body: {
        noReply: true,
        agent,
        parts: [{ type: "text", text: entryPrompt }],
      },
    })

    // Abort the command pipeline so opencode doesn't also send the template
    throw new Error("__WORKFLOW_HANDLED__")
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test tests/commands.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Run typecheck**

Run: `bun x tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/commands.ts tests/commands.test.ts
git commit -m "feat: add command registration and execution hooks"
```

---

### Task 10: Plugin entry tests

**Files:**
- Create: `tests/index.test.ts`

- [ ] **Step 1: Write plugin entry point tests**

The plugin entry (`src/index.ts`) is the async function that composes all hooks and tools. Tests verify it returns the correct hook structure.

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/index.test.ts`
Expected: FAIL — module `../src/index` not found or `createPlugin` not exported.

---

### Task 11: Plugin entry point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement `src/index.ts`**

The entry point composes all modules into the plugin factory function.

```typescript
// src/index.ts
import type { Plugin } from "@opencode-ai/plugin"
import {
  createReadSpecTool,
  createWriteSpecTool,
  createReadPlanTool,
  createWritePlanTool,
} from "./tools/artifacts"
import {
  createExploreTool,
  createResearchTool,
  createProgrammerTool,
  createReviewSpecTool,
  createReviewPlanTool,
} from "./tools/wrappers"
import { createConfigHook, createCommandHook } from "./commands"

/**
 * Creates the workflow plugin hooks object.
 * Exported for testing — the default export wraps this in the Plugin type.
 */
export async function createPlugin(ctx: {
  client: any
  project?: any
  directory: string
  worktree: string
  serverUrl: URL
  $: any
}) {
  const { client, directory } = ctx

  return {
    tool: {
      // Artifact tools
      read_spec: createReadSpecTool(),
      write_spec: createWriteSpecTool(),
      read_plan: createReadPlanTool(),
      write_plan: createWritePlanTool(),

      // Wrapper tools (need client for subtask dispatch)
      explore: createExploreTool(client),
      research: createResearchTool(client),
      programmer: createProgrammerTool(client),
      review_spec: createReviewSpecTool(client),
      review_plan: createReviewPlanTool(client),
    },

    config: createConfigHook(),

    "command.execute.before": createCommandHook(client, directory),
  }
}

/**
 * The plugin entry point.
 * opencode calls this with PluginInput and expects a Hooks object back.
 */
const plugin: Plugin = async (ctx) => createPlugin(ctx)

export default plugin
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test tests/index.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: All test files pass (constants, bootstrap, artifacts, wrappers, commands, index).

- [ ] **Step 4: Run typecheck**

Run: `bun x tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: add plugin entry point composing all hooks and tools"
```

---

## Chunk 5: Agent Content and Integration (Tasks 12–13)

### Task 12: Agent content (replace stub)

**Files:**
- Modify: `src/agents.ts` (replace entire content)
- Modify: `tests/bootstrap.test.ts` (append agent content tests)

- [ ] **Step 1: Write agent content tests**

Add tests to `tests/bootstrap.test.ts` verifying the generated agent content matches the spec's minimum contracts. **Note:** Merge the `getAgentContent` import into the file's existing import from `../src/agents` (do not duplicate the import block).

```typescript
// Append to tests/bootstrap.test.ts
// Merge this import into the existing import from "../src/agents":
import { getAgentContent } from "../src/agents"

describe("getAgentContent", () => {
  test("all 7 agents return non-empty content", () => {
    for (const name of AGENT_NAMES) {
      const content = getAgentContent(name)
      expect(content.length).toBeGreaterThan(50)
    }
  })

  test("each agent content includes the agent name in frontmatter", () => {
    for (const name of AGENT_NAMES) {
      const content = getAgentContent(name)
      expect(content).toContain(`name: ${name}`)
    }
  })

  test("each agent content starts with valid frontmatter", () => {
    for (const name of AGENT_NAMES) {
      const content = getAgentContent(name)
      expect(content.startsWith("---\n")).toBe(true)
      // Should have opening and closing frontmatter delimiters
      const parts = content.split("---")
      expect(parts.length).toBeGreaterThanOrEqual(3)
    }
  })

  test("brainstorm agent references its available tools", () => {
    const content = getAgentContent("workflow-brainstorm")
    expect(content).toContain("explore")
    expect(content).toContain("research")
    expect(content).toContain("write_spec")
    expect(content).toContain("review_spec")
    expect(content).toContain("read_spec")
    // Should instruct not to write code
    expect(content).toMatch(/do not.*(?:write|edit|create).*(?:code|implementation)/i)
  })

  test("plan agent references its available tools", () => {
    const content = getAgentContent("workflow-plan")
    expect(content).toContain("read_spec")
    expect(content).toContain("write_plan")
    expect(content).toContain("review_plan")
    expect(content).toContain("read_plan")
    // Should instruct not to write code
    expect(content).toMatch(/do not.*(?:write|edit|create).*(?:code|implementation)/i)
  })

  test("implement agent references its available tools", () => {
    const content = getAgentContent("workflow-implement")
    expect(content).toContain("programmer")
    expect(content).toContain("read_plan")
    expect(content).toContain("explore")
    expect(content).toContain("research")
  })

  test("explore subagent is read-only and non-mutating", () => {
    const content = getAgentContent("workflow-explore")
    expect(content).toMatch(/read.only/i)
    expect(content).toMatch(/do not.*(?:edit|create|delete)/i)
  })

  test("research subagent is non-mutating", () => {
    const content = getAgentContent("workflow-research")
    expect(content).toMatch(/research|gather|context/i)
    expect(content).toMatch(/do not.*(?:edit|modify|create|delete)/i)
    // Must not have implementation-oriented instructions
    expect(content).not.toMatch(/implement.*code/i)
  })

  test("programmer subagent allows implementation", () => {
    const content = getAgentContent("workflow-programmer")
    expect(content).toMatch(/implement|code|edit/i)
    // Should reference testing
    expect(content).toMatch(/test/i)
  })

  test("reviewer subagent is read-only and review-oriented", () => {
    const content = getAgentContent("workflow-reviewer")
    expect(content).toMatch(/review|critique|feedback/i)
    expect(content).toContain("read_spec")
    expect(content).toContain("read_plan")
    expect(content).toMatch(/do not.*(?:edit|create|write)/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail with the stub**

Run: `bun test tests/bootstrap.test.ts`
Expected: New `getAgentContent` tests FAIL — stub returns content < 50 chars and missing required patterns.

- [ ] **Step 3: Replace `src/agents.ts` with full agent content**

Replace the entire stub with production agent markdown content. Each agent file uses opencode's agent markdown format with `---` frontmatter delimiters.

```typescript
// src/agents.ts
import type { AgentName } from "./constants"

/**
 * Agent content map. Each entry is the full markdown content
 * for the generated agent file at .opencode/agents/<name>.md
 */
const AGENT_CONTENT: Record<AgentName, string> = {
  "workflow-brainstorm": `---
name: workflow-brainstorm
---

# Workflow Brainstorm Agent

You are a brainstorming specialist. Your role is to explore ideas, ask clarifying questions, gather context, and help the user refine their requirements into a clear, reviewed spec.

## Your workflow

1. **Understand** — Ask the user clarifying questions about their goals, constraints, and priorities
2. **Explore** — Use the \`explore\` tool to inspect the codebase for relevant patterns, existing code, and architecture
3. **Research** — Use the \`research\` tool to gather broader technical context when needed
4. **Draft** — Use \`write_spec\` to create or update spec documents in \`.opencode/plans/\`
5. **Review** — Use \`review_spec\` to get structured feedback on your spec before finalizing
6. **Iterate** — Refine the spec based on review feedback until it is approved

## Tool usage

- Use \`explore\` to inspect the local codebase and understand existing patterns
- Use \`research\` to gather broader technical context and documentation
- Use \`read_spec\` to load existing spec files
- Use \`write_spec\` to save spec drafts to \`.opencode/plans/\`
- Use \`review_spec\` to request structured review of a spec

## Constraints

- Focus on understanding and documenting requirements, not implementing them
- Do not write implementation code or make code changes
- Do not use shell commands to modify files
- Always save specs to \`.opencode/plans/\` using the spec tools
- Spec filenames must end with \`-spec.md\` (e.g., \`auth-flow-spec.md\`)
`,

  "workflow-plan": `---
name: workflow-plan
---

# Workflow Plan Agent

You are a planning specialist. Your role is to turn an approved spec into an actionable, step-by-step implementation plan.

## Your workflow

1. **Load spec** — Use \`read_spec\` to load the relevant spec document
2. **Explore** — Use \`explore\` to understand the current codebase structure and patterns
3. **Research** — Use \`research\` for any additional technical context needed
4. **Draft plan** — Use \`write_plan\` to create a detailed implementation plan
5. **Review** — Use \`review_plan\` to get structured feedback on the plan
6. **Iterate** — Refine the plan based on review feedback until approved

## Plan format

Plans should include:
- Clear task breakdown with specific file paths
- TDD steps: write failing test, implement, verify
- Exact code snippets and commands
- Commit points after each logical unit
- Dependencies between tasks clearly marked

## Tool usage

- Use \`read_spec\` to load the spec being planned for
- Use \`explore\` to inspect the codebase
- Use \`research\` to gather additional context
- Use \`read_plan\` to load existing plan drafts
- Use \`write_plan\` to save plan documents to \`.opencode/plans/\`
- Use \`review_plan\` to request structured review of a plan

## Constraints

- Do not write implementation code or make code changes
- Do not use shell commands to modify files
- Plans must reference the source spec
- Plan filenames must end with \`-plan.md\` (e.g., \`auth-flow-plan.md\`)
`,

  "workflow-implement": `---
name: workflow-implement
---

# Workflow Implement Agent

You are an implementation specialist. Your role is to execute against an approved plan, using focused subagents for specific implementation work.

## Your workflow

1. **Load plan** — Use \`read_plan\` to load the implementation plan
2. **Execute** — Work through plan tasks, using \`programmer\` for focused implementation
3. **Explore** — Use \`explore\` when you need additional codebase context
4. **Research** — Use \`research\` for documentation or technical references
5. **Verify** — Use \`review_plan\` to check progress against the plan
6. **Track** — Mark completed tasks and commit at specified points

## Tool usage

- Use \`read_plan\` to load and re-read the plan
- Use \`programmer\` to delegate focused implementation work to a subagent
- Use \`explore\` to gather codebase context
- Use \`research\` for technical references
- Use \`review_plan\` to verify progress against the plan

## Constraints

- Follow the plan's task order and commit points
- Use the \`programmer\` tool for focused coding tasks
- Do not modify specs — implementation changes should feed back as plan updates if needed
`,

  "workflow-explore": `---
name: workflow-explore
---

# Workflow Explore Agent

You are a codebase exploration specialist. Your role is to inspect the local codebase and report findings without making any edits.

## Your role

- Read and analyze source code files
- Identify patterns, architecture, and conventions
- Find relevant code for a given question or task
- Report your findings clearly and concisely

## Constraints

- **Read-only**: Do not edit, create, or delete any files
- **No shell mutations**: Do not run commands that modify the filesystem
- **Report findings**: Return structured observations, not opinions on what to change
- Use file reading, search, and inspection tools only
`,

  "workflow-research": `---
name: workflow-research
---

# Workflow Research Agent

You are a research specialist. Your role is to gather broader technical context and synthesize findings for the parent workflow.

## Your role

- Research documentation, APIs, libraries, and technical concepts
- Gather context from external sources when needed
- Synthesize findings into clear, actionable summaries
- Provide technical context to support brainstorming, planning, or implementation

## Constraints

- **Non-mutating**: Do not edit code or modify the filesystem
- **Research-oriented**: Focus on gathering and synthesizing information
- Use reading, search, and web-fetch tools
- Return clear summaries with sources when applicable
`,

  "workflow-programmer": `---
name: workflow-programmer
---

# Workflow Programmer Agent

You are a focused implementation specialist. Your role is to perform specific coding tasks delegated from the parent workflow.

## Your role

- Implement code changes as described in the task prompt
- Write tests following TDD practices
- Edit files, run commands, and verify results
- Report completion status back to the parent workflow

## Approach

1. Understand the specific task from the prompt
2. Write failing tests first (when applicable)
3. Implement the minimal code to pass tests
4. Run verification commands
5. Report results

## Constraints

- Stay focused on the specific delegated task
- Follow existing codebase conventions
- Use standard opencode implementation tools (edit, bash, etc.)
- Report blockers clearly rather than working around them
`,

  "workflow-reviewer": `---
name: workflow-reviewer
---

# Workflow Reviewer Agent

You are a review specialist. Your role is to review named artifacts and return structured critique.

## Your role

- Read the specified artifact file using the appropriate read tool
- Provide structured, actionable feedback
- Identify gaps, inconsistencies, and areas for improvement
- Assess completeness against stated goals

## Review format

Provide your review in this structure:
1. **Summary** — Brief overview of what was reviewed
2. **Strengths** — What works well
3. **Issues** — Specific problems that need fixing (with locations)
4. **Recommendations** — Suggestions for improvement
5. **Verdict** — Approved / Needs revision

## Tool usage

- Use \`read_spec\` to load spec files for review
- Use \`read_plan\` to load plan files for review

## Constraints

- **Read-only**: Do not edit, create, or write any files
- **No code changes**: Your role is review, not implementation
- Focus on the artifact content, not on making changes
- Be specific and actionable in your feedback
`,
}

/**
 * Returns the full markdown content for a generated agent file.
 */
export function getAgentContent(name: AgentName): string {
  return AGENT_CONTENT[name]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/bootstrap.test.ts`
Expected: All tests PASS, including the new `getAgentContent` tests.

- [ ] **Step 5: Run all tests**

Run: `bun test`
Expected: All test files pass.

- [ ] **Step 6: Run typecheck**

Run: `bun x tsc --noEmit`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add src/agents.ts tests/bootstrap.test.ts
git commit -m "feat: add full agent markdown content for all 7 workflow agents"
```

---

### Task 13: Integration verification

**Files:**
- No new files — manual verification of the assembled plugin.

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: All tests pass across all test files:
- `tests/constants.test.ts`
- `tests/bootstrap.test.ts`
- `tests/artifacts.test.ts`
- `tests/wrappers.test.ts`
- `tests/commands.test.ts`
- `tests/index.test.ts`

- [ ] **Step 2: Run final typecheck**

Run: `bun x tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Verify plugin loads in opencode**

Start opencode in the project directory:

```bash
opencode
```

Expected: opencode starts without plugin load errors. The workflow plugin should initialize successfully. Check for any error messages in the startup output.

If the plugin fails to load, check:
1. The `opencode.jsonc` `plugin` path is correct (`file://src/index.ts`)
2. The default export is a valid Plugin function
3. No import errors in the module graph

- [ ] **Step 4: Verify slash commands are registered**

In the opencode TUI, press `/` or type `/` to open the command picker.

Expected: `brainstorm`, `plan`, and `implement` appear in the command list with their descriptions.

If commands don't appear:
1. Check that the `config` hook runs without errors
2. Verify `config.command` is being mutated correctly
3. Check opencode logs for config hook failures

- [ ] **Step 5: Test bootstrap flow**

**Prerequisite:** Ensure no `.opencode/agents/workflow-*.md` files exist. If they do from a previous run, remove them first:

```bash
rm -f .opencode/agents/workflow-*.md 2>/dev/null
ls .opencode/agents/workflow-*.md 2>/dev/null || echo "No workflow agents — ready for bootstrap test"
```

Run the brainstorm command:
```
/brainstorm Test the brainstorm phase
```

Expected:
1. Bootstrap runs automatically (first time only)
2. All 7 `.opencode/agents/workflow-*.md` files are created
3. The session switches to the `workflow-brainstorm` agent
4. The entry prompt is visible in the session

Verify agent files were created:
```bash
ls -la .opencode/agents/workflow-*.md
```

Expected: 7 files listed.

- [ ] **Step 6: Test subtask dispatch (wrapper tool smoke test)**

After entering brainstorm mode in Step 5, type a follow-up message that explicitly requests tool use:

```
Use the explore tool to look at the project structure in this directory
```

This phrasing directly instructs the model to use the `explore` tool, making the test deterministic.

Expected:
1. The session is still using the `workflow-brainstorm` agent (agent persists after command — opencode-native behavior via command `agent` field)
2. The brainstorm agent calls the `explore` wrapper tool
3. A child session appears in the session list (visible in the TUI sidebar or session picker)
4. The child session uses the `workflow-explore` agent
5. The child session's prompt contains exploration instructions

If the child session does not appear:
1. Check opencode logs for subtask dispatch errors
2. Verify `client.session.prompt()` call shape matches SDK expectations
3. Check `noReply`, `parts[0].type`, and `parts[0].agent` fields
4. If the model does not call `explore` despite being asked, this indicates the tool is not visible to the agent — check the `config` hook tool matrix

- [ ] **Step 7: Test tool shaping**

Verify tool shaping by testing denied tools in each phase. For each test:
- Ask the agent to use the denied tool by name
- **Evidence for denied tools:** The TUI tool trace should show NO tool call for the denied tool. The model may say it doesn't have the tool, or opencode may show an error. Either outcome confirms denial.
- **Evidence for allowed tools:** The TUI tool trace should show an actual tool call entry with the tool name, arguments, and output.

**Brainstorm phase** (still in the session from Step 5):

Test 1 — denied workflow tool:
```
Use the programmer tool to implement a hello world function
```
Expected: The model cannot call `programmer` (it should say it doesn't have access or attempt another approach).

Test 2 — denied built-in tool (edit):
```
Use the edit tool to modify src/index.ts
```
Expected: The model cannot call `edit` (denied for brainstorm phase).

Test 3 — denied built-in tool (bash):
```
Use the bash tool to run ls -la
```
Expected: The model cannot call `bash` (denied for brainstorm phase).

Test 4 — allowed tool works:
```
Use the read_spec tool to read my-spec.md
```
Expected: The `read_spec` tool is called (it may return a file-not-found error, which is fine — the point is the tool was accessible).

**Plan phase** (start a new session):
```
/plan test
```
Test 5 — denied workflow tool:
```
Use the write_spec tool to write a new spec
```
Expected: `write_spec` is denied for plan phase.

Test 6 — denied built-in tool (write):
```
Use the write tool to create a new file at src/hello.ts
```
Expected: `write` is denied for plan phase.

**Implement phase** (start a new session):
```
/implement test
```
Test 7 — denied workflow tool:
```
Use the write_plan tool to create a plan
```
Expected: `write_plan` is denied for implement phase.

Test 8 — allowed built-in tool (implement can edit/bash):
```
Use the bash tool to run echo hello
```
Expected: `bash` is callable (implement phase allows code-editing and shell tools). **Evidence:** The TUI tool trace shows a `bash` tool call with output `hello`.

**Note:** If a denied tool is still callable, check:
1. The `config` hook ran successfully (verify via opencode startup logs)
2. The `PHASE_TOOL_MATRIX` constant matches the spec
3. The agent-level `tools` config was set correctly (`{ toolName: false }`)

- [ ] **Step 8: Final commit (all green)**

```bash
git add -A
git status
# If any uncommitted changes remain:
git commit -m "chore: integration verification complete"
```

---
