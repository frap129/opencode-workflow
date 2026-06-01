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
  test("brainstorm phase allows 6 tools and hides 8", () => {
    const { allowed, hidden } = PHASE_TOOL_MATRIX.brainstorm
    expect(allowed).toEqual([
      "explore", "research", "read_spec", "write_spec", "edit_spec", "review_spec",
    ])
    expect(hidden).toEqual([
      "programmer", "review_plan", "read_plan", "write_plan", "edit_plan",
      "verify_spec_compliance", "code_review", "investigate",
    ])
  })

  test("plan phase allows 7 tools and hides 7", () => {
    const { allowed, hidden } = PHASE_TOOL_MATRIX.plan
    expect(allowed).toEqual([
      "explore", "research", "read_spec", "read_plan", "write_plan", "edit_plan", "review_plan",
    ])
    expect(hidden).toEqual([
      "programmer", "write_spec", "edit_spec", "review_spec",
      "verify_spec_compliance", "code_review", "investigate",
    ])
  })

  test("implement phase allows 10 tools and hides 4", () => {
    const { allowed, hidden } = PHASE_TOOL_MATRIX.implement
    expect(allowed).toEqual([
      "explore", "research", "programmer", "read_plan", "review_plan",
      "read_spec", "review_spec", "verify_spec_compliance", "code_review",
      "investigate",
    ])
    expect(hidden).toEqual([
      "write_spec", "edit_spec", "write_plan", "edit_plan",
    ])
  })

  test("all 14 tools appear in every phase (allowed + hidden)", () => {
    const ALL_TOOLS = [
      "explore", "research", "read_spec", "write_spec", "edit_spec", "review_spec",
      "read_plan", "write_plan", "edit_plan", "review_plan",
      "programmer", "verify_spec_compliance", "code_review", "investigate",
    ]

    for (const phase of ["brainstorm", "plan", "implement"] as const) {
      const { allowed, hidden } = PHASE_TOOL_MATRIX[phase]
      expect([...allowed, ...hidden].sort()).toEqual([...ALL_TOOLS].sort())
    }
  })
})
