// src/commands.ts
import {
  PHASE_AGENT_MAP,
  type PhaseName,
} from "./constants"
import {
  checkBootstrapStatus as defaultCheckBootstrap,
  runBootstrap as defaultRunBootstrap,
  forceBootstrap as defaultForceBootstrap,
  formatPartialBootstrapError,
  type BootstrapStatus,
} from "./bootstrap"
import type { AgentName } from "./constants"
import { getSessionVariant } from "./session"

/**
 * Phase entry prompt templates.
 * Each takes the user's arguments and returns the full entry prompt text.
 */
const ENTRY_PROMPTS: Record<PhaseName, (args: string) => string> = {
  brainstorm: (args) =>
    [
      "You are now in brainstorm mode.",
      "Your role is to explore ideas, ask clarifying questions, and help refine requirements into a spec.",
      "Use the explore and research tools to gather context. Use write_spec to save your findings.",
      "Use review_spec to get structured feedback on specs before finalizing.",
      "",
      args ? `The user wants to brainstorm: ${args}` : "Ask the user what they'd like to brainstorm.",
    ].join("\n"),

  plan: (args) =>
    [
      "You are now in plan mode.",
      "Your role is to turn an approved spec into an actionable implementation plan.",
      "Use read_spec to load the relevant spec. Use write_plan to create the plan.",
      "Use review_plan to get structured feedback on plans before finalizing.",
      "",
      args ? `The user wants to plan: ${args}` : "Ask the user which spec to plan for.",
    ].join("\n"),

  implement: (args) =>
    [
      "You are now in implement mode.",
      "Your role is to execute against an existing approved plan.",
      "Use read_plan to load the plan. Use the programmer tool for focused implementation work.",
      "Use explore and research for additional context as needed.",
      "",
      args ? `The user wants to implement: ${args}` : "Ask the user which plan to implement.",
    ].join("\n"),
}

/**
 * Creates the `config` hook callback.
 * Registers 3 slash commands and applies per-phase tool shaping.
 *
 * NOTE: We intentionally omit the `agent` field from command config entries.
 * If `agent` is set here, opencode performs its own internal agent switch
 * BEFORE the command.execute.before hook fires, which resets the model variant.
 * Instead, agent switching is handled in the command hook via the prompt body's
 * `agent` field, where we can also pass `variant` to preserve it.
 */
export function createConfigHook() {
  return async (config: any) => {
    config.command ??= {}
    for (const [phase] of Object.entries(PHASE_AGENT_MAP)) {
      config.command[phase] = {
        template: `{{args}}`,
        description: `Enter ${phase} mode`,
      }
    }
    config.command["workflow-init"] = {
      template: `{{args}}`,
      description: "Regenerate workflow agent files",
    }
  }
}

/**
 * Creates the `command.execute.before` hook callback.
 * Gates on bootstrap status, submits phase entry prompts, then aborts pipeline.
 *
 * @param client - opencode SDK client (captured from PluginInput)
 * @param projectDir - project root directory
 * @param checkBootstrapFn - override for testing (defaults to checkBootstrapStatus)
 * @param runBootstrapFn - override for testing (defaults to runBootstrap)
 */
export function createCommandHook(
  client: any,
  projectDir: string,
  checkBootstrapFn: (dir: string) => Promise<BootstrapStatus> = defaultCheckBootstrap,
  runBootstrapFn: (dir: string) => Promise<void> = defaultRunBootstrap,
  forceBootstrapFn: (dir: string) => Promise<void> = defaultForceBootstrap
) {
  const phaseNames = new Set(Object.keys(PHASE_AGENT_MAP))

  return async (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: any[] }
  ) => {
    // Handle workflow-init: force-write all agent files
    if (input.command === "workflow-init") {
      await forceBootstrapFn(projectDir)
      const initVariant = await getSessionVariant(client, input.sessionID)
      await client.session.prompt({
        path: { id: input.sessionID },
        body: {
          noReply: true,
          variant: initVariant,
          parts: [{ type: "text", text: "Workflow agent files regenerated (7 agents written to .opencode/agents/)." }],
        },
      })
      throw new Error("__WORKFLOW_HANDLED__")
    }

    // Only handle phase commands
    if (!phaseNames.has(input.command)) return

    const phase = input.command as PhaseName
    const agent = PHASE_AGENT_MAP[phase]

    // Bootstrap gate
    const status = await checkBootstrapFn(projectDir)
    if (status.status === "needs-bootstrap") {
      await runBootstrapFn(projectDir)
    } else if (status.status === "partial") {
      const errorMsg = formatPartialBootstrapError(status.missing, status.present)
      throw new Error(errorMsg)
    }
    // status === "ready" — proceed

    // Build entry prompt
    const args = (input.arguments || "").trim()
    const entryPrompt = ENTRY_PROMPTS[phase](args)

    // Fetch the current variant BEFORE any agent switch happens,
    // then pass both agent and variant in the prompt body so the
    // server switches the agent and preserves the variant atomically.
    const variant = await getSessionVariant(client, input.sessionID)
    await client.session.prompt({
      path: { id: input.sessionID },
      body: {
        agent,
        variant,
        parts: [{ type: "text", text: entryPrompt }],
      },
    })

    // Abort the command pipeline so opencode doesn't also send the template
    throw new Error("__WORKFLOW_HANDLED__")
  }
}
