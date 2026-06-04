// src/prompts.ts

import BRAINSTORM_PHASE_MD from "./prompts/brainstorm-phase.md" with { type: "text" }
import PLAN_PHASE_MD from "./prompts/plan-phase.md" with { type: "text" }
import IMPLEMENT_PHASE_MD from "./prompts/implement-phase.md" with { type: "text" }
import PROGRAMMER_MD from "./prompts/programmer.md" with { type: "text" }
import EXPLORE_MD from "./prompts/explore.md" with { type: "text" }
import RESEARCH_MD from "./prompts/research.md" with { type: "text" }
import INVESTIGATE_MD from "./prompts/investigate.md" with { type: "text" }
import SPEC_REVIEWER_MD from "./prompts/spec-reviewer.md" with { type: "text" }
import CODE_QUALITY_REVIEWER_MD from "./prompts/code-quality-reviewer.md" with { type: "text" }
import SPEC_DOCUMENT_REVIEWER_MD from "./prompts/spec-document-reviewer.md" with { type: "text" }
import PLAN_DOCUMENT_REVIEWER_MD from "./prompts/plan-document-reviewer.md" with { type: "text" }

/**
 * Replaces [PLACEHOLDER] occurrences in a template string with values from replacements.
 * - Replaces all occurrences of each matched placeholder.
 * - Placeholder names start with a letter followed by any characters except `]`
 *   (e.g. [FOO], [BASE_SHA], [task name], [From implementer's report]).
 * - Leaves unfilled placeholders intact and warns once per unique unfilled placeholder name.
 */
export function fillTemplate(template: string, replacements: Record<string, string>): string {
  const warned = new Set<string>()
  return template.replace(/\[([A-Za-z][^\]]*)\]/g, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(replacements, name)) {
      return replacements[name]
    }
    if (!warned.has(name)) {
      warned.add(name)
      process.stderr.write(`[workflow] Warning: unfilled placeholder [${name}] in template\n`)
    }
    return match
  })
}

// Phase prompt constants (loaded from .md files)

export const BRAINSTORM_PHASE_PROMPT = BRAINSTORM_PHASE_MD.trimEnd()
export const PLAN_PHASE_PROMPT = PLAN_PHASE_MD.trimEnd()
export const IMPLEMENT_PHASE_PROMPT = IMPLEMENT_PHASE_MD.trimEnd()

// Subagent template constants

export const PROGRAMMER_TEMPLATE = PROGRAMMER_MD.trimEnd()
export const EXPLORE_TEMPLATE = EXPLORE_MD
export const RESEARCH_TEMPLATE = RESEARCH_MD
export const INVESTIGATE_TEMPLATE = INVESTIGATE_MD
export const SPEC_REVIEWER_TEMPLATE = SPEC_REVIEWER_MD.trimEnd()
export const CODE_QUALITY_REVIEWER_TEMPLATE = CODE_QUALITY_REVIEWER_MD.trimEnd()
export const SPEC_DOCUMENT_REVIEWER_TEMPLATE = SPEC_DOCUMENT_REVIEWER_MD.trimEnd()
export const PLAN_DOCUMENT_REVIEWER_TEMPLATE = PLAN_DOCUMENT_REVIEWER_MD.trimEnd()
