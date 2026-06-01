// tests/prompts.test.ts
import { describe, expect, test, spyOn } from "bun:test"
import {
  fillTemplate,
  BRAINSTORM_PHASE_PROMPT,
  PLAN_PHASE_PROMPT,
  IMPLEMENT_PHASE_PROMPT,
  PROGRAMMER_TEMPLATE,
  EXPLORE_TEMPLATE,
  RESEARCH_TEMPLATE,
  INVESTIGATE_TEMPLATE,
  SPEC_REVIEWER_TEMPLATE,
  CODE_QUALITY_REVIEWER_TEMPLATE,
  SPEC_DOCUMENT_REVIEWER_TEMPLATE,
  PLAN_DOCUMENT_REVIEWER_TEMPLATE,
} from "../src/prompts"

describe("fillTemplate", () => {
  test("single placeholder", () => {
    expect(fillTemplate("Hello [NAME]", { NAME: "World" })).toBe("Hello World")
  })

  test("multiple placeholders", () => {
    expect(fillTemplate("[A] and [B]", { A: "foo", B: "bar" })).toBe("foo and bar")
  })

  test("repeated placeholder", () => {
    expect(fillTemplate("[A] then [A] again", { A: "x" })).toBe("x then x again")
  })

  test("unfilled placeholder warning", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = fillTemplate("[FOO] is here", {})
    expect(result).toBe("[FOO] is here")
    expect(spy).toHaveBeenCalledWith("[workflow] Warning: unfilled placeholder [FOO] in template\n")
    spy.mockRestore()
  })

  test("warns once per unique unfilled placeholder", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    fillTemplate("[FOO] and [FOO] again", {})
    const callsForFoo = spy.mock.calls.filter(
      (args) => typeof args[0] === "string" && (args[0] as string).includes("[FOO]")
    )
    expect(callsForFoo).toHaveLength(1)
    spy.mockRestore()
  })

  test("no placeholders", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = fillTemplate("no placeholders here", {})
    expect(result).toBe("no placeholders here")
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test("empty replacements", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = fillTemplate("[X] stays [X]", {})
    expect(result).toBe("[X] stays [X]")
    const callsForX = spy.mock.calls.filter(
      (args) => typeof args[0] === "string" && (args[0] as string).includes("[X]")
    )
    expect(callsForX).toHaveLength(1)
    spy.mockRestore()
  })

  test("multiline content", () => {
    const template = `line1 [A]\nline2 [B]\nline3 [A]`
    const result = fillTemplate(template, { A: "hello", B: "world" })
    expect(result).toBe("line1 hello\nline2 world\nline3 hello")
  })

  test("placeholders with spaces", () => {
    expect(fillTemplate("[my name]", { "my name": "Alice" })).toBe("Alice")
  })

  test("mixed case placeholders", () => {
    expect(fillTemplate("[MyName]", { MyName: "Bob" })).toBe("Bob")
  })

  test("digit in placeholder name is replaced", () => {
    expect(fillTemplate("[task1] done", { task1: "setup" })).toBe("setup done")
  })

  test("uppercase placeholder with trailing digit warns when unfilled", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = fillTemplate("[BASE_SHA1] is here", {})
    expect(result).toBe("[BASE_SHA1] is here")
    expect(spy).toHaveBeenCalledWith("[workflow] Warning: unfilled placeholder [BASE_SHA1] in template\n")
    spy.mockRestore()
  })

  test("known real mixed-case placeholder warns when unfilled", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = fillTemplate("task: [task name]", {})
    expect(result).toBe("task: [task name]")
    expect(spy).toHaveBeenCalledWith("[workflow] Warning: unfilled placeholder [task name] in template\n")
    spy.mockRestore()
  })

  test("known real mixed-case placeholder warns once when repeated", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    fillTemplate("[directory] and [directory] again", {})
    const calls = spy.mock.calls.filter(
      (args) => typeof args[0] === "string" && (args[0] as string).includes("[directory]")
    )
    expect(calls).toHaveLength(1)
    spy.mockRestore()
  })

  test("placeholder with apostrophe is replaced", () => {
    expect(
      fillTemplate("[From implementer's report]", { "From implementer's report": "all good" })
    ).toBe("all good")
  })

  test("known real placeholder with apostrophe warns when unfilled", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = fillTemplate("[From implementer's report]", {})
    expect(result).toBe("[From implementer's report]")
    expect(spy).toHaveBeenCalledWith(
      "[workflow] Warning: unfilled placeholder [From implementer's report] in template\n"
    )
    spy.mockRestore()
  })
})

describe("BRAINSTORM_PHASE_PROMPT", () => {
  test("starts with correct title", () => {
    expect(BRAINSTORM_PHASE_PROMPT.startsWith("# Brainstorming Ideas Into Designs\n")).toBe(true)
  })

  test("length is above truncation floor", () => {
    expect(BRAINSTORM_PHASE_PROMPT.length).toBeGreaterThan(6000)
  })

  test("contains title from brainstorming skill", () => {
    expect(BRAINSTORM_PHASE_PROMPT).toContain("Brainstorming Ideas Into Designs")
  })

  test("does not contain YAML frontmatter", () => {
    expect(BRAINSTORM_PHASE_PROMPT.startsWith("---")).toBe(false)
  })

  test("does not contain Visual Companion references", () => {
    expect(BRAINSTORM_PHASE_PROMPT).not.toContain("Visual Companion")
    expect(BRAINSTORM_PHASE_PROMPT).not.toContain("visual companion")
  })

  test("contains checklist section", () => {
    expect(BRAINSTORM_PHASE_PROMPT).toContain("## Checklist")
  })

  test("contains key principles section", () => {
    expect(BRAINSTORM_PHASE_PROMPT).toContain("## Key Principles")
  })

  test("contains HARD-GATE", () => {
    expect(BRAINSTORM_PHASE_PROMPT).toContain("HARD-GATE")
  })

  test("contains clarifying questions", () => {
    expect(BRAINSTORM_PHASE_PROMPT).toContain("clarifying questions")
  })

  test("contains write_spec", () => {
    expect(BRAINSTORM_PHASE_PROMPT).toContain("write_spec")
  })

  test("contains review_spec", () => {
    expect(BRAINSTORM_PHASE_PROMPT).toContain("review_spec")
  })

  test("contains Propose 2-3 approaches", () => {
    expect(BRAINSTORM_PHASE_PROMPT).toContain("Propose 2-3 approaches")
  })

  test("contains Spec review loop", () => {
    expect(BRAINSTORM_PHASE_PROMPT).toContain("Spec review loop")
  })
})

describe("PLAN_PHASE_PROMPT", () => {
  test("starts with correct title", () => {
    expect(PLAN_PHASE_PROMPT.startsWith("# Writing Plans\n")).toBe(true)
  })

  test("length is above truncation floor", () => {
    expect(PLAN_PHASE_PROMPT.length).toBeGreaterThan(4000)
  })

  test("contains title from writing-plans skill", () => {
    expect(PLAN_PHASE_PROMPT).toContain("# Writing Plans")
  })

  test("does not contain YAML frontmatter", () => {
    expect(PLAN_PHASE_PROMPT.startsWith("---")).toBe(false)
  })

  test("contains announcement with closed quote", () => {
    expect(PLAN_PHASE_PROMPT).toContain("implementation plan.\"")
  })

  test("contains task structure section", () => {
    expect(PLAN_PHASE_PROMPT).toContain("## Task Structure")
  })

  test("contains plan review loop section", () => {
    expect(PLAN_PHASE_PROMPT).toContain("## Plan Review Loop")
  })

  test("contains execution handoff section", () => {
    expect(PLAN_PHASE_PROMPT).toContain("## Execution Handoff")
  })

  test("contains Bite-Sized", () => {
    expect(PLAN_PHASE_PROMPT).toContain("Bite-Sized")
  })

  test("contains TDD", () => {
    expect(PLAN_PHASE_PROMPT).toContain("TDD")
  })

  test("contains write_plan", () => {
    expect(PLAN_PHASE_PROMPT).toContain("write_plan")
  })

  test("contains review_plan", () => {
    expect(PLAN_PHASE_PROMPT).toContain("review_plan")
  })

  test("contains Chunk", () => {
    expect(PLAN_PHASE_PROMPT).toContain("Chunk")
  })

  test("contains subagent-driven-development", () => {
    expect(PLAN_PHASE_PROMPT).toContain("subagent-driven-development")
  })
})

describe("IMPLEMENT_PHASE_PROMPT", () => {
  test("starts with correct title", () => {
    expect(IMPLEMENT_PHASE_PROMPT.startsWith("# Subagent-Driven Development\n")).toBe(true)
  })

  test("length is above truncation floor", () => {
    expect(IMPLEMENT_PHASE_PROMPT.length).toBeGreaterThan(8000)
  })

  test("contains title from subagent-driven-development skill", () => {
    expect(IMPLEMENT_PHASE_PROMPT).toContain("Subagent-Driven Development")
  })

  test("does not contain YAML frontmatter", () => {
    expect(IMPLEMENT_PHASE_PROMPT.startsWith("---")).toBe(false)
  })

  test("contains the process section", () => {
    expect(IMPLEMENT_PHASE_PROMPT).toContain("## The Process")
  })

  test("contains red flags section", () => {
    expect(IMPLEMENT_PHASE_PROMPT).toContain("## Red Flags")
  })

  test("contains integration section", () => {
    expect(IMPLEMENT_PHASE_PROMPT).toContain("## Integration")
  })

  test("contains programmer subagent", () => {
    expect(IMPLEMENT_PHASE_PROMPT).toContain("programmer subagent")
  })

  test("contains spec compliance", () => {
    expect(IMPLEMENT_PHASE_PROMPT).toContain("spec compliance")
  })

  test("contains code quality", () => {
    expect(IMPLEMENT_PHASE_PROMPT).toContain("code quality")
  })

  test("contains DONE status", () => {
    expect(IMPLEMENT_PHASE_PROMPT).toContain("DONE")
  })

  test("contains BLOCKED status", () => {
    expect(IMPLEMENT_PHASE_PROMPT).toContain("BLOCKED")
  })

  test("contains NEEDS_CONTEXT status", () => {
    expect(IMPLEMENT_PHASE_PROMPT).toContain("NEEDS_CONTEXT")
  })

  test("does not contain stale local markdown file references", () => {
    expect(IMPLEMENT_PHASE_PROMPT).not.toContain("./programmer-prompt.md")
    expect(IMPLEMENT_PHASE_PROMPT).not.toContain("./spec-reviewer-prompt.md")
    expect(IMPLEMENT_PHASE_PROMPT).not.toContain("./code-quality-reviewer-prompt.md")
  })

  test("does not contain TodoWrite", () => {
    expect(IMPLEMENT_PHASE_PROMPT).not.toContain("TodoWrite")
  })
})

describe("PROGRAMMER_TEMPLATE", () => {
  test("starts with correct opening line", () => {
    expect(PROGRAMMER_TEMPLATE.startsWith("You are implementing Task N: [task name]\n")).toBe(true)
  })

  test("length is above truncation floor", () => {
    expect(PROGRAMMER_TEMPLATE.length).toBeGreaterThan(3000)
  })

  test("contains task name placeholder", () => {
    expect(PROGRAMMER_TEMPLATE).toContain("[task name]")
  })

  test("contains directory placeholder", () => {
    expect(PROGRAMMER_TEMPLATE).toContain("[directory]")
  })

  test("contains task description placeholder", () => {
    expect(PROGRAMMER_TEMPLATE).toContain("[FULL TEXT of task]")
  })

  test("contains scene-setting context placeholder", () => {
    expect(PROGRAMMER_TEMPLATE).toContain("[Scene-setting context]")
  })

  test("contains report format section", () => {
    expect(PROGRAMMER_TEMPLATE).toContain("## Report Format")
  })

  test("contains status values", () => {
    expect(PROGRAMMER_TEMPLATE).toContain("DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT")
  })

  test("contains Self-Review", () => {
    expect(PROGRAMMER_TEMPLATE).toContain("Self-Review")
  })
})

describe("EXPLORE_TEMPLATE", () => {
  test("matches exact string", () => {
    expect(EXPLORE_TEMPLATE).toBe("Explore the codebase. Report findings. Do not modify anything.\n\n")
  })
})

describe("RESEARCH_TEMPLATE", () => {
  test("matches exact string", () => {
    expect(RESEARCH_TEMPLATE).toBe("Research the topic. Summarize findings with sources. Do not modify anything.\n\n")
  })
})

describe("INVESTIGATE_TEMPLATE", () => {
  test("matches exact string", () => {
    expect(INVESTIGATE_TEMPLATE).toBe("Investigate and debug the following issue. Read relevant code, trace the problem, and report your findings. Do not modify anything.\n\n")
  })
})

describe("SPEC_REVIEWER_TEMPLATE", () => {
  test("contains task requirements placeholder", () => {
    expect(SPEC_REVIEWER_TEMPLATE).toContain("[FULL TEXT of task requirements]")
  })

  test("contains implementer report placeholder", () => {
    expect(SPEC_REVIEWER_TEMPLATE).toContain("[From implementer's report]")
  })

  test("contains CRITICAL section", () => {
    expect(SPEC_REVIEWER_TEMPLATE).toContain("## CRITICAL")
  })

  test("contains Do Not Trust the Report", () => {
    expect(SPEC_REVIEWER_TEMPLATE).toContain("Do Not Trust the Report")
  })

  test("fillTemplate replaces [From implementer's report] end-to-end", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = fillTemplate(SPEC_REVIEWER_TEMPLATE, {
      "FULL TEXT of task requirements": "must support apostrophes",
      "From implementer's report": "done, all tests pass",
    })
    expect(result).toContain("must support apostrophes")
    expect(result).toContain("done, all tests pass")
    expect(result).not.toContain("[FULL TEXT of task requirements]")
    expect(result).not.toContain("[From implementer's report]")
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test("fillTemplate warns for unfilled [From implementer's report]", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    fillTemplate(SPEC_REVIEWER_TEMPLATE, { "FULL TEXT of task requirements": "reqs" })
    const msgs = spy.mock.calls.map((args) => String(args[0]))
    expect(msgs.some((m) => m.includes("[From implementer's report]"))).toBe(true)
    spy.mockRestore()
  })
})

describe("CODE_QUALITY_REVIEWER_TEMPLATE", () => {
  test("contains WHAT_WAS_IMPLEMENTED placeholder", () => {
    expect(CODE_QUALITY_REVIEWER_TEMPLATE).toContain("[WHAT_WAS_IMPLEMENTED]")
  })

  test("contains PLAN_OR_REQUIREMENTS placeholder", () => {
    expect(CODE_QUALITY_REVIEWER_TEMPLATE).toContain("[PLAN_OR_REQUIREMENTS]")
  })

  test("contains BASE_SHA placeholder", () => {
    expect(CODE_QUALITY_REVIEWER_TEMPLATE).toContain("[BASE_SHA]")
  })

  test("contains HEAD_SHA placeholder", () => {
    expect(CODE_QUALITY_REVIEWER_TEMPLATE).toContain("[HEAD_SHA]")
  })

  test("contains DESCRIPTION placeholder", () => {
    expect(CODE_QUALITY_REVIEWER_TEMPLATE).toContain("[DESCRIPTION]")
  })

  test("contains assessment section", () => {
    expect(CODE_QUALITY_REVIEWER_TEMPLATE).toContain("### Assessment")
  })
})

describe("SPEC_DOCUMENT_REVIEWER_TEMPLATE", () => {
  test("contains SPEC_FILE_PATH placeholder", () => {
    expect(SPEC_DOCUMENT_REVIEWER_TEMPLATE).toContain("[SPEC_FILE_PATH]")
  })

  test("contains CRITICAL section", () => {
    expect(SPEC_DOCUMENT_REVIEWER_TEMPLATE).toContain("## CRITICAL")
  })

  test("contains spec review output format", () => {
    expect(SPEC_DOCUMENT_REVIEWER_TEMPLATE).toContain("## Spec Review")
  })

  test("contains Completeness", () => {
    expect(SPEC_DOCUMENT_REVIEWER_TEMPLATE).toContain("Completeness")
  })

  test("contains YAGNI", () => {
    expect(SPEC_DOCUMENT_REVIEWER_TEMPLATE).toContain("YAGNI")
  })
})

describe("PLAN_DOCUMENT_REVIEWER_TEMPLATE", () => {
  test("contains PLAN_FILE_PATH placeholder", () => {
    expect(PLAN_DOCUMENT_REVIEWER_TEMPLATE).toContain("[PLAN_FILE_PATH]")
  })

  test("contains SPEC_FILE_PATH placeholder", () => {
    expect(PLAN_DOCUMENT_REVIEWER_TEMPLATE).toContain("[SPEC_FILE_PATH]")
  })

  test("contains CHUNK placeholder", () => {
    expect(PLAN_DOCUMENT_REVIEWER_TEMPLATE).toContain("[CHUNK]")
  })

  test("contains plan review output format", () => {
    expect(PLAN_DOCUMENT_REVIEWER_TEMPLATE).toContain("## Plan Review")
  })

  test("contains Spec Alignment", () => {
    expect(PLAN_DOCUMENT_REVIEWER_TEMPLATE).toContain("Spec Alignment")
  })
})

describe("fillTemplate - prompt template e2e", () => {
  test("CODE_QUALITY_REVIEWER_TEMPLATE: substitutes real placeholders and emits no warnings", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    const replacements = {
      WHAT_WAS_IMPLEMENTED: "feature X",
      PLAN_OR_REQUIREMENTS: "plan A",
      DESCRIPTION: "review description",
      BASE_SHA: "abc1234",
      HEAD_SHA: "def5678",
    }
    const result = fillTemplate(CODE_QUALITY_REVIEWER_TEMPLATE, replacements)
    expect(result).toContain("feature X")
    expect(result).toContain("plan A")
    expect(result).toContain("abc1234")
    expect(result).toContain("def5678")
    expect(result).not.toContain("[WHAT_WAS_IMPLEMENTED]")
    expect(result).not.toContain("[PLAN_OR_REQUIREMENTS]")
    expect(result).not.toContain("[DESCRIPTION]")
    expect(result).not.toContain("[BASE_SHA]")
    expect(result).not.toContain("[HEAD_SHA]")
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test("PLAN_DOCUMENT_REVIEWER_TEMPLATE: substitutes real placeholders and emits no warnings", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = fillTemplate(PLAN_DOCUMENT_REVIEWER_TEMPLATE, {
      PLAN_FILE_PATH: "path/to/plan.md",
      SPEC_FILE_PATH: "path/to/spec.md",
      CHUNK: "Chunk 1",
    })
    expect(result).toContain("path/to/plan.md")
    expect(result).toContain("path/to/spec.md")
    expect(result).toContain("Chunk 1")
    expect(result).not.toContain("[PLAN_FILE_PATH]")
    expect(result).not.toContain("[SPEC_FILE_PATH]")
    expect(result).not.toContain("[CHUNK]")
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test("SPEC_DOCUMENT_REVIEWER_TEMPLATE: substitutes real placeholder and emits no warnings", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = fillTemplate(SPEC_DOCUMENT_REVIEWER_TEMPLATE, {
      SPEC_FILE_PATH: "path/to/spec.md",
    })
    expect(result).toContain("path/to/spec.md")
    expect(result).not.toContain("[SPEC_FILE_PATH]")
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe("fillTemplate - PROGRAMMER_TEMPLATE integration", () => {
  test("replaces all real placeholders and emits no warnings when all filled", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = fillTemplate(PROGRAMMER_TEMPLATE, {
      "task name": "Setup CI",
      "FULL TEXT of task": "Configure GitHub Actions.",
      "Scene-setting context": "This is task 1 of 5.",
      directory: "/home/runner/work",
    })
    expect(result).toContain("Setup CI")
    expect(result).toContain("Configure GitHub Actions.")
    expect(result).toContain("This is task 1 of 5.")
    expect(result).toContain("/home/runner/work")
    expect(result).not.toContain("[task name]")
    expect(result).not.toContain("[directory]")
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test("warns for each unfilled real mixed-case placeholder", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    fillTemplate(PROGRAMMER_TEMPLATE, {})
    const msgs = spy.mock.calls.map((args) => String(args[0]))
    expect(msgs.some((m) => m.includes("[task name]"))).toBe(true)
    expect(msgs.some((m) => m.includes("[FULL TEXT of task]"))).toBe(true)
    expect(msgs.some((m) => m.includes("[Scene-setting context]"))).toBe(true)
    expect(msgs.some((m) => m.includes("[directory]"))).toBe(true)
    spy.mockRestore()
  })

  test("warns once per unfilled real mixed-case placeholder even when repeated", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    fillTemplate(PROGRAMMER_TEMPLATE, {})
    const taskNameCalls = spy.mock.calls.filter(
      (args) => typeof args[0] === "string" && (args[0] as string).includes("[task name]")
    )
    expect(taskNameCalls).toHaveLength(1)
    spy.mockRestore()
  })
})
