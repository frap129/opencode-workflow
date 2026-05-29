# Prompt Injection & Missing Tools Implementation Plan

> **For agentic workers:** REQUIRED: Use subagent-driven-development (if subagents available). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the opencode-workflow plugin to inject skill-derived prompts, fill subagent templates with placeholders, add 6 new tools, and enforce tool permission isolation.

**Architecture:** New foundation modules (`src/prompts.ts`, `src/git.ts`, `src/state.ts`) provide prompt constants, git utilities, and state management. Existing modules (`constants.ts`, `commands.ts`, `wrappers.ts`, `artifacts.ts`, `agents.ts`, `index.ts`) are updated to use templates and register new tools. All prompt content is inlined as TypeScript string constants following the existing `agents.ts` pattern.

**Tech Stack:** TypeScript, Bun runtime, `@opencode-ai/plugin` SDK, `bun:test`

**Spec:** `.opencode/plans/prompt-injection-spec.md`

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/prompts.ts` | All prompt/template string constants + `fillTemplate()` utility |
| `src/git.ts` | `getHeadSha()` — git HEAD SHA retrieval |
| `src/state.ts` | `WorkflowState` interface, `getState()`, `updateState()` |
| `src/tools/bash.ts` | `createBashTool()` — shell execution with timeout/truncation |
| `tests/prompts.test.ts` | Tests for `fillTemplate()` and prompt constants |
| `tests/git.test.ts` | Tests for `getHeadSha()` |
| `tests/state.test.ts` | Tests for state management |
| `tests/bash.test.ts` | Tests for bash tool |

### Modified Files
| File | Changes |
|---|---|
| `src/constants.ts` | Add 6 new tool names, update `PHASE_TOOL_MATRIX` to 15 tools |
| `src/commands.ts` | Replace generic `ENTRY_PROMPTS` with skill-derived prompts from `prompts.ts` |
| `src/tools/wrappers.ts` | Update 5 existing tools to use templates; add 3 new tools (`verify_spec_compliance`, `code_review`, `investigate`) |
| `src/tools/artifacts.ts` | Add `editArtifact` helper, `createEditSpecTool`, `createEditPlanTool`; add review nudges to all write/edit tools |
| `src/agents.ts` | Update 3 primary agent frontmatter with explicit `allow`/`deny` for all 15 workflow tools |
| `src/index.ts` | Register 6 new tools, wire command hook state updates, and expose all 15 workflow tools |
| `README.md` | Add setup section with global permission deny snippet |
| `tests/constants.test.ts` | Update for expanded tool matrix |
| `tests/wrappers.test.ts` | Update for template filling; add tests for 3 new tools |
| `tests/artifacts.test.ts` | Add edit tool tests; add review nudge assertions |
| `tests/commands.test.ts` | Verify skill text injection in entry prompts |
| `tests/index.test.ts` | Update tool registration assertions from 9 tools to 15 tools |
| `tests/bootstrap.test.ts` | Extend agent-content assertions for explicit allow/deny workflow tool permissions |

---

## Chunk 1: Foundation Modules

### Task 1: Create `src/prompts.ts` — fillTemplate utility and prompt constants

**Files:**
- Create: `src/prompts.ts`
- Create: `tests/prompts.test.ts`

#### fillTemplate utility

- [ ] **Step 1: Write failing tests for `fillTemplate`**

```ts
// tests/prompts.test.ts
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test"
import { fillTemplate } from "../src/prompts"

describe("fillTemplate", () => {
  let stderrWrite: ReturnType<typeof mock>
  let originalWrite: typeof process.stderr.write

  beforeEach(() => {
    originalWrite = process.stderr.write
    stderrWrite = mock(() => true)
    process.stderr.write = stderrWrite as any
  })

  afterEach(() => {
    process.stderr.write = originalWrite
  })

  test("replaces single placeholder", () => {
    const result = fillTemplate("Hello [NAME]!", { NAME: "World" })
    expect(result).toBe("Hello World!")
  })

  test("replaces multiple different placeholders", () => {
    const result = fillTemplate("[A] and [B]", { A: "foo", B: "bar" })
    expect(result).toBe("foo and bar")
  })

  test("replaces all occurrences of same placeholder", () => {
    const result = fillTemplate("[X] then [X]", { X: "val" })
    expect(result).toBe("val then val")
  })

  test("leaves unfilled placeholders as-is and warns to stderr", () => {
    const result = fillTemplate("Hello [NAME]!", {})
    expect(result).toBe("Hello [NAME]!")
    expect(stderrWrite).toHaveBeenCalled()
    const warning = stderrWrite.mock.calls[0][0] as string
    expect(warning).toContain("NAME")
  })

  test("handles template with no placeholders", () => {
    const result = fillTemplate("No placeholders here", { UNUSED: "val" })
    expect(result).toBe("No placeholders here")
  })

  test("handles empty replacements object", () => {
    const result = fillTemplate("Just text", {})
    expect(result).toBe("Just text")
  })

  test("replaces placeholders with multi-line content", () => {
    const result = fillTemplate("[CONTENT]", { CONTENT: "line1\nline2\nline3" })
    expect(result).toBe("line1\nline2\nline3")
  })

  test("handles placeholders with spaces in name", () => {
    const result = fillTemplate("[FULL TEXT of task]", { "FULL TEXT of task": "my task" })
    expect(result).toBe("my task")
  })

  test("handles placeholders with mixed case", () => {
    const result = fillTemplate("[Scene-setting context]", { "Scene-setting context": "ctx" })
    expect(result).toBe("ctx")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/prompts.test.ts
```
Expected: FAIL — `fillTemplate` not found

- [ ] **Step 3: Implement `fillTemplate`**

```ts
// src/prompts.ts
export function fillTemplate(
  template: string,
  replacements: Record<string, string>
): string {
  const placeholderRegex = /\[([^\]]+)\]/g
  const warned = new Set<string>()
  let result = template

  for (const [key, value] of Object.entries(replacements)) {
    result = result.replaceAll(`[${key}]`, value)
  }

  let match: RegExpExecArray | null
  while ((match = placeholderRegex.exec(result)) !== null) {
    const name = match[1]
    if (!warned.has(name)) {
      warned.add(name)
      process.stderr.write(
        `[workflow] Warning: unfilled placeholder [${name}] in template\n`
      )
    }
  }

  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/prompts.test.ts
```
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/prompts.ts tests/prompts.test.ts
git commit -m "feat: add fillTemplate utility for prompt placeholder replacement"
```

#### Phase prompt constants

- [ ] **Step 6: Add phase prompt constant tests**

Append to `tests/prompts.test.ts`:

```ts
import {
  BRAINSTORM_PHASE_PROMPT,
  PLAN_PHASE_PROMPT,
  IMPLEMENT_PHASE_PROMPT,
} from "../src/prompts"

describe("phase prompt constants", () => {
  test("BRAINSTORM_PHASE_PROMPT contains key brainstorming concepts", () => {
    expect(BRAINSTORM_PHASE_PROMPT).toContain("HARD-GATE")
    expect(BRAINSTORM_PHASE_PROMPT).toContain("clarifying questions")
    expect(BRAINSTORM_PHASE_PROMPT).toContain("write_spec")
    expect(BRAINSTORM_PHASE_PROMPT).toContain("review_spec")
    expect(BRAINSTORM_PHASE_PROMPT).toContain("Propose 2-3 approaches")
    expect(BRAINSTORM_PHASE_PROMPT).toContain("Spec review loop")
  })

  test("PLAN_PHASE_PROMPT contains key planning concepts", () => {
    expect(PLAN_PHASE_PROMPT).toContain("Bite-Sized")
    expect(PLAN_PHASE_PROMPT).toContain("TDD")
    expect(PLAN_PHASE_PROMPT).toContain("write_plan")
    expect(PLAN_PHASE_PROMPT).toContain("review_plan")
    expect(PLAN_PHASE_PROMPT).toContain("Chunk")
    expect(PLAN_PHASE_PROMPT).toContain("subagent-driven-development")
  })

  test("IMPLEMENT_PHASE_PROMPT contains key implementation concepts", () => {
    expect(IMPLEMENT_PHASE_PROMPT).toContain("programmer subagent")
    expect(IMPLEMENT_PHASE_PROMPT).toContain("spec compliance")
    expect(IMPLEMENT_PHASE_PROMPT).toContain("code quality")
    expect(IMPLEMENT_PHASE_PROMPT).toContain("DONE")
    expect(IMPLEMENT_PHASE_PROMPT).toContain("BLOCKED")
    expect(IMPLEMENT_PHASE_PROMPT).toContain("NEEDS_CONTEXT")
  })
})
```

- [ ] **Step 7: Run tests to verify they fail**

```bash
bun test tests/prompts.test.ts
```
Expected: FAIL — constants not exported

- [ ] **Step 8: Add phase prompt constants to `src/prompts.ts`**

Append to `src/prompts.ts`. These are adapted from the brainstorming, writing-plans, and subagent-driven-development SKILL.md files. Strip YAML frontmatter and visual companion sections (not relevant to opencode). Adapt tool/file references to use opencode conventions.

```ts
// ── Phase Prompt Constants ──────────────────────────────────────────

export const BRAINSTORM_PHASE_PROMPT = `# Brainstorming Ideas Into Designs
...
`

export const PLAN_PHASE_PROMPT = `# Writing Plans
...
`

export const IMPLEMENT_PHASE_PROMPT = `# Subagent-Driven Development
...
`
```

Use the exact finalized text already captured from the skill files during planning research. Keep the bodies inline in this file; do not load them from disk at runtime.

- [ ] **Step 9: Run tests to verify they pass**

```bash
bun test tests/prompts.test.ts
```
Expected: All 12 tests PASS

- [ ] **Step 10: Commit**

```bash
git add src/prompts.ts tests/prompts.test.ts
git commit -m "feat: add phase prompt constants derived from skills"
```

#### Subagent dispatch template constants

- [ ] **Step 11: Add template constant tests**

Append to `tests/prompts.test.ts`:

```ts
import {
  PROGRAMMER_TEMPLATE,
  EXPLORE_TEMPLATE,
  RESEARCH_TEMPLATE,
  INVESTIGATE_TEMPLATE,
  SPEC_REVIEWER_TEMPLATE,
  CODE_QUALITY_REVIEWER_TEMPLATE,
  SPEC_DOCUMENT_REVIEWER_TEMPLATE,
  PLAN_DOCUMENT_REVIEWER_TEMPLATE,
} from "../src/prompts"

describe("subagent template constants", () => {
  test("PROGRAMMER_TEMPLATE has required placeholders", () => {
    expect(PROGRAMMER_TEMPLATE).toContain("[task name]")
    expect(PROGRAMMER_TEMPLATE).toContain("[FULL TEXT of task]")
    expect(PROGRAMMER_TEMPLATE).toContain("[Scene-setting context]")
    expect(PROGRAMMER_TEMPLATE).toContain("[directory]")
    expect(PROGRAMMER_TEMPLATE).toContain("Self-Review")
    expect(PROGRAMMER_TEMPLATE).toContain("Report Format")
  })

  test("EXPLORE_TEMPLATE contains exploration instructions", () => {
    expect(EXPLORE_TEMPLATE).toContain("Explore")
    expect(EXPLORE_TEMPLATE).toContain("Do not modify")
  })

  test("RESEARCH_TEMPLATE contains research instructions", () => {
    expect(RESEARCH_TEMPLATE).toContain("Research")
    expect(RESEARCH_TEMPLATE).toContain("Do not modify")
  })

  test("INVESTIGATE_TEMPLATE contains investigation framing", () => {
    expect(INVESTIGATE_TEMPLATE).toContain("Investigate")
    expect(INVESTIGATE_TEMPLATE).toContain("debug")
  })

  test("SPEC_REVIEWER_TEMPLATE has required placeholders", () => {
    expect(SPEC_REVIEWER_TEMPLATE).toContain("[FULL TEXT of task requirements]")
    expect(SPEC_REVIEWER_TEMPLATE).toContain("[From implementer's report]")
    expect(SPEC_REVIEWER_TEMPLATE).toContain("Do Not Trust the Report")
  })

  test("CODE_QUALITY_REVIEWER_TEMPLATE has required placeholders", () => {
    expect(CODE_QUALITY_REVIEWER_TEMPLATE).toContain("[WHAT_WAS_IMPLEMENTED]")
    expect(CODE_QUALITY_REVIEWER_TEMPLATE).toContain("[BASE_SHA]")
    expect(CODE_QUALITY_REVIEWER_TEMPLATE).toContain("[HEAD_SHA]")
    expect(CODE_QUALITY_REVIEWER_TEMPLATE).toContain("[DESCRIPTION]")
  })

  test("SPEC_DOCUMENT_REVIEWER_TEMPLATE has required placeholders", () => {
    expect(SPEC_DOCUMENT_REVIEWER_TEMPLATE).toContain("[SPEC_FILE_PATH]")
    expect(SPEC_DOCUMENT_REVIEWER_TEMPLATE).toContain("Completeness")
    expect(SPEC_DOCUMENT_REVIEWER_TEMPLATE).toContain("YAGNI")
  })

  test("PLAN_DOCUMENT_REVIEWER_TEMPLATE has required placeholders", () => {
    expect(PLAN_DOCUMENT_REVIEWER_TEMPLATE).toContain("[PLAN_FILE_PATH]")
    expect(PLAN_DOCUMENT_REVIEWER_TEMPLATE).toContain("[SPEC_FILE_PATH]")
    expect(PLAN_DOCUMENT_REVIEWER_TEMPLATE).toContain("Spec Alignment")
  })
})
```

- [ ] **Step 12: Run tests to verify they fail**

```bash
bun test tests/prompts.test.ts
```
Expected: FAIL — template constants not exported

- [ ] **Step 13: Add subagent template constants to `src/prompts.ts`**

Append to `src/prompts.ts` using the exact finalized text already gathered from:
- `programmer-prompt.md`
- `spec-reviewer-prompt.md`
- `code-quality-reviewer-prompt.md`
- `spec-document-reviewer-prompt.md`
- `plan-document-reviewer-prompt.md`
- plus the one-line explore/research prompt texts and the investigation framing from the spec

```ts
// ── Subagent Dispatch Templates ─────────────────────────────────────

export const PROGRAMMER_TEMPLATE = `...`
export const EXPLORE_TEMPLATE = `Explore the codebase. Report findings. Do not modify anything.\n\n`
export const RESEARCH_TEMPLATE = `Research the topic. Summarize findings with sources. Do not modify anything.\n\n`
export const INVESTIGATE_TEMPLATE = `Investigate and debug the following issue. Read relevant code, trace the problem, and report your findings. Do not modify anything.\n\n`
export const SPEC_REVIEWER_TEMPLATE = `...`
export const CODE_QUALITY_REVIEWER_TEMPLATE = `...`
export const SPEC_DOCUMENT_REVIEWER_TEMPLATE = `...`
export const PLAN_DOCUMENT_REVIEWER_TEMPLATE = `...`
```

Keep the exact placeholders intact so `fillTemplate()` can replace them later.

- [ ] **Step 14: Run tests to verify they pass**

```bash
bun test tests/prompts.test.ts
```
Expected: All 20 tests PASS

- [ ] **Step 15: Commit**

```bash
git add src/prompts.ts tests/prompts.test.ts
git commit -m "feat: add subagent dispatch template constants"
```

---

### Task 2: Create `src/git.ts` — git HEAD SHA utility

**Files:**
- Create: `src/git.ts`
- Create: `tests/git.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/git.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/git.test.ts
```
Expected: FAIL — `getHeadSha` not found

- [ ] **Step 3: Implement `getHeadSha`**

```ts
// src/git.ts
export async function getHeadSha(cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git rev-parse HEAD failed (exit ${exitCode}): ${stderr.trim()}`)
  }

  const stdout = await new Response(proc.stdout).text()
  return stdout.trim()
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/git.test.ts
```
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/git.ts tests/git.test.ts
git commit -m "feat: add getHeadSha git utility"
```

---

### Task 3: Create `src/state.ts` — workflow state management

**Files:**
- Create: `src/state.ts`
- Create: `tests/state.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
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

  test("getState returns a copy (mutations don't affect internal state)", () => {
    const state = getState()
    state.phase = "implement" as any
    expect(getState().phase).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/state.test.ts
```
Expected: FAIL — imports not found

- [ ] **Step 3: Implement state module**

```ts
// src/state.ts
import type { PhaseName } from "./constants"

export interface WorkflowState {
  phase: PhaseName | null
  lastBaseSha: string | null
}

const initialState: WorkflowState = {
  phase: null,
  lastBaseSha: null,
}

let state: WorkflowState = { ...initialState }

export function getState(): WorkflowState {
  return { ...state }
}

export function updateState(partial: Partial<WorkflowState>): void {
  state = { ...state, ...partial }
}

export function resetState(): void {
  state = { ...initialState }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/state.test.ts
```
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/state.ts tests/state.test.ts
git commit -m "feat: add workflow state management module"
```

---

### Task 4: Update `src/constants.ts` — expanded tool matrix

**Files:**
- Modify: `src/constants.ts`
- Modify: `tests/constants.test.ts`

- [ ] **Step 1: Update test expectations for expanded tool matrix**

In `tests/constants.test.ts`, update or add tests that verify the new `PHASE_TOOL_MATRIX`:

```ts
test("brainstorm phase allows 6 tools and hides 9", () => {
  const { allowed, hidden } = PHASE_TOOL_MATRIX.brainstorm
  expect(allowed).toEqual([
    "explore", "research", "read_spec", "write_spec", "edit_spec", "review_spec",
  ])
  expect(hidden).toEqual([
    "programmer", "review_plan", "read_plan", "write_plan", "edit_plan",
    "verify_spec_compliance", "code_review", "investigate", "bash",
  ])
})

test("plan phase allows 7 tools and hides 8", () => {
  const { allowed, hidden } = PHASE_TOOL_MATRIX.plan
  expect(allowed).toEqual([
    "explore", "research", "read_spec", "read_plan", "write_plan", "edit_plan", "review_plan",
  ])
  expect(hidden).toEqual([
    "programmer", "write_spec", "edit_spec", "review_spec",
    "verify_spec_compliance", "code_review", "investigate", "bash",
  ])
})

test("implement phase allows 11 tools and hides 4", () => {
  const { allowed, hidden } = PHASE_TOOL_MATRIX.implement
  expect(allowed).toEqual([
    "explore", "research", "programmer", "read_plan", "review_plan",
    "read_spec", "review_spec", "verify_spec_compliance", "code_review",
    "investigate", "bash",
  ])
  expect(hidden).toEqual([
    "write_spec", "edit_spec", "write_plan", "edit_plan",
  ])
})

test("all 15 tools appear in every phase (allowed + hidden)", () => {
  const ALL_TOOLS = [
    "explore", "research", "read_spec", "write_spec", "edit_spec", "review_spec",
    "read_plan", "write_plan", "edit_plan", "review_plan",
    "programmer", "verify_spec_compliance", "code_review", "investigate", "bash",
  ]

  for (const phase of ["brainstorm", "plan", "implement"] as const) {
    const { allowed, hidden } = PHASE_TOOL_MATRIX[phase]
    expect([...allowed, ...hidden].sort()).toEqual([...ALL_TOOLS].sort())
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/constants.test.ts
```
Expected: FAIL — matrix doesn't match new expectations

- [ ] **Step 3: Update `src/constants.ts`**

```ts
export const PHASE_TOOL_MATRIX: Record<PhaseName, { allowed: string[]; hidden: string[] }> = {
  brainstorm: {
    allowed: ["explore", "research", "read_spec", "write_spec", "edit_spec", "review_spec"],
    hidden: [
      "programmer", "review_plan", "read_plan", "write_plan", "edit_plan",
      "verify_spec_compliance", "code_review", "investigate", "bash",
    ],
  },
  plan: {
    allowed: ["explore", "research", "read_spec", "read_plan", "write_plan", "edit_plan", "review_plan"],
    hidden: [
      "programmer", "write_spec", "edit_spec", "review_spec",
      "verify_spec_compliance", "code_review", "investigate", "bash",
    ],
  },
  implement: {
    allowed: [
      "explore", "research", "programmer", "read_plan", "review_plan",
      "read_spec", "review_spec", "verify_spec_compliance", "code_review",
      "investigate", "bash",
    ],
    hidden: ["write_spec", "edit_spec", "write_plan", "edit_plan"],
  },
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/constants.test.ts
```
Expected: All tests PASS

- [ ] **Step 5: Run full test suite to check nothing broke**

```bash
bun test
```
Expected: All existing tests still PASS

- [ ] **Step 6: Commit**

```bash
git add src/constants.ts tests/constants.test.ts
git commit -m "feat: expand phase tool matrix to 15 tools"
```

---

## Chunk 2: Tool Modules

> **Dependency note:** This chunk depends on Chunk 1 (`prompts.ts`, `git.ts`, `state.ts`, `constants.ts`) landing first. It is intentionally **not independently shippable**: Chunk 3 will handle tool registration in `src/index.ts` and the remaining wiring/integration work. Chunk 2 focuses on the tool modules and their unit/integration tests in isolation.

### Task 5: Create `src/tools/bash.ts` — direct shell execution tool

**Files:**
- Create: `src/tools/bash.ts`
- Create: `tests/bash.test.ts`

- [ ] **Step 1: Write failing tests for bash execution, truncation, and timeout**

```ts
// tests/bash.test.ts
import { describe, test, expect } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { createBashTool } from "../src/tools/bash"

function mockContext(directory: string) {
  return {
    directory,
    metadata: () => {},
  } as any
}

describe("createBashTool", () => {
  test("executes a command and returns stdout/stderr/exitCode", async () => {
    const dir = await mkdtemp(`${tmpdir()}/workflow-bash-`)
    try {
      const toolDef = createBashTool({ timeoutMs: 500, outputLimitBytes: 1024 })
      const raw = await toolDef.execute(
        { command: "printf 'hello'; printf 'warn' 1>&2", description: "smoke test" },
        mockContext(dir)
      )

      const result = JSON.parse(raw)
      expect(result.metadata.success).toBe(true)
      expect(result.metadata.exitCode).toBe(0)
      expect(result.metadata.stdout).toBe("hello")
      expect(result.metadata.stderr).toBe("warn")
      expect(result.metadata.timedOut).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("returns success false for non-zero exit", async () => {
    const dir = await mkdtemp(`${tmpdir()}/workflow-bash-`)
    try {
      const toolDef = createBashTool({ timeoutMs: 500, outputLimitBytes: 1024 })
      const raw = await toolDef.execute({ command: "echo boom 1>&2; exit 7" }, mockContext(dir))
      const result = JSON.parse(raw)

      expect(result.metadata.success).toBe(false)
      expect(result.metadata.exitCode).toBe(7)
      expect(result.metadata.stderr).toContain("boom")
      expect(result.metadata.timedOut).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("truncates long output per stream", async () => {
    const dir = await mkdtemp(`${tmpdir()}/workflow-bash-`)
    try {
      const toolDef = createBashTool({ timeoutMs: 500, outputLimitBytes: 32 })
      const raw = await toolDef.execute(
        { command: "printf 'abcdefghijklmnopqrstuvwxyz0123456789'" },
        mockContext(dir)
      )
      const result = JSON.parse(raw)

      expect(result.metadata.stdout).toContain("[truncated at 32 bytes]")
      expect(result.metadata.stderr).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("kills long-running commands when timeout is exceeded", async () => {
    const dir = await mkdtemp(`${tmpdir()}/workflow-bash-`)
    try {
      const toolDef = createBashTool({ timeoutMs: 25, outputLimitBytes: 1024 })
      const raw = await toolDef.execute({ command: "sleep 1" }, mockContext(dir))
      const result = JSON.parse(raw)

      expect(result.metadata.success).toBe(false)
      expect(result.metadata.timedOut).toBe(true)
      expect(result.output).toContain("timed out")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/bash.test.ts
```
Expected: FAIL — `createBashTool` not found

- [ ] **Step 3: Implement `createBashTool()` with injected limits for testability**

```ts
// src/tools/bash.ts
import { tool } from "@opencode-ai/plugin"

interface BashToolOptions {
  timeoutMs?: number
  outputLimitBytes?: number
}

function result(data: { title: string; output: string; metadata: Record<string, unknown> }): string {
  return JSON.stringify(data)
}

function truncateOutput(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text

  let truncated = text
  while (Buffer.byteLength(truncated, "utf8") > maxBytes) {
    truncated = truncated.slice(0, -1)
  }
  return `${truncated}\n... [truncated at ${maxBytes} bytes]`
}

export function createBashTool(options: BashToolOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000
  const outputLimitBytes = options.outputLimitBytes ?? 50 * 1024

  return tool({
    description: "Execute a shell command in the project directory with timeout and output truncation.",
    args: {
      command: tool.schema.string().describe("Shell command to execute."),
      description: tool.schema.string().optional().describe("Optional human-readable description."),
    },
    async execute(args, context) {
      const command = args.command.trim()
      if (!command) {
        return result({
          title: "Invalid command",
          output: "Command must be non-empty.",
          metadata: { success: false, errorCode: "EMPTY_COMMAND" },
        })
      }

      context.metadata({ title: args.description ?? `Running: ${command.slice(0, 60)}` })

      const proc = Bun.spawn(["sh", "-c", command], {
        cwd: context.directory,
        stdout: "pipe",
        stderr: "pipe",
      })

      let timedOut = false
      const exitPromise = proc.exited
      const timeoutPromise = new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), timeoutMs)
      })

      const race = await Promise.race([exitPromise, timeoutPromise])
      if (race === "timeout") {
        timedOut = true
        proc.kill()
      }

      const exitCode = await exitPromise
      const stdout = truncateOutput(await new Response(proc.stdout).text(), outputLimitBytes)
      const stderr = truncateOutput(await new Response(proc.stderr).text(), outputLimitBytes)
      const success = exitCode === 0 && !timedOut

      return result({
        title: timedOut ? "Bash command timed out" : "Executed bash command",
        output: timedOut
          ? `Command timed out after ${timeoutMs}ms.`
          : success
            ? "Command completed successfully."
            : "Command failed.",
        metadata: { success, exitCode, stdout, stderr, timedOut },
      })
    },
  })
}
```

**Behavior note:** The test should assert `timedOut: true` and timeout messaging, but must **not** assert an exact exit code for killed processes because that can vary by platform/runtime.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/bash.test.ts
```
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/bash.ts tests/bash.test.ts
git commit -m "feat: add direct bash tool with timeout and truncation"
```

---

### Task 6: Update `src/tools/artifacts.ts` — edit tools and review nudges

**Files:**
- Modify: `src/tools/artifacts.ts`
- Modify: `tests/artifacts.test.ts`

- [ ] **Step 1: Add failing tests for review nudges and exact-match edit behavior**

Append to `tests/artifacts.test.ts`:

```ts
test("write_spec includes review nudge", async () => {
  const toolDef = createWriteSpecTool()
  const raw = await toolDef.execute(
    { filename: "feature-spec.md", content: "# Spec" },
    mockContext(tempDir)
  )
  const result = JSON.parse(raw)

  expect(result.metadata.success).toBe(true)
  expect(result.output).toContain("Call 'review_spec' to review it")
})

test("write_plan includes review nudge", async () => {
  const toolDef = createWritePlanTool()
  const raw = await toolDef.execute(
    { filename: "feature-plan.md", content: "# Plan" },
    mockContext(tempDir)
  )
  const result = JSON.parse(raw)

  expect(result.metadata.success).toBe(true)
  expect(result.output).toContain("Call 'review_plan' to review it")
})

test("edit_spec replaces exactly one matching block and includes nudge", async () => {
  await mkdir(join(tempDir, ".opencode/plans"), { recursive: true })
  await writeFile(join(tempDir, ".opencode/plans", "feature-spec.md"), "alpha\nbeta\ngamma\n")

  const toolDef = createEditSpecTool()
  const raw = await toolDef.execute(
    { filename: "feature-spec.md", old_text: "beta", new_text: "BETA" },
    mockContext(tempDir)
  )
  const result = JSON.parse(raw)

  expect(result.metadata.success).toBe(true)
  expect(result.output).toContain("Call 'review_spec' to review the changes")

  const updated = await readFile(join(tempDir, ".opencode/plans", "feature-spec.md"), "utf8")
  expect(updated).toBe("alpha\nBETA\ngamma\n")
})

test("edit_plan errors when old_text is missing", async () => {
  await mkdir(join(tempDir, ".opencode/plans"), { recursive: true })
  await writeFile(join(tempDir, ".opencode/plans", "feature-plan.md"), "one\ntwo\n")

  const toolDef = createEditPlanTool()
  const raw = await toolDef.execute(
    { filename: "feature-plan.md", old_text: "three", new_text: "THREE" },
    mockContext(tempDir)
  )
  const result = JSON.parse(raw)

  expect(result.metadata.success).toBe(false)
  expect(result.metadata.errorCode).toBe("TEXT_NOT_FOUND")
})

test("edit_spec errors when old_text matches multiple locations", async () => {
  await mkdir(join(tempDir, ".opencode/plans"), { recursive: true })
  await writeFile(join(tempDir, ".opencode/plans", "feature-spec.md"), "repeat\nrepeat\n")

  const toolDef = createEditSpecTool()
  const raw = await toolDef.execute(
    { filename: "feature-spec.md", old_text: "repeat", new_text: "once" },
    mockContext(tempDir)
  )
  const result = JSON.parse(raw)

  expect(result.metadata.success).toBe(false)
  expect(result.metadata.errorCode).toBe("AMBIGUOUS_MATCH")
})

test("edit_plan allows empty new_text for deletion", async () => {
  await mkdir(join(tempDir, ".opencode/plans"), { recursive: true })
  await writeFile(join(tempDir, ".opencode/plans", "feature-plan.md"), "keep\nremove me\nkeep\n")

  const toolDef = createEditPlanTool()
  const raw = await toolDef.execute(
    { filename: "feature-plan.md", old_text: "remove me\n", new_text: "" },
    mockContext(tempDir)
  )
  const result = JSON.parse(raw)

  expect(result.metadata.success).toBe(true)
  const updated = await readFile(join(tempDir, ".opencode/plans", "feature-plan.md"), "utf8")
  expect(updated).toBe("keep\nkeep\n")
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/artifacts.test.ts
```
Expected: FAIL — edit tool factories not found, write outputs missing nudges

- [ ] **Step 3: Extract a shared `editArtifact()` helper and update write tools**

In `src/tools/artifacts.ts`, keep the existing `result()`, `errorResult()`, `validateFilename()`, and `resolvePlanPath()` helpers. Add exact-match editing logic just below them:

```ts
async function editArtifact(
  directory: string,
  filename: string,
  filenameRegex: RegExp,
  kind: "spec" | "plan",
  oldText: string,
  newText: string,
  reviewNudge: string
): Promise<string> {
  const validationError = validateFilename(filename, filenameRegex, kind)
  if (validationError) return validationError

  if (!oldText) {
    return errorResult(`Invalid ${kind} edit`, "old_text must be non-empty.", "EMPTY_OLD_TEXT")
  }

  const filePath = resolvePlanPath(directory, filename)
  const content = await readFile(filePath, "utf-8")

  // Exact byte-for-byte substring matching only.
  // Do not normalize newlines or trim whitespace.
  let count = 0
  let start = 0
  while (true) {
    const index = content.indexOf(oldText, start)
    if (index === -1) break
    count += 1
    start = index + oldText.length
  }

  if (count === 0) {
    return errorResult(`Text not found in ${filename}`, "old_text not found in file", "TEXT_NOT_FOUND")
  }

  if (count > 1) {
    return errorResult(
      `Ambiguous edit in ${filename}`,
      `old_text matches ${count} locations — be more specific`,
      "AMBIGUOUS_MATCH"
    )
  }

  // newText may be empty, which allows deletions.
  const updated = content.replace(oldText, newText)
  await writeFile(filePath, updated, "utf-8")

  return result({
    title: `Edited ${filename}`,
    output: `Successfully edited ${filename} in ${PLANS_DIR}/\n\n${reviewNudge}`,
    metadata: { success: true, filename, bytes: updated.length },
  })
}
```

Then update the existing write tools so their `output` includes the review nudge string:

```ts
output: `Successfully wrote ${args.filename} to ${PLANS_DIR}/\n\nSpec written. Call 'review_spec' to review it.`
```

and

```ts
output: `Successfully wrote ${args.filename} to ${PLANS_DIR}/\n\nPlan written. Call 'review_plan' to review it.`
```

- [ ] **Step 4: Add `createEditSpecTool()` and `createEditPlanTool()`**

Append to `src/tools/artifacts.ts`:

```ts
export function createEditSpecTool() {
  return tool({
    description: "Apply an exact one-match search-and-replace edit to a spec artifact file.",
    args: {
      filename: tool.schema.string().describe("Spec filename ending with -spec.md."),
      old_text: tool.schema.string().describe("Exact text to find."),
      new_text: tool.schema.string().describe("Replacement text. May be empty to delete the match."),
    },
    async execute(args, context) {
      context.metadata({ title: `Editing ${args.filename}` })
      try {
        return await editArtifact(
          context.directory,
          args.filename,
          SPEC_FILENAME_REGEX,
          "spec",
          args.old_text,
          args.new_text,
          "Spec edited. Call 'review_spec' to review the changes."
        )
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

export function createEditPlanTool() {
  return tool({
    description: "Apply an exact one-match search-and-replace edit to a plan artifact file.",
    args: {
      filename: tool.schema.string().describe("Plan filename ending with -plan.md."),
      old_text: tool.schema.string().describe("Exact text to find."),
      new_text: tool.schema.string().describe("Replacement text. May be empty to delete the match."),
    },
    async execute(args, context) {
      context.metadata({ title: `Editing ${args.filename}` })
      try {
        return await editArtifact(
          context.directory,
          args.filename,
          PLAN_FILENAME_REGEX,
          "plan",
          args.old_text,
          args.new_text,
          "Plan edited. Call 'review_plan' to review the changes."
        )
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
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test tests/artifacts.test.ts
```
Expected: All existing artifact tests plus the new nudge/edit tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/artifacts.ts tests/artifacts.test.ts
git commit -m "feat: add artifact edit tools and review nudges"
```

---

### Task 7: Update `src/tools/wrappers.ts` — template adoption for existing wrappers and chunked plan review

**Files:**
- Modify: `src/tools/wrappers.ts`
- Modify: `tests/wrappers.test.ts`

- [ ] **Step 1: Add failing tests for explore/research/review wrapper template filling and chunk extraction**

Append to `tests/wrappers.test.ts`:

```ts
import {
  createExploreTool,
  createResearchTool,
  createReviewSpecTool,
  createReviewPlanTool,
  createInvestigateTool,
} from "../src/tools/wrappers"

test("explore prepends EXPLORE_TEMPLATE to the dispatched prompt", async () => {
  const client = mockClient()
  const toolDef = createExploreTool(client)
  await toolDef.execute({ prompt: "find bootstrap logic" }, mockContext(tempDir))

  const payload = client.session.prompt.mock.calls[0][0]
  expect(payload.body.parts[0].prompt).toContain("Explore the codebase")
  expect(payload.body.parts[0].prompt).toContain("find bootstrap logic")
  expect(payload.body.parts[0].agent).toBe("workflow-explore")
})

test("research prepends RESEARCH_TEMPLATE to the dispatched prompt", async () => {
  const client = mockClient()
  const toolDef = createResearchTool(client)
  await toolDef.execute({ prompt: "find opencode permission docs" }, mockContext(tempDir))

  const payload = client.session.prompt.mock.calls[0][0]
  expect(payload.body.parts[0].prompt).toContain("Research the topic")
  expect(payload.body.parts[0].prompt).toContain("find opencode permission docs")
  expect(payload.body.parts[0].agent).toBe("workflow-research")
})

test("review_spec fills the spec document reviewer template", async () => {
  const client = mockClient()
  const toolDef = createReviewSpecTool(client)
  await toolDef.execute({ filename: "feature-spec.md" }, mockContext(tempDir))

  const dispatched = client.session.prompt.mock.calls[0][0].body.parts[0].prompt
  expect(dispatched).toContain("feature-spec.md")
  expect(dispatched).toContain("Completeness")
})

test("review_plan extracts and sends only the requested chunk", async () => {
  await mkdir(join(tempDir, ".opencode/plans"), { recursive: true })
  await writeFile(
    join(tempDir, ".opencode/plans", "feature-plan.md"),
    [
      "# Plan",
      "",
      "## Chunk 1: Foundation",
      "A",
      "",
      "## Chunk 2: Tools",
      "B",
      "",
      "## Chunk 3: Integration",
      "C",
    ].join("\n")
  )

  const client = mockClient()
  const toolDef = createReviewPlanTool(client)
  await toolDef.execute(
    { filename: "feature-plan.md", spec_filename: "feature-spec.md", chunk: 2 },
    mockContext(tempDir)
  )

  const dispatched = client.session.prompt.mock.calls[0][0].body.parts[0].prompt
  expect(dispatched).toContain("feature-plan.md")
  expect(dispatched).toContain("feature-spec.md")
  expect(dispatched).toContain("## Chunk 2: Tools")
  expect(dispatched).not.toContain("## Chunk 1: Foundation")
  expect(dispatched).not.toContain("## Chunk 3: Integration")
})

test("review_plan returns CHUNK_NOT_FOUND when the requested chunk header is missing", async () => {
  await mkdir(join(tempDir, ".opencode/plans"), { recursive: true })
  await writeFile(join(tempDir, ".opencode/plans", "feature-plan.md"), "# Plan\n")

  const client = mockClient()
  const toolDef = createReviewPlanTool(client)
  const raw = await toolDef.execute(
    { filename: "feature-plan.md", chunk: 2 },
    mockContext(tempDir)
  )
  const result = JSON.parse(raw)

  expect(result.metadata.queued).toBe(false)
  expect(result.metadata.errorCode).toBe("CHUNK_NOT_FOUND")
  expect(result.output).toContain("Chunk 2")
})

test("investigate prepends investigate framing and uses workflow-explore", async () => {
  const client = mockClient()
  const toolDef = createInvestigateTool(client)
  await toolDef.execute({ prompt: "why is bootstrap failing?" }, mockContext(tempDir))

  const payload = client.session.prompt.mock.calls[0][0]
  expect(payload.body.parts[0].prompt).toContain("Investigate and debug")
  expect(payload.body.parts[0].prompt).toContain("why is bootstrap failing?")
  expect(payload.body.parts[0].agent).toBe("workflow-explore")
})
```

Also add validation/error tests for:
- invalid `review_spec` filename
- invalid `review_plan` filename
- `review_plan` with non-positive chunk

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/wrappers.test.ts
```
Expected: FAIL — current wrappers still pass prompts through verbatim and do not support chunk extraction

- [ ] **Step 3: Add prompt/template imports and chunk extraction helper**

At the top of `src/tools/wrappers.ts`, add imports for prompt constants and file IO used for chunk extraction:

```ts
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { PLAN_FILENAME_REGEX, PLANS_DIR, SPEC_FILENAME_REGEX } from "../constants"
import {
  fillTemplate,
  EXPLORE_TEMPLATE,
  RESEARCH_TEMPLATE,
  INVESTIGATE_TEMPLATE,
  SPEC_DOCUMENT_REVIEWER_TEMPLATE,
  PLAN_DOCUMENT_REVIEWER_TEMPLATE,
} from "../prompts"
```

Then add a helper near the shared validation functions:

```ts
function extractPlanChunk(planText: string, chunkNumber: number): string | null {
  const lines = planText.split("\n")
  const startIndex = lines.findIndex((line) => line.startsWith(`## Chunk ${chunkNumber}:`))
  if (startIndex === -1) return null

  let endIndex = lines.length
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (/^## Chunk \d+:/.test(lines[i])) {
      endIndex = i
      break
    }
  }

  return lines.slice(startIndex, endIndex).join("\n")
}
```

- [ ] **Step 4: Update the existing wrappers and add `createInvestigateTool()`**

Change `createExploreTool()` and `createResearchTool()` so they prepend the appropriate template:

```ts
const prompt = `${EXPLORE_TEMPLATE}${args.prompt.trim()}`
```

and

```ts
const prompt = `${RESEARCH_TEMPLATE}${args.prompt.trim()}`
```

Update `createReviewSpecTool()` so it uses:

```ts
const reviewPrompt = [
  fillTemplate(SPEC_DOCUMENT_REVIEWER_TEMPLATE, {
    SPEC_FILE_PATH: args.filename,
  }),
  args.prompt ? `\n## Specific Focus\n\n${args.prompt.trim()}` : "",
].filter(Boolean).join("\n")
```

Update `createReviewPlanTool()` to accept:

```ts
args: {
  filename: tool.schema.string().describe("Plan filename to review."),
  spec_filename: tool.schema.string().optional().describe("Optional spec filename for reference."),
  chunk: tool.schema.number().optional().describe("Optional chunk number from ## Chunk N: headings."),
  prompt: tool.schema.string().optional().describe("Optional review focus."),
}
```

In execute:
1. validate `filename`
2. if `chunk` exists, require `Number.isInteger(args.chunk) && args.chunk > 0`
3. read full plan text from `join(context.directory, PLANS_DIR, args.filename)`
4. set `planContent = args.chunk ? extractPlanChunk(planText, args.chunk) : planText`
5. if chunk requested and missing, return:

```ts
return errorResult(
  `Chunk ${args.chunk} not found`,
  `Plan file "${args.filename}" does not contain a header matching "## Chunk ${args.chunk}:".`,
  "CHUNK_NOT_FOUND"
)
```

6. build prompt with `fillTemplate(PLAN_DOCUMENT_REVIEWER_TEMPLATE, { PLAN_FILE_PATH: args.filename, SPEC_FILE_PATH: args.spec_filename ?? "not specified" })`
7. append `## Plan Content` followed by `planContent`
8. append optional `## Specific Focus`

Then append the new `createInvestigateTool()` that prepends `INVESTIGATE_TEMPLATE` and dispatches to `workflow-explore`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test tests/wrappers.test.ts
```
Expected: Existing wrapper tests plus new template/chunk/investigate tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/wrappers.ts tests/wrappers.test.ts
git commit -m "feat: adopt templates for wrapper tools and chunked plan review"
```

---

### Task 8: Update `src/tools/wrappers.ts` — programmer template dispatch and new compliance/code-review tools

**Files:**
- Modify: `src/tools/wrappers.ts`
- Modify: `tests/wrappers.test.ts`

- [ ] **Step 1: Add failing tests for programmer state/git integration and new review tools**

Append to `tests/wrappers.test.ts`:

```ts
import {
  createProgrammerTool,
  createVerifySpecComplianceTool,
  createCodeReviewTool,
} from "../src/tools/wrappers"

test("programmer fills template and records lastBaseSha before dispatch", async () => {
  const client = mockClient()
  const getHeadSha = mock(async () => "1234567890abcdef1234567890abcdef12345678")
  const updateState = mock(() => {})
  const toolDef = createProgrammerTool(client, { getHeadSha, updateState })

  await toolDef.execute(
    {
      task_name: "Add prompt constants",
      prompt: "### Task 1\nImplement prompt constants",
      context: "This is the first task in Chunk 1",
    },
    mockContext(tempDir)
  )

  expect(updateState).toHaveBeenCalledWith({
    lastBaseSha: "1234567890abcdef1234567890abcdef12345678",
  })

  const dispatched = client.session.prompt.mock.calls[0][0].body.parts[0].prompt
  expect(dispatched).toContain("Implement prompt constants")
  expect(dispatched).toContain("This is the first task in Chunk 1")
  expect(dispatched).toContain(tempDir)
})

test("verify_spec_compliance fills requirements and report placeholders", async () => {
  const client = mockClient()
  const toolDef = createVerifySpecComplianceTool(client)
  await toolDef.execute(
    { requirements: "Must add bash tool", report: "Added bash tool and tests" },
    mockContext(tempDir)
  )

  const dispatched = client.session.prompt.mock.calls[0][0].body.parts[0].prompt
  expect(dispatched).toContain("Must add bash tool")
  expect(dispatched).toContain("Added bash tool and tests")
})

test("code_review falls back to state lastBaseSha and current HEAD", async () => {
  const client = mockClient()
  const getState = mock(() => ({ phase: "implement", lastBaseSha: "base-sha" }))
  const getHeadSha = mock(async () => "head-sha")
  const toolDef = createCodeReviewTool(client, { getState, getHeadSha })

  await toolDef.execute({ description: "Implemented tool registration" }, mockContext(tempDir))

  const dispatched = client.session.prompt.mock.calls[0][0].body.parts[0].prompt
  expect(dispatched).toContain("base-sha")
  expect(dispatched).toContain("head-sha")
  expect(dispatched).toContain("Implemented tool registration")
})

test("code_review errors when no explicit or stored base SHA is available", async () => {
  const client = mockClient()
  const getState = mock(() => ({ phase: "implement", lastBaseSha: null }))
  const getHeadSha = mock(async () => "head-sha")
  const toolDef = createCodeReviewTool(client, { getState, getHeadSha })

  const raw = await toolDef.execute({ description: "Implemented tool registration" }, mockContext(tempDir))
  const result = JSON.parse(raw)

  expect(result.metadata.queued).toBe(false)
  expect(result.metadata.errorCode).toBe("MISSING_BASE_SHA")
})
```

Also add validation/error tests for:
- empty `programmer.prompt`
- empty `programmer.task_name`
- empty `verify_spec_compliance.requirements`
- empty `verify_spec_compliance.report`

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/wrappers.test.ts
```
Expected: FAIL — programmer still accepts old args and the new factories do not exist

- [ ] **Step 3: Update `createProgrammerTool()` with dependency injection and new args**

In `src/tools/wrappers.ts`, add imports:

```ts
import {
  fillTemplate,
  PROGRAMMER_TEMPLATE,
  SPEC_REVIEWER_TEMPLATE,
  CODE_QUALITY_REVIEWER_TEMPLATE,
} from "../prompts"
import { getHeadSha as defaultGetHeadSha } from "../git"
import { getState as defaultGetState, updateState as defaultUpdateState } from "../state"
```

Then replace the existing programmer factory with:

```ts
export function createProgrammerTool(
  client: any,
  deps: {
    getHeadSha?: typeof defaultGetHeadSha
    updateState?: typeof defaultUpdateState
  } = {}
) {
  const getHeadSha = deps.getHeadSha ?? defaultGetHeadSha
  const updateState = deps.updateState ?? defaultUpdateState

  return tool({
    description: "Dispatch an implementation task to the workflow-programmer subagent using the programmer template.",
    args: {
      task_name: tool.schema.string().describe("Short task name for the implementation subtask."),
      prompt: tool.schema.string().describe("Full task text to implement."),
      context: tool.schema.string().optional().describe("Optional scene-setting context."),
    },
    async execute(args, context) {
      const promptError = validatePrompt(args.prompt)
      if (promptError) return promptError
      const taskNameError = validatePrompt(args.task_name)
      if (taskNameError) {
        return errorResult("Invalid task name", "Task name must be non-empty.", "EMPTY_TASK_NAME")
      }

      const lastBaseSha = await getHeadSha(context.directory)
      updateState({ lastBaseSha })

      const prompt = fillTemplate(PROGRAMMER_TEMPLATE, {
        "task name": args.task_name.trim(),
        "FULL TEXT of task": args.prompt.trim(),
        "Scene-setting context": args.context?.trim() ?? "No additional context provided.",
        directory: context.directory,
      })

      return dispatchSubtask(
        client,
        context.sessionID,
        context.agent,
        "workflow-programmer",
        prompt,
        `Implement: ${args.task_name.trim()}`,
        context.metadata
      )
    },
  })
}
```

- [ ] **Step 4: Add `createVerifySpecComplianceTool()` and `createCodeReviewTool()`**

Append to `src/tools/wrappers.ts`:

```ts
export function createVerifySpecComplianceTool(client: any) {
  return tool({
    description: "Dispatch a spec-compliance review using the reviewer template.",
    args: {
      requirements: tool.schema.string().describe("Full text of the requested requirements."),
      report: tool.schema.string().describe("Implementer report describing what was built."),
    },
    async execute(args, context) {
      const requirementsError = validatePrompt(args.requirements)
      if (requirementsError) {
        return errorResult("Invalid requirements", "Requirements must be non-empty.", "EMPTY_REQUIREMENTS")
      }
      const reportError = validatePrompt(args.report)
      if (reportError) {
        return errorResult("Invalid report", "Report must be non-empty.", "EMPTY_REPORT")
      }

      const prompt = fillTemplate(SPEC_REVIEWER_TEMPLATE, {
        "FULL TEXT of task requirements": args.requirements.trim(),
        "From implementer's report": args.report.trim(),
      })

      return dispatchSubtask(
        client,
        context.sessionID,
        context.agent,
        "workflow-reviewer",
        prompt,
        "Verify spec compliance",
        context.metadata
      )
    },
  })
}

export function createCodeReviewTool(
  client: any,
  deps: {
    getState?: typeof defaultGetState
    getHeadSha?: typeof defaultGetHeadSha
  } = {}
) {
  const getState = deps.getState ?? defaultGetState
  const getHeadSha = deps.getHeadSha ?? defaultGetHeadSha

  return tool({
    description: "Dispatch a code quality review using git SHAs to scope the change.",
    args: {
      description: tool.schema.string().describe("What was implemented."),
      plan_reference: tool.schema.string().optional().describe("Optional plan task reference."),
      base_sha: tool.schema.string().optional().describe("Optional explicit base SHA."),
      head_sha: tool.schema.string().optional().describe("Optional explicit head SHA."),
    },
    async execute(args, context) {
      const descriptionError = validatePrompt(args.description)
      if (descriptionError) {
        return errorResult("Invalid description", "Description must be non-empty.", "EMPTY_DESCRIPTION")
      }

      const state = getState()
      const baseSha = args.base_sha ?? state.lastBaseSha
      if (!baseSha) {
        return errorResult(
          "Missing base SHA",
          "code_review requires base_sha or a previously recorded lastBaseSha.",
          "MISSING_BASE_SHA"
        )
      }

      const headSha = args.head_sha ?? await getHeadSha(context.directory)
      const prompt = fillTemplate(CODE_QUALITY_REVIEWER_TEMPLATE, {
        WHAT_WAS_IMPLEMENTED: args.description.trim(),
        PLAN_OR_REQUIREMENTS: args.plan_reference?.trim() ?? "not specified",
        BASE_SHA: baseSha,
        HEAD_SHA: headSha,
        DESCRIPTION: args.description.trim(),
      })

      return dispatchSubtask(
        client,
        context.sessionID,
        context.agent,
        "workflow-reviewer",
        prompt,
        `Code review: ${args.description.trim().slice(0, 80)}`,
        context.metadata
      )
    },
  })
}
```

- [ ] **Step 5: Audit wrapper callers/tests for the programmer signature change**

Search the repo for `createProgrammerTool(` and `programmer` tool execute calls. Update any affected tests in `tests/index.test.ts`, `tests/wrappers.test.ts`, or helper code so they pass the new `{ task_name, prompt, context? }` shape.

Run:

```bash
grep -R "createProgrammerTool\|programmer" src tests -n
```

Expected: find all direct factory uses and wrapper-tool invocations that need updating.

- [ ] **Step 6: Run tests to verify they pass**

```bash
bun test tests/wrappers.test.ts
```
Expected: All existing wrapper tests plus the new programmer/spec-compliance/code-review tests PASS

- [ ] **Step 7: Run the full suite to catch cross-module fallout**

```bash
bun test
```
Expected: All tests still PASS, including prompts/git/state/constants/bash/artifacts/wrappers

- [ ] **Step 8: Commit**

```bash
git add src/tools/wrappers.ts tests/wrappers.test.ts tests/index.test.ts
git commit -m "feat: add programmer and review wrapper templates"
```

---

## Chunk 3: Integration, Bootstrap, and Docs

### Task 9: Update `src/commands.ts` — skill prompt injection and phase state tracking

**Files:**
- Modify: `src/commands.ts`
- Modify: `tests/commands.test.ts`

- [ ] **Step 1: Add failing tests for skill-derived entry prompts and phase state updates**

In `tests/commands.test.ts`, keep the existing `mockClient()`, bootstrap helpers, and `invokeWorkflowCommand()` helper. Append tests like these:

```ts
import { mock } from "bun:test"
import { createCommandHook } from "../src/commands"

test("brainstorm command injects the brainstorming skill text and user args", async () => {
  const client = mockClient()
  const updateState = mock(() => {})
  const hook = createCommandHook(
    client,
    "/repo",
    mockBootstrapCheck({ status: "ready" }),
    async () => {},
    async () => {},
    updateState
  )

  await invokeWorkflowCommand(hook, {
    command: "brainstorm",
    sessionID: "s1",
    arguments: "prompt injection for workflow plugin",
  })

  const call = client.session.prompt.mock.calls[0][0]
  const text = call.body.parts[0].text
  expect(call.body.agent).toBe("workflow-brainstorm")
  expect(text).toContain("# Brainstorming Ideas Into Designs")
  expect(text).toContain("HARD-GATE")
  expect(text).toContain("The user wants to brainstorm: prompt injection for workflow plugin")
  expect(updateState).toHaveBeenCalledWith({ phase: "brainstorm" })
})

test("plan command injects the writing-plans skill text and user args", async () => {
  const client = mockClient()
  const updateState = mock(() => {})
  const hook = createCommandHook(client, "/repo", mockBootstrapCheck({ status: "ready" }), async () => {}, async () => {}, updateState)

  await invokeWorkflowCommand(hook, {
    command: "plan",
    sessionID: "s1",
    arguments: "prompt-injection-spec.md",
  })

  const text = client.session.prompt.mock.calls[0][0].body.parts[0].text
  expect(text).toContain("# Writing Plans")
  expect(text).toContain("subagent-driven-development")
  expect(text).toContain("The user wants to plan: prompt-injection-spec.md")
  expect(updateState).toHaveBeenCalledWith({ phase: "plan" })
})

test("implement command injects the subagent-driven-development skill text and user args", async () => {
  const client = mockClient()
  const updateState = mock(() => {})
  const hook = createCommandHook(client, "/repo", mockBootstrapCheck({ status: "ready" }), async () => {}, async () => {}, updateState)

  await invokeWorkflowCommand(hook, {
    command: "implement",
    sessionID: "s1",
    arguments: "prompt-injection-plan.md",
  })

  const text = client.session.prompt.mock.calls[0][0].body.parts[0].text
  expect(text).toContain("# Subagent-Driven Development")
  expect(text).toContain("spec compliance")
  expect(text).toContain("code quality")
  expect(text).toContain("The user wants to implement: prompt-injection-plan.md")
  expect(updateState).toHaveBeenCalledWith({ phase: "implement" })
})

test("empty brainstorm args still inject skill text and brainstorm fallback question", async () => {
  const client = mockClient()
  const updateState = mock(() => {})
  const hook = createCommandHook(client, "/repo", mockBootstrapCheck({ status: "ready" }), async () => {}, async () => {}, updateState)

  await invokeWorkflowCommand(hook, {
    command: "brainstorm",
    sessionID: "s1",
    arguments: "",
  })

  const text = client.session.prompt.mock.calls[0][0].body.parts[0].text
  expect(text).toContain("# Brainstorming Ideas Into Designs")
  expect(text).toContain("Ask the user what they'd like to brainstorm.")
})

test("empty plan args still inject skill text and plan fallback question", async () => {
  const client = mockClient()
  const updateState = mock(() => {})
  const hook = createCommandHook(client, "/repo", mockBootstrapCheck({ status: "ready" }), async () => {}, async () => {}, updateState)

  await invokeWorkflowCommand(hook, {
    command: "plan",
    sessionID: "s1",
    arguments: "",
  })

  const text = client.session.prompt.mock.calls[0][0].body.parts[0].text
  expect(text).toContain("# Writing Plans")
  expect(text).toContain("Ask the user which spec to create a plan for.")
})

test("empty implement args still inject skill text and implement fallback question", async () => {
  const client = mockClient()
  const updateState = mock(() => {})
  const hook = createCommandHook(client, "/repo", mockBootstrapCheck({ status: "ready" }), async () => {}, async () => {}, updateState)

  await invokeWorkflowCommand(hook, {
    command: "implement",
    sessionID: "s1",
    arguments: "",
  })

  const text = client.session.prompt.mock.calls[0][0].body.parts[0].text
  expect(text).toContain("# Subagent-Driven Development")
  expect(text).toContain("Ask the user which plan to implement.")
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/commands.test.ts
```
Expected: FAIL — current prompts are still generic and no phase state update occurs

- [ ] **Step 3: Replace generic `ENTRY_PROMPTS` with imported phase prompt constants**

At the top of `src/commands.ts`, add imports:

```ts
import {
  BRAINSTORM_PHASE_PROMPT,
  PLAN_PHASE_PROMPT,
  IMPLEMENT_PHASE_PROMPT,
} from "./prompts"
import { updateState as defaultUpdateState } from "./state"
```

Replace the generic `ENTRY_PROMPTS` map with:

```ts
const ENTRY_PROMPTS: Record<PhaseName, (args: string) => string> = {
  brainstorm: (args) =>
    [
      BRAINSTORM_PHASE_PROMPT,
      "",
      "---",
      "",
      args
        ? `The user wants to brainstorm: ${args}`
        : "Ask the user what they'd like to brainstorm.",
    ].join("\n"),

  plan: (args) =>
    [
      PLAN_PHASE_PROMPT,
      "",
      "---",
      "",
      args
        ? `The user wants to plan: ${args}`
        : "Ask the user which spec to create a plan for.",
    ].join("\n"),

  implement: (args) =>
    [
      IMPLEMENT_PHASE_PROMPT,
      "",
      "---",
      "",
      args
        ? `The user wants to implement: ${args}`
        : "Ask the user which plan to implement.",
    ].join("\n"),
}
```

- [ ] **Step 4: Add optional `updateStateFn` dependency to `createCommandHook()` and set phase before dispatch**

Update the factory signature:

```ts
export function createCommandHook(
  client: any,
  projectDir: string,
  checkBootstrapFn: (dir: string) => Promise<BootstrapStatus> = defaultCheckBootstrap,
  runBootstrapFn: (dir: string) => Promise<void> = defaultRunBootstrap,
  forceBootstrapFn: (dir: string) => Promise<void> = defaultForceBootstrap,
  updateStateFn: typeof defaultUpdateState = defaultUpdateState
) {
```

Then, after bootstrap passes and before `client.session.prompt(...)`, add:

```ts
updateStateFn({ phase })
```

Keep the existing `workflow-init` behavior unchanged.

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test tests/commands.test.ts
```
Expected: Existing command tests plus the new prompt-injection/state tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands.ts tests/commands.test.ts
git commit -m "feat: inject skill prompts into workflow commands"
```

---

### Task 10: Update `src/agents.ts` — explicit workflow tool allow/deny frontmatter and refreshed agent guidance

**Files:**
- Modify: `src/agents.ts`
- Modify: `tests/bootstrap.test.ts`

- [ ] **Step 1: Add failing tests for exact matrix-derived workflow tool permissions on primary agents**

In `tests/bootstrap.test.ts`, keep the existing bootstrap lifecycle tests. Add explicit matrix-driven permission assertions so the tests verify the **full** workflow tool set for each primary agent, not just a representative subset:

```ts
function expectPermissionLines(content: string, expected: string[]) {
  for (const line of expected) {
    expect(content).toContain(line)
  }
}

test("workflow-brainstorm frontmatter matches brainstorm phase tool matrix", () => {
  const content = getAgentContent("workflow-brainstorm")
  expectPermissionLines(content, [
    "explore: allow",
    "research: allow",
    "read_spec: allow",
    "write_spec: allow",
    "edit_spec: allow",
    "review_spec: allow",
    "programmer: deny",
    "review_plan: deny",
    "read_plan: deny",
    "write_plan: deny",
    "edit_plan: deny",
    "verify_spec_compliance: deny",
    "code_review: deny",
    "investigate: deny",
    "bash: deny",
  ])
})

test("workflow-plan frontmatter matches plan phase tool matrix", () => {
  const content = getAgentContent("workflow-plan")
  expectPermissionLines(content, [
    "explore: allow",
    "research: allow",
    "read_spec: allow",
    "read_plan: allow",
    "write_plan: allow",
    "edit_plan: allow",
    "review_plan: allow",
    "programmer: deny",
    "write_spec: deny",
    "edit_spec: deny",
    "review_spec: deny",
    "verify_spec_compliance: deny",
    "code_review: deny",
    "investigate: deny",
    "bash: deny",
  ])
})

test("workflow-implement frontmatter matches implement phase tool matrix", () => {
  const content = getAgentContent("workflow-implement")
  expectPermissionLines(content, [
    "explore: allow",
    "research: allow",
    "programmer: allow",
    "read_plan: allow",
    "review_plan: allow",
    "read_spec: allow",
    "review_spec: allow",
    "verify_spec_compliance: allow",
    "code_review: allow",
    "investigate: allow",
    "bash: allow",
    "write_spec: deny",
    "edit_spec: deny",
    "write_plan: deny",
    "edit_plan: deny",
  ])
})

test("primary agent guidance mentions the newly available workflow tools", () => {
  const brainstorm = getAgentContent("workflow-brainstorm")
  const plan = getAgentContent("workflow-plan")
  const implement = getAgentContent("workflow-implement")

  expect(brainstorm).toContain("edit_spec")
  expect(plan).toContain("edit_plan")
  expect(implement).toContain("verify_spec_compliance")
  expect(implement).toContain("code_review")
  expect(implement).toContain("investigate")
  expect(implement).toContain("bash")
  expect(implement).toContain("review_spec")
  expect(implement).toContain("read_spec")
})
```

These tests should live alongside the existing frontmatter/content assertions, not replace them.

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/bootstrap.test.ts
```
Expected: FAIL — primary agent frontmatter still uses deny-only workflow tool shaping

- [ ] **Step 3: Update the 3 primary agent markdown strings in `src/agents.ts`**

For each primary agent:
- keep the existing built-in denies (`read`, `edit`, `glob`, `grep`, `bash` where appropriate, `task`, `lsp`, `webfetch`, `websearch`, `mcp_*`)
- add explicit `allow` entries for phase-allowed workflow tools from `PHASE_TOOL_MATRIX`
- add explicit `deny` entries for every phase-hidden workflow tool

Use this pattern for `workflow-brainstorm`:

```yaml
permission:
  read: deny
  edit: deny
  glob: deny
  grep: deny
  bash: deny
  task: deny
  lsp: deny
  webfetch: deny
  websearch: deny
  explore: allow
  research: allow
  read_spec: allow
  write_spec: allow
  edit_spec: allow
  review_spec: allow
  programmer: deny
  review_plan: deny
  read_plan: deny
  write_plan: deny
  edit_plan: deny
  verify_spec_compliance: deny
  code_review: deny
  investigate: deny
  mcp_*: deny
```

For `workflow-plan`, swap in the plan-phase allow/deny set, including `bash: deny`.

For `workflow-implement`, explicitly allow:
- `explore`
- `research`
- `programmer`
- `read_plan`
- `review_plan`
- `read_spec`
- `review_spec`
- `verify_spec_compliance`
- `code_review`
- `investigate`
- `bash`

and explicitly deny:
- `write_spec`
- `edit_spec`
- `write_plan`
- `edit_plan`

Then refresh the markdown body text so the primary agents mention the new tools that now exist:
- brainstorm: include `edit_spec`
- plan: include `edit_plan`
- implement: include `verify_spec_compliance`, `code_review`, `investigate`, `bash`, `review_spec`, `read_spec`

Keep the 4 subagents unchanged aside from any minimal wording tweaks required by updated tests.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/bootstrap.test.ts
```
Expected: Existing bootstrap tests plus the new frontmatter/content assertions PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents.ts tests/bootstrap.test.ts
git commit -m "feat: add explicit workflow tool permissions to primary agents"
```

---

### Task 11: Update `src/index.ts` — register all 15 workflow tools and wire command-hook state updates

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Add failing tests for the expanded tool set**

In `tests/index.test.ts`, replace the current “9 workflow tools” assertion with:

```ts
test("createPlugin registers all 15 workflow tools", async () => {
  const hooks = await createPlugin(mockPluginInput())
  const toolNames = Object.keys(hooks.tool).sort()

  expect(toolNames).toEqual([
    "bash",
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
```

Keep the existing assertions that `hooks.config` and `hooks["command.execute.before"]` are present.

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/index.test.ts
```
Expected: FAIL — createPlugin still returns only 9 tools

- [ ] **Step 3: Import the new tools and the real state updater in `src/index.ts`**

Update imports:

```ts
import {
  createReadSpecTool,
  createWriteSpecTool,
  createReadPlanTool,
  createWritePlanTool,
  createEditSpecTool,
  createEditPlanTool,
} from "./tools/artifacts"
import {
  createExploreTool,
  createResearchTool,
  createProgrammerTool,
  createReviewSpecTool,
  createReviewPlanTool,
  createVerifySpecComplianceTool,
  createCodeReviewTool,
  createInvestigateTool,
} from "./tools/wrappers"
import { createBashTool } from "./tools/bash"
import { updateState } from "./state"
```

- [ ] **Step 4: Expand the `tool` map and wire `updateState` into `createCommandHook()`**

Inside `createPlugin()`, replace the current hook return with:

```ts
return {
  tool: {
    read_spec: createReadSpecTool(),
    write_spec: createWriteSpecTool(),
    edit_spec: createEditSpecTool(),
    read_plan: createReadPlanTool(),
    write_plan: createWritePlanTool(),
    edit_plan: createEditPlanTool(),
    explore: createExploreTool(client),
    research: createResearchTool(client),
    programmer: createProgrammerTool(client),
    review_spec: createReviewSpecTool(client),
    review_plan: createReviewPlanTool(client),
    verify_spec_compliance: createVerifySpecComplianceTool(client),
    code_review: createCodeReviewTool(client),
    investigate: createInvestigateTool(client),
    bash: createBashTool(),
  },
  config: createConfigHook(),
  "command.execute.before": createCommandHook(client, directory, undefined, undefined, undefined, updateState),
}
```

**Wiring note:** `createProgrammerTool(client)` and `createCodeReviewTool(client)` may keep using their default module-level deps in production. Only the command hook must be explicitly wired with the real `updateState` dependency because Task 9 changed its signature.

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test tests/index.test.ts
```
Expected: Existing index tests plus the new 15-tool assertion PASS

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: register all workflow tools in plugin entrypoint"
```

---

### Task 12: Update `README.md` and run final integration verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add README setup section for global workflow-tool deny rules**

Append a setup section to `README.md` with the exact snippet from the spec:

```md
## Optional: Hide workflow tools from non-workflow agents

If you want these workflow-specific tools to be unavailable by default outside the workflow agents created by this plugin, add the following to your global or project `opencode.jsonc`:

```jsonc
{
  "permission": {
    "read_spec": "deny",
    "write_spec": "deny",
    "edit_spec": "deny",
    "read_plan": "deny",
    "write_plan": "deny",
    "edit_plan": "deny",
    "review_spec": "deny",
    "review_plan": "deny",
    "explore": "deny",
    "research": "deny",
    "programmer": "deny",
    "verify_spec_compliance": "deny",
    "code_review": "deny",
    "investigate": "deny"
  }
}
```

The workflow agents generated by this plugin explicitly `allow` the tools they need, so those agent-specific rules override the global deny list. `bash` is not included here because it uses opencode's built-in permission handling.
```

- [ ] **Step 2: Run targeted Chunk 3 verification tests**

```bash
bun test tests/commands.test.ts tests/index.test.ts tests/bootstrap.test.ts
```
Expected: PASS — command prompt injection, tool registration, bootstrap/agent-content coverage all pass together.

- [ ] **Step 3: Run the full cross-chunk verification suite**

```bash
bun test
```
Expected: PASS — this is the global gate that also verifies the non-Chunk-3 behavior: template filling, review nudges, artifact edit behavior, state flow, git SHA handling, and wrapper tool coverage.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add workflow tool permission setup guidance"
```

- [ ] **Step 5: Final plan sanity check before execution handoff**

Manually verify the finished plan still satisfies the spec’s acceptance criteria:
- phase prompt injection covered
- template filling covered
- all 6 new tools covered (`edit_spec`, `edit_plan`, `verify_spec_compliance`, `code_review`, `investigate`, `bash`)
- state management covered
- review nudges covered
- explicit frontmatter permissions covered
- README deny snippet covered
- targeted Chunk 3 verification included
- full-suite cross-chunk verification included

If anything is missing, patch the plan before handing off.

- [ ] **Step 6: Commit any final plan-only corrections if needed**

```bash
git add .opencode/plans/prompt-injection-plan.md
git commit -m "docs: finalize prompt injection implementation plan"
```

---

Plan complete and saved to `.opencode/plans/prompt-injection-plan.md`. Ready to execute?