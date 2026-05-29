// src/tools/wrappers.ts
import { tool } from "@opencode-ai/plugin"
import { SPEC_FILENAME_REGEX, PLAN_FILENAME_REGEX } from "../constants"
import { getCachedVariant } from "../session"

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
  callerAgent: string,
  targetAgent: string,
  prompt: string,
  description: string,
  metadata: (input: { title?: string; metadata?: Record<string, any> }) => void
): Promise<string> {
  metadata({ title: `Dispatching subtask to ${targetAgent}` })

  try {
    const variant = getCachedVariant(sessionID)
    await client.session.prompt({
      path: { id: sessionID },
      body: {
        agent: callerAgent,
        noReply: true,
        variant,
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

    return result({
      title: `Queued subtask: ${description}`,
      output: `Subtask dispatched to ${targetAgent}. It will run as a child session.`,
      metadata: { queued: true, targetAgent, description },
    })
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
        context.agent,
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
        context.agent,
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
        context.agent,
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
        context.agent,
        "workflow-reviewer",
        reviewPrompt,
        `Review plan: ${args.filename}`,
        context.metadata
      )
    },
  })
}
