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
import { getCachedVariant, getCachedModel } from "./session"
import {
  BRAINSTORM_PHASE_PROMPT,
  PLAN_PHASE_PROMPT,
  IMPLEMENT_PHASE_PROMPT,
} from "./prompts"
import { updateState as defaultUpdateState } from "./state"


/**
 * Phase entry prompt templates.
 * Each takes the user's arguments and returns the full entry prompt text.
 */
const ENTRY_PROMPTS: Record<PhaseName, (args: string) => string> = {
  brainstorm: (args) =>
    [
      BRAINSTORM_PHASE_PROMPT,
      "",
      "---",
      "",
      args
        ? `The user wants to brainstorm: ${args}`
        : "Ask the user what they'd like to brainstorm.",
    ].join("\n"),

  plan: (args) =>
    [
      PLAN_PHASE_PROMPT,
      "",
      "---",
      "",
      args
        ? `The user wants to plan: ${args}`
        : "Ask the user which spec to create a plan for.",
    ].join("\n"),

  implement: (args) =>
    [
      IMPLEMENT_PHASE_PROMPT,
      "",
      "---",
      "",
      args
        ? `The user wants to implement: ${args}`
        : "Ask the user which plan to implement.",
    ].join("\n"),
}

/**
 * Creates the `config` hook callback.
 * Registers 3 slash commands and applies per-phase tool shaping.
 *
 * The `agent` field on each command triggers opencode's persistent
 * session-level agent switch when the command pipeline completes.
 */
export function createConfigHook() {
  return async (config: any) => {
    config.command ??= {}
    for (const [phase, agent] of Object.entries(PHASE_AGENT_MAP)) {
      config.command[phase] = {
        template: `{{args}}`,
        description: `Enter ${phase} mode`,
        agent,
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
 * Gates on bootstrap status, writes phase entry prompts into output.parts,
 * then returns normally so opencode's pipeline applies the persistent agent switch.
 *
 * workflow-init is a special case: it calls session.prompt() directly with
 * noReply and aborts the pipeline since no LLM response is needed.
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
  forceBootstrapFn: (dir: string) => Promise<void> = defaultForceBootstrap,
  updateStateFn: typeof defaultUpdateState = defaultUpdateState
) {
  const phaseNames = new Set(Object.keys(PHASE_AGENT_MAP))

  return async (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: any[] }
  ) => {
    // Handle workflow-init: force-write all agent files
    if (input.command === "workflow-init") {
      await forceBootstrapFn(projectDir)
      const initVariant = getCachedVariant(input.sessionID)
      const initModel = getCachedModel(input.sessionID)
      await client.session.prompt({
        path: { id: input.sessionID },
        body: {
          noReply: true,
          variant: initVariant,
          model: initModel,
          parts: [{ type: "text", text: "Workflow agent files regenerated (7 agents written to .opencode/agents/)." }],
        },
      })
      throw new Error("__WORKFLOW_HANDLED__")
    }

    // Only handle phase commands
    if (!phaseNames.has(input.command)) return

    const phase = input.command as PhaseName

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

    updateStateFn({ phase })

    // Write the entry prompt into output.parts and return normally.
    // This lets opencode's command pipeline complete, which applies the
    // persistent agent switch from config.command[phase].agent.
    output.parts.push({ type: "text", text: entryPrompt })
  }
}
