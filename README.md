# opencode-workflow

A plugin for [opencode](https://opencode.ai) that adds a structured brainstorm-plan-implement workflow with specialized agents and artifact management.

## Overview

This plugin introduces a three-phase development workflow, each backed by a dedicated agent with scoped tool access:

1. **Brainstorm** (`/brainstorm`) — Explore ideas, gather context, and refine requirements into a spec
2. **Plan** (`/plan`) — Turn an approved spec into a detailed, step-by-step implementation plan
3. **Implement** (`/implement`) — Execute against an approved plan using focused subagents

Each phase has its own primary agent with restricted tool permissions, ensuring agents stay focused on their role. Supporting subagents handle codebase exploration, research, implementation, and review tasks.

## Agents

| Agent | Mode | Role |
|---|---|---|
| `workflow-brainstorm` | primary | Requirements gathering and spec authoring |
| `workflow-plan` | primary | Implementation planning from specs |
| `workflow-implement` | primary | Plan execution via subagent delegation |
| `workflow-explore` | subagent | Read-only codebase inspection |
| `workflow-research` | subagent | Documentation and technical research |
| `workflow-programmer` | subagent | Focused coding tasks |
| `workflow-reviewer` | subagent | Structured artifact review |

Agent files are auto-generated in `.opencode/agents/` on first use. Run `/workflow-init` to regenerate them after plugin updates.

## Tools

### Artifact tools
- `read_spec` / `write_spec` — Read and write spec files in `.opencode/plans/`
- `read_plan` / `write_plan` — Read and write plan files in `.opencode/plans/`

### Wrapper tools (dispatch subagent tasks)
- `explore` — Dispatch codebase exploration to `workflow-explore`
- `research` — Dispatch investigation to `workflow-research`
- `programmer` — Dispatch implementation to `workflow-programmer`
- `review_spec` — Dispatch spec review to `workflow-reviewer`
- `review_plan` — Dispatch plan review to `workflow-reviewer`

## Installation

Add the plugin to your `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file://path/to/opencode-workflow/src/index.ts"
  ]
}
```

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Type check
bun x tsc --noEmit
```

## Artifact conventions

- Spec files: `<name>-spec.md` in `.opencode/plans/`
- Plan files: `<name>-plan.md` in `.opencode/plans/`
- Filenames must start with a lowercase alphanumeric character and contain only `[a-z0-9._-]`
