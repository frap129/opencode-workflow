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
export const PHASE_TOOL_MATRIX: Record<PhaseName, { allowed: string[]; hidden: string[] }> = {
  brainstorm: {
    allowed: ["explore", "research", "read_spec", "write_spec", "edit_spec", "review_spec"],
    hidden: [
      "programmer", "review_plan", "read_plan", "write_plan", "edit_plan",
      "verify_spec_compliance", "code_review", "investigate",
    ],
  },
  plan: {
    allowed: ["explore", "research", "read_spec", "read_plan", "write_plan", "edit_plan", "review_plan"],
    hidden: [
      "programmer", "write_spec", "edit_spec", "review_spec",
      "verify_spec_compliance", "code_review", "investigate",
    ],
  },
  implement: {
    allowed: [
      "explore", "research", "programmer", "read_plan", "review_plan",
      "read_spec", "review_spec", "verify_spec_compliance", "code_review",
      "investigate",
    ],
    hidden: ["write_spec", "edit_spec", "write_plan", "edit_plan"],
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
