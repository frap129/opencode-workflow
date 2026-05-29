# Workflow Plugin MVP Spec

## Summary

Build an opencode plugin that recreates the core pi-workflow experience for three phases: `brainstorm`, `plan`, and `implement`.

The MVP will:
- provide plugin-owned slash commands for the three phases
- generate required workflow agents on first run
- expose explicit workflow wrapper tools
- store workflow artifacts in `.opencode/plans/`
- dispatch subagents through opencode's native task/subtask path so child sessions remain visible in the UI

The MVP will not include UI widgets, persistent workflow mode state, or toggle-style phase switching.

For clarity, "no persistent workflow mode state" means the plugin will not keep its own hidden phase state machine. Phase changes happen through normal agent selection in the current session.

## Goals

1. Give users a phase-oriented workflow entrypoint through `/brainstorm`, `/plan`, and `/implement`.
2. Keep all phase work in the current session unless a native subtask creates a child session.
3. Use dedicated generated agents to shape tool access and workflow behavior for each phase.
4. Provide explicit wrapper tools similar to pi-workflow's main actions.
5. Ensure workflow-created specs and plans are constrained to `.opencode/plans/`.
6. Preserve native task UX by routing wrapper tools into real subtask/task execution.

## Non-Goals

1. UI widgets or footer/status surfaces.
2. Phase toggling or "run command again to disable mode" behavior.
3. Hidden mutable workflow state shared across commands.
4. Automatic regeneration or overwriting of user-edited generated agent files.
5. Full parity with every pi-workflow feature.

## User Experience

### Phase entry

Users invoke one of three commands:
- `/brainstorm`
- `/plan`
- `/implement`

Each command:
1. runs in the current session
2. sets the matching phase agent as the active agent for the session
3. submits the phase's initial prompt/instructions under that phase agent
4. relies on that agent's permissions and prompt to shape behavior
5. leaves that phase agent as the active agent for subsequent turns in the session until the user runs another phase command or manually switches agents

Running the same command again later is treated as a fresh invocation in the same session. The plugin does not maintain toggle state.

### Workflow artifacts

Workflow specs and plans are created and edited only under:

```text
.opencode/plans/
```

The workflow tool surface includes scoped read/write tools for this directory so agents can create and refine specs and plans without receiving general file-write access through the workflow abstractions.

Directory lifecycle rules:
- bootstrap creates `.opencode/` and `.opencode/agents/` if they are absent
- bootstrap also creates `.opencode/plans/` if it is absent
- write tools may also create `.opencode/plans/` on first write if needed
- read tools return not-found if the target file does not exist

### Subtasks

When a workflow wrapper tool needs focused work from a subagent, it enqueues a native subtask in the current session. This produces a real child session and native task record in the UI.

## Architecture

The MVP consists of four layers.

### 1. Command layer

The plugin registers three hardcoded slash commands in JS/TS:
- `brainstorm`
- `plan`
- `implement`

Responsibilities:
- map each command to a specific phase agent
- build the initial phase prompt
- ensure bootstrap has completed before phase execution
- set the current session's active agent to the selected phase agent for subsequent turns, using opencode's normal agent-selection behavior
- submit the phase entry prompt into the current session after the agent switch

This is not treated as plugin-managed toggle state. It is simply normal session agent selection.

### 2. Agent bootstrap layer

On first run, the plugin checks whether required workflow agents exist. If all required workflow agent files are absent, it treats the project as unbootstrapped and generates agent markdown files into `.opencode/agents/`.

These generated files are user-owned after creation:
- the plugin does not silently overwrite them
- if all required files are absent, the plugin may bootstrap them on first run
- if only some required files are missing later, commands fail with a clear recovery message instead of regenerating a partial set

Required generated agents:
- `workflow-brainstorm`
- `workflow-plan`
- `workflow-implement`
- `workflow-explore`
- `workflow-research`
- `workflow-programmer`
- `workflow-reviewer`

Canonical generated filenames:
- `.opencode/agents/workflow-brainstorm.md`
- `.opencode/agents/workflow-plan.md`
- `.opencode/agents/workflow-implement.md`
- `.opencode/agents/workflow-explore.md`
- `.opencode/agents/workflow-research.md`
- `.opencode/agents/workflow-programmer.md`
- `.opencode/agents/workflow-reviewer.md`

Minimum generated subagent contracts:

| Generated subagent | Responsibility | Expected tool posture |
|---|---|---|
| `workflow-explore` | inspect the local codebase and report findings without making edits | allow read-oriented tools and constrained inspection tools; deny code-editing and shell mutation tools |
| `workflow-research` | gather broader technical context and synthesize findings for the parent workflow | allow read-oriented and research-oriented tools; deny code-editing tools |
| `workflow-programmer` | perform focused implementation work delegated from the parent workflow | allow normal implementation tools, including edit and shell tools, within normal opencode permissions |
| `workflow-reviewer` | review a named artifact and return structured critique | allow artifact read tools plus read-oriented inspection tools; deny edit/write tools |

### 3. Workflow tool layer

The plugin registers explicit workflow tools modeled after pi-workflow's main actions.

Initial MVP tool set:
- `explore`
- `research`
- `programmer`
- `review_spec`
- `review_plan`
- `read_spec`
- `write_spec`
- `read_plan`
- `write_plan`

Tool responsibilities:
- wrapper tools translate a high-level workflow action into a concrete subtask prompt
- read/write tools enforce scoped artifact access inside `.opencode/plans/`

### 4. Hook/runtime layer

The plugin provides runtime behavior that supports the workflow:
- first-run bootstrap checks
- phase-specific system guidance injection
- optional tool definition shaping so the active phase presents the right workflow framing to the model
- lightweight validation and recovery messaging

The runtime layer should stay thin in the MVP. Most behavioral enforcement should live in generated agents plus explicit wrapper tools. Tool definition shaping is an implementation detail, not a hard MVP requirement.

## Agent Model

### Phase agents

Each phase uses a dedicated agent with:
- a phase-specific system prompt
- permission rules tuned to that phase
- tool guidance that matches intended workflow behavior

These agents provide the primary phase boundaries for the MVP. The design intentionally prefers agent-level boundaries over hidden runtime state.

### Supporting generated subagents

The generated non-phase agents are part of the product contract, not just an implementation detail.

- `workflow-explore` must be read-only in practice and optimized for codebase inspection.
- `workflow-research` must be investigation-oriented and non-mutating.
- `workflow-programmer` must be implementation-capable.
- `workflow-reviewer` must be review-oriented and non-mutating.

The implementation plan may refine exact prompt wording and permission syntax, but it must preserve these behavioral boundaries.

### Permission strategy

Tool availability is enforced primarily through dedicated phase agents and their permission rules, with prompt guidance as a secondary mechanism.

This means:
- brainstorm emphasizes exploration, research, user clarification, and spec-writing tools
- plan emphasizes plan authoring/review and limited supporting tools
- implement emphasizes execution-oriented tools and review helpers

For MVP compliance, tools listed as hidden/denied for a phase in the matrix below must not be exposed in the model-visible tool list for that phase agent, and tools listed as available must be exposed.

### Minimum phase tool matrix

The following matrix defines the intended minimum workflow surface for each phase agent.

| Phase agent | Workflow tools that should be available | Workflow tools that should be hidden/denied | Built-in tool posture |
|---|---|---|---|
| `workflow-brainstorm` | `explore`, `research`, `read_spec`, `write_spec`, `review_spec` | `programmer`, `review_plan`, `read_plan`, `write_plan` | read-oriented tools allowed; general code-editing and shell execution denied |
| `workflow-plan` | `explore`, `research`, `read_spec`, `read_plan`, `write_plan`, `review_plan` | `programmer`, `write_spec`, `review_spec` | read-oriented tools allowed; general code-editing and shell execution denied |
| `workflow-implement` | `explore`, `research`, `programmer`, `read_plan`, `review_plan` | `write_spec`, `write_plan` by default | normal implementation tools allowed, including code-editing and shell tools, plus workflow wrappers |

The phase matrix is the baseline for planning and tests. Exact permission syntax is left to implementation, but the visible tool results must match the matrix.

## Command Behavior

### `/brainstorm`

Purpose:
- turn ideas into a reviewed spec

Expected behavior:
- select the `workflow-brainstorm` phase agent
- encourage question-driven discovery and design refinement
- favor spec-related artifact tools and review helpers

### `/plan`

Purpose:
- turn an approved spec into an implementation plan

Expected behavior:
- select the `workflow-plan` phase agent
- focus on sequencing, execution boundaries, and verification strategy
- favor plan-related artifact tools and review helpers

### `/implement`

Purpose:
- execute against an existing approved plan

Expected behavior:
- select the `workflow-implement` phase agent
- use workflow wrapper tools and normal coding tools to carry out planned work
- use child sessions for focused subagent work via native subtasks

## Native Subtask Dispatch

### Requirement

Wrapper tools must use opencode's native subtask/task execution path so subagent sessions remain visible in the UI.

### Mechanism

When a wrapper tool is called, it:
1. builds a concrete subtask prompt from the workflow action
2. appends a `subtask` part to the current session
3. submits it with `noReply: true`
4. returns immediately

The session loop then processes that subtask through opencode's normal native task flow, creating:
- a native task tool record
- a real child session
- normal session hierarchy and drill-down behavior

### Explicit constraint

Wrapper tools must not create fake fallback sessions or parallel custom subagent UIs. If native subtask enqueue fails, the tool returns an error and stops.

## Workflow Tool Design

### Wrapper tools

Wrapper tools provide stable, phase-friendly actions instead of forcing the model to craft every `task` call by hand.

For each wrapper tool, the plugin defines:
- purpose
- required arguments
- target subagent type
- prompt template rules

Wrapper tool mapping for the MVP:

| Tool | Target subagent | Purpose |
|---|---|---|
| `explore` | `workflow-explore` | focused codebase exploration |
| `research` | `workflow-research` | broader investigation or documentation gathering |
| `programmer` | `workflow-programmer` | execution-oriented implementation assistance |
| `review_spec` | `workflow-reviewer` | structured review of a spec artifact |
| `review_plan` | `workflow-reviewer` | structured review of a plan artifact |

Wrapper tools should be thin. Their job is to standardize prompt construction and route work into native subtasks.

Wrapper tool contract for the MVP:

| Tool | Inputs | Validation | Success result | Failure result |
|---|---|---|---|---|
| `explore` | `prompt: string` | prompt must be non-empty | returns structured result indicating a subtask was queued for `workflow-explore` | returns structured error; no subtask queued |
| `research` | `prompt: string` | prompt must be non-empty | returns structured result indicating a subtask was queued for `workflow-research` | returns structured error; no subtask queued |
| `programmer` | `prompt: string` | prompt must be non-empty | returns structured result indicating a subtask was queued for `workflow-programmer` | returns structured error; no subtask queued |
| `review_spec` | `filename: string`, `prompt?: string` | filename must satisfy spec filename rules | returns structured result indicating a subtask was queued for `workflow-reviewer` against the named spec | returns structured error; no subtask queued |
| `review_plan` | `filename: string`, `prompt?: string` | filename must satisfy plan filename rules | returns structured result indicating a subtask was queued for `workflow-reviewer` against the named plan | returns structured error; no subtask queued |

All wrapper tools return a structured tool result with:
- `title`
- `output`
- `metadata`

Success metadata must include at least:
- `queued: true`
- `targetAgent`
- `description`

Failure metadata must include at least:
- `queued: false`
- `errorCode`

Artifact-review handoff rules:
- `review_spec` passes the target spec filename in the queued subtask prompt and targets `workflow-reviewer`
- `review_plan` passes the target plan filename in the queued subtask prompt and targets `workflow-reviewer`
- `workflow-reviewer` is granted read access to the corresponding artifact tool (`read_spec` or `read_plan`) so it can load the latest artifact contents directly during the review flow
- the review path does not rely on stale prompt snapshots when current file contents can be read from `.opencode/plans/`

### Artifact tools

The artifact tools are scoped adapters over `.opencode/plans/`.

Behavioral requirements:
- reject path traversal
- reject absolute paths outside the plans directory
- reject malformed filenames
- only read/write files under `.opencode/plans/`
- do not allow subdirectories in the MVP

Artifact tool contract for the MVP:

| Tool | Input | Valid filename rule | Behavior |
|---|---|---|---|
| `read_spec` | `filename` | simple basename matching `^[a-z0-9][a-z0-9._-]*-spec\.md$` | read full file contents |
| `write_spec` | `filename`, `content` | simple basename matching `^[a-z0-9][a-z0-9._-]*-spec\.md$` | create or fully replace file contents |
| `read_plan` | `filename` | simple basename matching `^[a-z0-9][a-z0-9._-]*-plan\.md$` | read full file contents |
| `write_plan` | `filename`, `content` | simple basename matching `^[a-z0-9][a-z0-9._-]*-plan\.md$` | create or fully replace file contents |

For MVP simplicity, artifact tools operate only on top-level markdown files in `.opencode/plans/`.

Artifact tools return a structured result with:
- `title`
- `output`
- optional `metadata`

## Bootstrap Behavior

### First-run check

Before executing workflow behavior, the plugin checks for required generated agents.

If all required generated agents are missing, it performs bootstrap by generating the expected files under `.opencode/agents/`.

Bootstrap also ensures the `.opencode/plans/` directory exists.

If only a subset is missing, the plugin treats the workflow installation as broken and fails with a recovery message instead of regenerating selectively.

### Failure model

Bootstrap is all-or-nothing for the MVP:
- if generation fails, the plugin reports a clear error
- it must not silently proceed with a partially bootstrapped workflow

### Ownership model

After generation:
- files are considered user-owned
- the plugin does not auto-update them on version change
- the plugin may surface actionable errors if required files are deleted later

## Data Flow

### 1. Bootstrap flow

1. user invokes a workflow command
2. plugin checks for required generated agents
3. if all are missing, plugin generates them
4. if only some are missing, plugin fails with a recovery error
5. command continues only after bootstrap succeeds

### 2. Phase entry flow

1. user invokes `/brainstorm`, `/plan`, or `/implement`
2. plugin resolves the matching phase agent
3. plugin sets that phase agent as the active agent for the current session
4. plugin submits the phase entry prompt to the current session under that phase agent
5. agent begins operating with that phase's prompt and permissions

### 3. Wrapper tool flow

1. phase agent calls a wrapper tool
2. wrapper tool builds a concrete subtask prompt
3. wrapper tool appends a native `subtask` part with `noReply: true`
4. wrapper tool returns immediately
5. session loop processes the subtask through native task execution
6. child session appears in the UI as normal

### 4. Artifact flow

1. agent calls `read_*` or `write_*` workflow tool
2. tool validates path confinement to `.opencode/plans/`
3. tool performs read or write
4. tool returns structured success or failure output

## Error Handling

The MVP must fail clearly rather than masking workflow errors.

### Command-level errors

- partially missing bootstrap artifacts: explain what is missing, list the missing generated files when known, and tell the user how to recover
- unknown or invalid generated agent references: stop and report directly
- bootstrap failure: stop command execution and return a clear failure message

### Wrapper-tool errors

- invalid arguments: return actionable validation errors
- native subtask enqueue failure: return structured error and do not simulate success
- invalid target subagent configuration: fail explicitly

### Artifact-tool errors

- escaping path attempts: reject with a clear security error
- file not found: return a standard not-found error
- malformed path input: reject before touching the filesystem

## Security and Boundaries

1. Artifact tools are confined to `.opencode/plans/`.
2. Wrapper tools do not execute arbitrary shell commands on behalf of the user.
3. The plugin does not maintain hidden phase state beyond generated files and created artifacts.
4. Generated agents are trusted inputs only at creation time; after that, the plugin must tolerate user edits and report breakage rather than rewriting them.

## Testing Strategy

The MVP test suite should cover the following.

### Bootstrap tests

- generates required agents on first run
- does not overwrite existing user-edited generated agents
- fails cleanly on partial bootstrap errors

### Command tests

- each command selects the expected phase agent
- each command stays in the current session
- re-running a phase command behaves as a fresh invocation without toggle state

### Wrapper-tool tests

- each wrapper tool builds the expected native subtask request
- wrapper tools submit subtasks with `noReply: true`
- resulting execution produces native task-backed child sessions

### Artifact-tool tests

- read/write succeeds inside `.opencode/plans/`
- path traversal is rejected
- absolute paths outside the scope are rejected
- malformed filenames are rejected

### Permission-shaping tests

- for each phase agent, the model-visible workflow tool list matches the minimum phase tool matrix
- brainstorm and plan deny general code-editing and shell execution tools
- implement allows normal implementation tools plus the required workflow wrappers

## Acceptance Criteria

The MVP is complete when all of the following are true:

1. The plugin provides working `/brainstorm`, `/plan`, and `/implement` commands.
2. First run generates required workflow agents under `.opencode/agents/`.
3. Generated agent files are not auto-overwritten on later runs.
4. Workflow tools exist for the agreed MVP workflow actions.
   - `explore`
   - `research`
   - `programmer`
   - `review_spec`
   - `review_plan`
   - `read_spec`
   - `write_spec`
   - `read_plan`
   - `write_plan`
5. Wrapper tools route work through native subtask/task behavior and produce real child sessions.
6. Workflow artifact tools only operate inside `.opencode/plans/`.
7. Re-running a phase command works as a fresh invocation in the current session.
8. UI widgets remain out of scope for this MVP.

## Implementation Notes for Later Planning

This spec intentionally leaves detailed file/module layout, exact generated agent contents, and exact slash-command registration API shape to the implementation plan. Those are execution details, not unresolved product requirements.
