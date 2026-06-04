// src/tools/wrappers.ts
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { tool } from "@opencode-ai/plugin"
import { PLAN_FILENAME_REGEX, PLANS_DIR, SPEC_FILENAME_REGEX } from "../constants"
import {
  fillTemplate,
  EXPLORE_TEMPLATE,
  RESEARCH_TEMPLATE,
  INVESTIGATE_TEMPLATE,
  SPEC_DOCUMENT_REVIEWER_TEMPLATE,
  PLAN_DOCUMENT_REVIEWER_TEMPLATE,
  PROGRAMMER_TEMPLATE,
  SPEC_REVIEWER_TEMPLATE,
  CODE_QUALITY_REVIEWER_TEMPLATE,
} from "../prompts"
import { getCachedVariant, getCachedModel } from "../session"
import { getHeadSha as defaultGetHeadSha } from "../git"
import { getState as defaultGetState, updateState as defaultUpdateState, acquireDispatchLock, releaseDispatchLock } from "../state"

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

function collectTextParts(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

async function waitForSessionIdle(
  stream: AsyncIterable<{ type: string; properties?: { sessionID?: string } }>,
  childSessionID: string,
  timeoutMs = 30_000,
): Promise<void> {
  const idleEvent = (async () => {
    for await (const event of stream) {
      if (event.type === "session.idle" && event.properties?.sessionID === childSessionID) {
        return
      }
    }
    throw new Error(`Event stream ended before child session ${childSessionID} became idle`)
  })()

  await Promise.race([
    idleEvent,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out waiting for child session ${childSessionID} to become idle`)), timeoutMs),
    ),
  ])
}

/**
 * Dispatch a native subtask via client.session.prompt() and wait for completion.
 * Returns a structured success result string.
 */
export async function dispatchSubtask(
  client: any,
  sessionID: string,
  callerAgent: string,
  targetAgent: string,
  prompt: string,
  description: string,
  metadata: (input: { title?: string; metadata?: Record<string, any> }) => void,
  options: { idleTimeoutMs?: number } = {},
): Promise<string> {
  if (!acquireDispatchLock()) {
    throw new Error(
      "A subagent dispatch is already in progress. These workflow tools are SERIAL-ONLY. Wait for the current dispatch to finish before starting another.",
    )
  }

  try {
    metadata({ title: `Dispatching subtask to ${targetAgent}` })
    const variant = getCachedVariant(sessionID)
    const model = getCachedModel(sessionID)

    const beforeChildren = await client.session.children({ path: { id: sessionID } })
    const beforeIds = new Set(beforeChildren.data.map((child: any) => child.id))

    const subscription = await client.event.subscribe()

    const response = await client.session.prompt({
      path: { id: sessionID },
      body: {
        agent: callerAgent,
        noReply: false,
        variant,
        model,
        parts: [
          {
            type: "subtask" as const,
            prompt,
            description,
            agent: targetAgent,
          },
        ],
      },
    })

    const directText = collectTextParts(response.data.parts ?? [])
    if (directText) {
      return result({
        title: `Completed subtask: ${description}`,
        output: directText,
        metadata: { queued: false, targetAgent, description },
      })
    }

    const afterChildren = await client.session.children({ path: { id: sessionID } })
    const spawnedChildren = afterChildren.data.filter((child: any) => !beforeIds.has(child.id))
    if (spawnedChildren.length !== 1) {
      throw new Error(
        `Expected exactly one new child session for this dispatch, found ${spawnedChildren.length}`,
      )
    }

    const spawnedChild = spawnedChildren[0]
    await waitForSessionIdle(subscription.stream, spawnedChild.id, options.idleTimeoutMs ?? 30_000)

    const messages = await client.session.messages({ path: { id: spawnedChild.id } })
    const fallbackText = collectTextParts(messages.data.flatMap((message: any) => message.parts))
    if (!fallbackText) {
      throw new Error(`Child session ${spawnedChild.id} completed without text output`)
    }

    return result({
      title: `Completed subtask: ${description}`,
      output: fallbackText,
      metadata: { queued: false, targetAgent, description },
    })
  } finally {
    releaseDispatchLock()
  }
}

/**
 * Wrapper that calls dispatchSubtask and converts thrown errors to structured error results.
 * Used by tool execute functions to maintain backward-compatible error reporting.
 */
async function safeDispatchSubtask(
  client: any,
  sessionID: string,
  callerAgent: string,
  targetAgent: string,
  prompt: string,
  description: string,
  metadata: (input: { title?: string; metadata?: Record<string, any> }) => void,
): Promise<string> {
  try {
    return await dispatchSubtask(client, sessionID, callerAgent, targetAgent, prompt, description, metadata)
  } catch (error: any) {
    return errorResult(
      `Failed to dispatch subtask to ${targetAgent}`,
      `Subtask dispatch failed: ${error.message}`,
      "DISPATCH_FAILED"
    )
  }
}

// ── Tool factories ──────────────────────────────────────────────────

/**
 * Extract a `### Task N:` block from plan text.
 * Returns the verbatim text from the heading to just before the next `### Task` heading or EOF.
 * Returns null if the task number is not found.
 * Returns "DUPLICATE" if the task heading appears more than once.
 */
export function extractTask(planText: string, taskNumber: number): string | null {
  const lines = planText.split("\n")
  const pattern = new RegExp(`^### Task ${taskNumber}:`)

  // Check for duplicates — only count headings outside fenced code blocks
  let fenceMarker: string | null = null
  let matchCount = 0
  let firstMatchIndex = -1
  for (let i = 0; i < lines.length; i += 1) {
    const fm = lines[i].match(/^ {0,3}(`{3,}|~{3,})/)
    if (fm) {
      const char = fm[1][0]
      if (fenceMarker === null) {
        fenceMarker = char
      } else if (char === fenceMarker) {
        fenceMarker = null
      }
      continue
    }
    if (fenceMarker === null && pattern.test(lines[i])) {
      matchCount += 1
      if (firstMatchIndex === -1) firstMatchIndex = i
    }
  }

  if (matchCount > 1) return "DUPLICATE"
  if (matchCount === 0) return null

  // Find end — skip headings inside fenced code blocks
  fenceMarker = null
  let endIndex = lines.length
  for (let i = firstMatchIndex + 1; i < lines.length; i += 1) {
    const fm = lines[i].match(/^ {0,3}(`{3,}|~{3,})/)
    if (fm) {
      const char = fm[1][0]
      if (fenceMarker === null) {
        fenceMarker = char
      } else if (char === fenceMarker) {
        fenceMarker = null
      }
      continue
    }
    if (fenceMarker === null && /^### Task \d+:/.test(lines[i])) {
      endIndex = i
      break
    }
  }

  return lines.slice(firstMatchIndex, endIndex).join("\n")
}

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

      return safeDispatchSubtask(
        client,
        context.sessionID,
        context.agent,
        "workflow-explore",
        `${EXPLORE_TEMPLATE}${args.prompt.trim()}`,
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

      return safeDispatchSubtask(
        client,
        context.sessionID,
        context.agent,
        "workflow-research",
        `${RESEARCH_TEMPLATE}${args.prompt.trim()}`,
        `Research: ${args.prompt.trim().slice(0, 80)}`,
        context.metadata
      )
    },
  })
}

/**
 * Create the `programmer` wrapper tool.
 * Dispatches implementation work to workflow-programmer using the programmer template.
 */
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

      return safeDispatchSubtask(
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
        fillTemplate(SPEC_DOCUMENT_REVIEWER_TEMPLATE, {
          SPEC_FILE_PATH: args.filename,
        }),
        args.prompt ? `\n## Specific Focus\n\n${args.prompt.trim()}` : "",
      ].filter(Boolean).join("\n")

      return safeDispatchSubtask(
        client,
        context.sessionID,
        context.agent,
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
        "Plan filename to review."
      ),
      spec_filename: tool.schema.string().optional().describe(
        "Optional spec filename for reference."
      ),
      chunk: tool.schema.number().optional().describe(
        "Optional chunk number from ## Chunk N: headings."
      ),
      prompt: tool.schema.string().optional().describe(
        "Optional review focus."
      ),
    },
    async execute(args, context) {
      const filenameError = validateFilename(args.filename, PLAN_FILENAME_REGEX, "plan")
      if (filenameError) return filenameError

      if (args.chunk !== undefined && !(Number.isInteger(args.chunk) && args.chunk > 0)) {
        return errorResult(
          "Invalid chunk number",
          `Chunk must be a positive integer, got: ${args.chunk}.`,
          "INVALID_CHUNK"
        )
      }

      let planText: string
      try {
        planText = await readFile(join(context.directory, PLANS_DIR, args.filename), "utf-8")
      } catch {
        return errorResult(
          "Failed to read plan file",
          `Could not read plan file "${args.filename}" from ${PLANS_DIR}.`,
          "FILE_NOT_FOUND"
        )
      }

      const planContent = args.chunk ? extractPlanChunk(planText, args.chunk) : planText
      if (args.chunk && planContent === null) {
        return errorResult(
          "Chunk not found",
          `Chunk ${args.chunk} was not found in "${args.filename}". ` +
            `Check that the plan contains a "## Chunk ${args.chunk}:" heading.`,
          "CHUNK_NOT_FOUND"
        )
      }

      const reviewPrompt = [
        fillTemplate(PLAN_DOCUMENT_REVIEWER_TEMPLATE, {
          PLAN_FILE_PATH: args.filename,
          SPEC_FILE_PATH: args.spec_filename ?? "not specified",
          CHUNK: args.chunk ? `Chunk ${args.chunk}` : "Full plan",
        }),
        `## Plan Content\n\n${planContent}`,
        args.prompt ? `## Specific Focus\n\n${args.prompt.trim()}` : "",
      ].filter(Boolean).join("\n\n")

      return safeDispatchSubtask(
        client,
        context.sessionID,
        context.agent,
        "workflow-reviewer",
        reviewPrompt,
        `Review plan: ${args.filename}`,
        context.metadata
      )
    },
  })
}

/**
 * Create the `verify_spec_compliance` wrapper tool.
 * Dispatches spec-compliance review to workflow-reviewer.
 */
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

      return safeDispatchSubtask(
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

/**
 * Create the `code_review` wrapper tool.
 * Dispatches a code quality review using git SHAs to scope the change.
 */
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

      return safeDispatchSubtask(
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

/**
 * Create the `investigate` wrapper tool.
 * Dispatches debugging and investigation tasks to workflow-explore.
 */
export function createInvestigateTool(client: any) {
  return tool({
    description:
      "Dispatch an investigation or debugging task to the workflow-explore subagent. " +
      "Use this to trace bugs, understand failures, or investigate unexpected behavior. " +
      "Runs as a native child session.",
    args: {
      prompt: tool.schema.string().describe(
        "What to investigate or debug. Describe the issue and what you want to understand."
      ),
    },
    async execute(args, context) {
      const promptError = validatePrompt(args.prompt)
      if (promptError) return promptError

      return safeDispatchSubtask(
        client,
        context.sessionID,
        context.agent,
        "workflow-explore",
        `${INVESTIGATE_TEMPLATE}${args.prompt.trim()}`,
        `Investigate: ${args.prompt.trim().slice(0, 80)}`,
        context.metadata
      )
    },
  })
}
