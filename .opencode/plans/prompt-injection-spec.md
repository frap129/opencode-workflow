# Prompt Injection & Missing Tools Enhancement Spec

## Overview

Enhance the opencode-workflow plugin to:
1. Inject skill-derived prompt text into phase entry prompts (replacing generic messages)
2. Fill prompt templates with placeholders before dispatching subagents (instead of passing prompts verbatim)
3. Add missing implement-phase tools: `verify_spec_compliance`, `code_review`, `investigate`, `bash`
4. Add `edit_spec` and `edit_plan` artifact tools for targeted search-and-replace edits
5. Add lightweight state tracking for git SHAs (needed by code_review)
6. Explicit tool permissions in workflow agent frontmatter for isolation from non-workflow agents

This adapts the proven patterns from the Pi workflow plugin to the opencode plugin architecture.

## Architecture

### Prompt Storage

Follow the existing `agents.ts` pattern: **inline prompt content as TypeScript string constants** in `src/prompts.ts`. This avoids runtime file-loading path issues (the plugin may be bundled or run from a different cwd).

Two categories of prompts:

**Phase skill prompts** (injected as phase entry context):
- `BRAINSTORM_PHASE_PROMPT` — derived from the `brainstorming` skill
- `PLAN_PHASE_PROMPT` — derived from the `writing-plans` skill
- `IMPLEMENT_PHASE_PROMPT` — derived from the `subagent-driven-development` skill

**Subagent dispatch templates** (filled with placeholders before dispatch):
- `PROGRAMMER_TEMPLATE` — programmer dispatch template
- `EXPLORE_TEMPLATE` — explore agent prompt (prepended to user query)
- `RESEARCH_TEMPLATE` — research agent prompt (prepended to user query)
- `INVESTIGATE_TEMPLATE` — investigate agent prompt (prepended to user query)
- `SPEC_REVIEWER_TEMPLATE` — spec compliance review template (implement phase)
- `CODE_QUALITY_REVIEWER_TEMPLATE` — code quality review template (implement phase)
- `SPEC_DOCUMENT_REVIEWER_TEMPLATE` — spec document review template (brainstorm phase)
- `PLAN_DOCUMENT_REVIEWER_TEMPLATE` — plan document review template (plan phase)

All stored as exported `const` strings in `src/prompts.ts`.

### Placeholder Filling

A `fillTemplate(template: string, replacements: Record<string, string>): string` utility in `src/prompts.ts`:
- Replaces `[PLACEHOLDER_NAME]` tokens with provided values
- Leaves unfilled placeholders as-is and logs a warning to stderr (non-fatal)
- Returns the filled string

### Git Utility

A `getHeadSha(cwd: string): Promise<string>` function in `src/git.ts`:
- Runs `git rev-parse HEAD` via `Bun.spawn(["git", "rev-parse", "HEAD"], { cwd })`
- Returns trimmed stdout
- Throws on non-zero exit code
- Used by `programmer` tool (to record base SHA) and `code_review` tool (to get current HEAD)

### Review Nudges

All artifact mutation tools (`write_spec`, `edit_spec`, `write_plan`, `edit_plan`) include a **review nudge** in their tool response — a reminder directing the agent to call the appropriate review tool next.

**Nudge messages:**
- `write_spec` / `edit_spec` → `"Spec written. Call 'review_spec' to review it."`  or `"Spec edited. Call 'review_spec' to review the changes."`
- `write_plan` / `edit_plan` → `"Plan written. Call 'review_plan' to review it."` or `"Plan edited. Call 'review_plan' to review the changes."`

These nudges are appended to the structured tool result output so the agent sees them as part of the tool response. This ensures the review loop is consistently triggered without relying on the agent's memory of the workflow.

### Tool Permission Isolation

Plugin-registered tools are globally visible by default. To prevent workflow tools from bleeding into non-workflow agents:

**Strategy:** Workflow agents explicitly `allow` their phase-appropriate tools in frontmatter. The user adds global `deny` rules in their `opencode.jsonc` to block these tools for all other agents. Since opencode resolves permissions with last-match-wins and agent-level rules override global config, the explicit `allow` in workflow agents takes precedence over the global `deny`.

**Workflow agent frontmatter** — each workflow agent adds `allow` entries for the tools it needs (per the PHASE_TOOL_MATRIX). Tools not in the allowed list for that phase are left unmentioned (inheriting the global deny).

**README documentation** — include a snippet for the user's global `opencode.jsonc`:

```jsonc
{
  "permission": {
    // Deny workflow plugin tools globally — workflow agents override with explicit allow
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

Note: `bash` is excluded from this list since opencode has a built-in `bash` permission that the user likely already manages separately.

---

## Change 1: Phase Entry Prompt Injection

### Current Behavior
`src/commands.ts` `ENTRY_PROMPTS` returns generic strings like:
```
"You are now in brainstorm mode. Your role is to explore ideas..."
```

### New Behavior
Phase entry prompts inject the full skill text from the corresponding prompt constant, followed by any user-provided args.

**Brainstorm phase entry:**
```
{BRAINSTORM_PHASE_PROMPT}

---

The user wants to brainstorm: {user args}
```
(If no user args: append "Ask the user what they'd like to brainstorm.")

**Plan phase entry:**
```
{PLAN_PHASE_PROMPT}

---

The user wants to plan: {user args}
```
(If no user args: append "Ask the user which spec to create a plan for.")

**Implement phase entry:**
```
{IMPLEMENT_PHASE_PROMPT}

---

The user wants to implement: {user args}
```
(If no user args: append "Ask the user which plan to implement.")

### Files Changed
- `src/commands.ts` — `ENTRY_PROMPTS` functions import prompt constants from `src/prompts.ts`
- `src/prompts.ts` — new module with all prompt constants and `fillTemplate()`

---

## Change 2: Subagent Prompt Template Filling

### Current Behavior
- `explore`, `research`, `programmer` pass user prompt verbatim
- `review_spec`, `review_plan` compose a basic multi-line instruction

### New Behavior

**explore tool:**
- Prepend `EXPLORE_TEMPLATE` to user's query
- Dispatch to `workflow-explore` agent

**research tool:**
- Prepend `RESEARCH_TEMPLATE` to user's query
- Dispatch to `workflow-research` agent

**programmer tool:**
- Fill `PROGRAMMER_TEMPLATE` with placeholders:
  - `[task name]` — from tool arg `task_name` (new required param) or derived from description
  - `[FULL TEXT of task]` — from tool arg `prompt` (the full task text)
  - `[Scene-setting context]` — from tool arg `context` (new optional param)
  - `[directory]` — project working directory
- Record current git HEAD as `lastBaseSha` in state before dispatch (via `getHeadSha()`)
- Dispatch to `workflow-programmer` agent

**review_spec (document review):**
- Fill `SPEC_DOCUMENT_REVIEWER_TEMPLATE` with:
  - `[SPEC_FILE_PATH]` — from tool arg `filename`
- Dispatch to `workflow-reviewer` agent

**review_plan (document review):**
- Fill `PLAN_DOCUMENT_REVIEWER_TEMPLATE` with:
  - `[PLAN_FILE_PATH]` — from tool arg `filename`
  - `[SPEC_FILE_PATH]` — from tool arg `spec_filename` (new optional param; if not provided, use "not specified")
  - `[CHUNK]` — from tool arg `chunk` (integer, new optional param; refers to `## Chunk N:` section headers in the plan document). When provided, only the matching chunk section is extracted from the plan and sent to the reviewer. When omitted, the full plan text is sent for review.
- Dispatch to `workflow-reviewer` agent

### Files Changed
- `src/tools/wrappers.ts` — all 5 existing tool factories updated to use templates
- `src/prompts.ts` — prompt constants and `fillTemplate()` utility

---

## Change 3: New Implement-Phase Tools

### 3a. `verify_spec_compliance` Tool

**Purpose:** Verify programmer's implementation matches task requirements (spec compliance review).

Note: Named `verify_spec_compliance` (not `spec_review`) to avoid confusion with the existing `review_spec` tool which reviews spec *documents*.

**Parameters:**
- `requirements` (string, required) — full text of what was requested
- `report` (string, required) — implementer's self-report of what they built

**Behavior:**
- Fill `SPEC_REVIEWER_TEMPLATE` with:
  - `[FULL TEXT of task requirements]` — from `requirements`
  - `[From implementer's report]` — from `report`
- Dispatch to `workflow-reviewer` agent

### 3b. `code_review` Tool

**Purpose:** Review code quality of implementation changes.

**Parameters:**
- `description` (string, required) — what was implemented
- `plan_reference` (string, optional) — task reference from plan
- `base_sha` (string, optional) — git SHA before changes (defaults to `lastBaseSha` from state)
- `head_sha` (string, optional) — git SHA after changes (defaults to current HEAD via `getHeadSha()`)

**Behavior:**
- Fill `CODE_QUALITY_REVIEWER_TEMPLATE` with:
  - `[WHAT_WAS_IMPLEMENTED]` — from `description`
  - `[PLAN_OR_REQUIREMENTS]` — from `plan_reference`
  - `[BASE_SHA]` — from `base_sha` or state's `lastBaseSha`
  - `[HEAD_SHA]` — from `head_sha` or `getHeadSha(projectDir)`
  - `[DESCRIPTION]` — from `description`
- Dispatch to `workflow-reviewer` agent

### 3c. `investigate` Tool

**Purpose:** Dispatch a focused investigation subagent to debug or understand specific code issues.

**Parameters:**
- `prompt` (string, required) — what to investigate

**Behavior:**
- Prepend `INVESTIGATE_TEMPLATE` to user's query
- Dispatch to `workflow-explore` agent

**Design note:** Reuses the `workflow-explore` agent because investigation is fundamentally read-only codebase inspection — the same permission model applies. The prompt template provides the different framing (debugging focus vs. general exploration). If the explore agent's system prompt conflicts with investigation framing, the template prompt takes precedence since it's the most recent instruction.

### 3d. `bash` Tool

**Purpose:** Give the implement-phase orchestrator limited shell access for verification (running tests, checking git status, etc.).

**Parameters:**
- `command` (string, required) — shell command to execute
- `description` (string, optional) — what this command does

**Behavior:**
- Execute via `Bun.spawn(["sh", "-c", command], { cwd: projectDir })`
- Capture stdout and stderr separately
- Timeout: 120 seconds (kills process on timeout)
- Output truncation: 50KB per stream (stdout/stderr); if truncated, append `\n... [truncated at 50KB]`
- Return structured result: `{ exitCode, stdout, stderr, timedOut }`
- No stdin support

**Security model:** The bash tool relies on opencode's existing permission system for command approval. It is a plugin-registered tool (not a subagent wrapper) that executes directly in the plugin process. Phase-gating (hidden in brainstorm/plan via PHASE_TOOL_MATRIX) provides an additional layer of restriction.

### Files Changed
- `src/tools/wrappers.ts` — add `createVerifySpecComplianceTool`, `createCodeReviewTool`, `createInvestigateTool`
- `src/tools/bash.ts` — new file for `createBashTool`
- `src/git.ts` — new file with `getHeadSha()` utility
- `src/index.ts` — register new tools in the `tool` hook
- `src/constants.ts` — update `PHASE_TOOL_MATRIX` to include new tools

---

## Change 4: Edit Artifact Tools

### 4a. `edit_spec` Tool

**Purpose:** Apply targeted search-and-replace edits to spec files without rewriting the entire file.

**Parameters:**
- `filename` (string, required) — spec filename (must match `SPEC_FILENAME_REGEX`)
- `old_text` (string, required) — exact text to find in the file
- `new_text` (string, required) — replacement text

**Behavior:**
- Validate filename against `SPEC_FILENAME_REGEX`
- Read file from `.opencode/plans/{filename}`
- Find `old_text` in file content (exact string match)
- If not found: return error with message "old_text not found in file"
- If found multiple times: return error with message "old_text matches N locations — be more specific"
- If found exactly once: replace with `new_text`, write file back
- Return structured result with success status, updated file size, and **review nudge**: `"Spec edited. Call 'review_spec' to review the changes."`

### 4b. `edit_plan` Tool

**Purpose:** Apply targeted search-and-replace edits to plan files without rewriting the entire file.

**Parameters:**
- `filename` (string, required) — plan filename (must match `PLAN_FILENAME_REGEX`)
- `old_text` (string, required) — exact text to find in the file
- `new_text` (string, required) — replacement text

**Behavior:**
- Identical to `edit_spec` but validates against `PLAN_FILENAME_REGEX`
- Same search-and-replace semantics (exact match, must be unique)
- Review nudge: `"Plan edited. Call 'review_plan' to review the changes."`

### Implementation Note
Both tools share the same core logic. Extract a shared `editArtifact(plansDir: string, filename: string, filenameRegex: RegExp, oldText: string, newText: string)` helper in `src/tools/artifacts.ts` alongside the existing `read_spec`/`write_spec`/`read_plan`/`write_plan` tools. The `filenameRegex` parameter is used for filename validation only — the search-and-replace itself uses exact string matching on `oldText`.

### Review Nudges in Existing Artifact Tools

The existing `write_spec` and `write_plan` tools must also be updated to include review nudges in their responses:
- `write_spec` → append `"Spec written. Call 'review_spec' to review it."`
- `write_plan` → append `"Plan written. Call 'review_plan' to review it."`

### Files Changed
- `src/tools/artifacts.ts` — add `createEditSpecTool`, `createEditPlanTool`, shared `editArtifact` helper, and update `write_spec`/`write_plan` to include review nudges
- `src/index.ts` — register new tools in the `tool` hook
- `src/constants.ts` — add tool names, update `PHASE_TOOL_MATRIX`

---

## Change 5: State Management

### State Shape
```typescript
interface WorkflowState {
  phase: Phase | null;
  lastBaseSha: string | null;
}
```

### Storage Mechanism
- State stored as a module-level object in `src/state.ts`
- This is intentionally plugin-instance scoped (one plugin instance per opencode session)
- Not persisted across restarts — in-memory only
- Exposed via `getState()` / `updateState(partial)` functions
- Passed to tool factories via dependency injection (allowing test mocking)

### State Transitions
- Phase entry commands update `phase`
- `programmer` tool records git HEAD into `lastBaseSha` before dispatch
- `code_review` tool reads `lastBaseSha` for diff range

### Files Changed
- `src/state.ts` — new module with state management functions
- `src/index.ts` — initialize state, pass to tool/command factories

---

## Change 6: Constants & Tool Matrix Updates

### New Tool Names
Add to tool name constants:
- `verify_spec_compliance`
- `code_review`
- `investigate`
- `bash`
- `edit_spec`
- `edit_plan`

### Updated PHASE_TOOL_MATRIX

| Phase | Allowed | Hidden |
|---|---|---|
| **brainstorm** | `explore`, `research`, `read_spec`, `write_spec`, `edit_spec`, `review_spec` | `programmer`, `review_plan`, `read_plan`, `write_plan`, `edit_plan`, `verify_spec_compliance`, `code_review`, `investigate`, `bash` |
| **plan** | `explore`, `research`, `read_spec`, `read_plan`, `write_plan`, `edit_plan`, `review_plan` | `programmer`, `write_spec`, `edit_spec`, `review_spec`, `verify_spec_compliance`, `code_review`, `investigate`, `bash` |
| **implement** | `explore`, `research`, `programmer`, `read_plan`, `review_plan`, `read_spec`, `review_spec`, `verify_spec_compliance`, `code_review`, `investigate`, `bash` | `write_spec`, `edit_spec`, `write_plan`, `edit_plan` |

Notes:
- `edit_spec` allowed in brainstorm (alongside `write_spec`) — for targeted fixes after review
- `edit_plan` allowed in plan (alongside `write_plan`) — for targeted fixes after review
- `read_spec` added to implement phase (needed for spec compliance review context)
- `review_spec` added to implement phase (implementers may need to re-review spec documents when encountering ambiguity mid-implementation)

### Files Changed
- `src/constants.ts` — add tool names, update matrix

---

## Change 7: Tool Permission Isolation in Agent Frontmatter

### Current Behavior
Workflow agent frontmatter uses a **deny-list** pattern — explicitly denying built-in tools they shouldn't use (e.g., `edit: deny`, `bash: deny`). Plugin-registered workflow tools are not mentioned in permissions, so they inherit whatever the global default is (currently `allow`).

### New Behavior
Workflow agent frontmatter adds **explicit `allow` entries** for each workflow tool the agent needs (per the PHASE_TOOL_MATRIX). This ensures workflow tools work even when globally denied.

**Example — `workflow-brainstorm` frontmatter permissions:**
```yaml
permission:
  # ... existing denies for built-in tools ...
  # Workflow tools — explicitly allow per phase matrix
  explore: allow
  research: allow
  read_spec: allow
  write_spec: allow
  edit_spec: allow
  review_spec: allow
  # Phase-hidden tools — deny so they don't appear even within workflow
  programmer: deny
  read_plan: deny
  write_plan: deny
  edit_plan: deny
  review_plan: deny
  verify_spec_compliance: deny
  code_review: deny
  investigate: deny
```

**Example — `workflow-plan` frontmatter permissions:**
```yaml
permission:
  # ... existing denies for built-in tools ...
  # Workflow tools — explicitly allow per phase matrix
  explore: allow
  research: allow
  read_spec: allow
  read_plan: allow
  write_plan: allow
  edit_plan: allow
  review_plan: allow
  # Phase-hidden tools — deny
  programmer: deny
  write_spec: deny
  edit_spec: deny
  review_spec: deny
  verify_spec_compliance: deny
  code_review: deny
  investigate: deny
```

**Example — `workflow-implement` frontmatter permissions:**
```yaml
permission:
  # ... existing denies for built-in tools ...
  # Workflow tools — explicitly allow per phase matrix
  explore: allow
  research: allow
  programmer: allow
  read_plan: allow
  review_plan: allow
  read_spec: allow
  review_spec: allow
  verify_spec_compliance: allow
  code_review: allow
  investigate: allow
  bash: allow
  # Phase-hidden tools — deny
  write_spec: deny
  edit_spec: deny
  write_plan: deny
  edit_plan: deny
```

**Subagent permissions** — subagents (`workflow-explore`, `workflow-research`, `workflow-programmer`, `workflow-reviewer`) do NOT need workflow tool allows. They are dispatched by wrapper tools and don't call workflow tools themselves. Their existing minimal permission blocks remain unchanged.

### README Documentation

Add a setup section to README with the global deny snippet:

```jsonc
// Add to your opencode.jsonc (global or project-level)
{
  "permission": {
    // Deny workflow plugin tools globally — workflow agents override with explicit allow
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

### Files Changed
- `src/agents.ts` — update all 3 primary agent markdown to include explicit `allow`/`deny` for all 15 workflow tools per PHASE_TOOL_MATRIX
- `README.md` — add setup section with global deny snippet

---

## Phase Prompt Content Guidelines

### BRAINSTORM_PHASE_PROMPT
Derived from the `brainstorming` skill. Key content:
- Collaborative design process
- Ask clarifying questions one at a time, prefer multiple choice
- Explore project context first
- Propose 2-3 approaches with trade-offs
- Present design in sections, get approval after each
- Write spec to `.opencode/plans/`
- Spec review loop (dispatch reviewer, fix, repeat until approved, max 5 iterations)
- User review gate before proceeding
- Hard gate: no implementation until design approved
- Terminal action: proceed to planning

### PLAN_PHASE_PROMPT
Derived from the `writing-plans` skill. Key content:
- Bite-sized TDD tasks (2-5 min each step)
- File structure mapping before tasks
- Plan document header format (goal, architecture, tech stack)
- Task structure with checkbox syntax, exact file paths, complete code
- Chunk-based review loop (dispatch plan reviewer per chunk)
- Execution handoff: use subagent-driven-development

### IMPLEMENT_PHASE_PROMPT
Derived from the `subagent-driven-development` skill. Key content:
- Fresh programmer subagent per task
- Two-stage review: spec compliance first, then code quality
- Handle 4 programmer statuses (DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, BLOCKED)
- Read plan once, extract all tasks upfront
- Track todos
- Red flags (never skip reviews, never parallel implement, etc.)

---

## Prompt Template Content

Templates are inlined as TypeScript string constants, adapted from the skill prompt template files with placeholders for runtime filling.

### Placeholder Convention
- Phase prompts: no placeholders (injected as-is, with user args appended)
- Subagent templates: `[PLACEHOLDER_NAME]` syntax for text replacement
- Each template constant has a JSDoc comment listing its placeholders

### Unfilled Placeholder Handling
- `fillTemplate()` logs a warning to stderr for each unfilled placeholder
- Unfilled placeholders remain as-is in the output (non-fatal)
- This allows partial filling and makes debugging visible

---

## Testing Strategy

### Unit Tests
- `tests/prompts.test.ts` — `fillTemplate()` placeholder replacement, unfilled placeholder warnings
- `tests/git.test.ts` — `getHeadSha()` success and error cases
- `tests/state.test.ts` — state get/set, SHA tracking
- `tests/bash.test.ts` — bash tool execution, output capture, timeout, truncation
- Update `tests/artifacts.test.ts` — add tests for `edit_spec` and `edit_plan`: successful edit, old_text not found, multiple matches, filename validation; verify review nudges in `write_spec`, `write_plan`, `edit_spec`, `edit_plan` responses
- Update `tests/wrappers.test.ts` — verify templates are filled before dispatch for all tools
- Update `tests/commands.test.ts` — verify skill text injection in entry prompts

### Integration Verification
- Phase entry injects full skill text (not generic message)
- Programmer dispatch fills all template placeholders
- Verify spec compliance dispatch fills requirements + report
- Code review dispatch uses correct git SHAs
- State tracks lastBaseSha across programmer → code_review flow
- Edit tools correctly modify artifact files with search-and-replace
- All artifact mutation tools include review nudges in responses
- Workflow agent frontmatter includes explicit allow/deny for all workflow tools

---

## Acceptance Criteria

1. `/brainstorm`, `/plan`, `/implement` commands inject full skill-derived prompt text
2. `programmer` tool fills template with task name, full text, context, and directory
3. `explore` and `research` tools prepend agent prompt to user query
4. `review_spec` fills spec-document-reviewer template with file path
5. `review_plan` fills plan-document-reviewer template with file path and optional spec/chunk
6. New `verify_spec_compliance` tool dispatches filled spec-compliance template
7. New `code_review` tool dispatches filled code-quality template with git SHAs
8. New `investigate` tool dispatches focused investigation with template prompt
9. New `bash` tool executes shell commands with 120s timeout and 50KB output cap
10. Git HEAD is recorded before programmer dispatch and available for code_review
11. New `edit_spec` tool applies search-and-replace edits to spec files (exact unique match required)
12. New `edit_plan` tool applies search-and-replace edits to plan files (exact unique match required)
13. PHASE_TOOL_MATRIX correctly shows/hides all 15 tools per phase
14. All prompt content inlined as TypeScript constants (no runtime file loading)
15. All artifact mutation tools (`write_spec`, `edit_spec`, `write_plan`, `edit_plan`) include review nudges in their responses
16. All 3 primary workflow agents have explicit `allow`/`deny` for all workflow tools matching PHASE_TOOL_MATRIX
17. README includes global deny snippet for `opencode.jsonc`
18. All existing tests pass; new tests cover new functionality
