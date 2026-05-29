// src/commands.ts
import {
  PHASE_AGENT_MAP,
  PHASE_TOOL_MATRIX,
  type PhaseName,
} from "./constants"
import {
  checkBootstrapStatus as defaultCheckBootstrap,
  runBootstrap as defaultRunBootstrap,
  formatPartialBootstrapError,
  type BootstrapStatus,
} from "./bootstrap"
import type { AgentName } from "./constants"

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
 */
export function createConfigHook() {
  return async (config: any) => {
    // Register slash commands — the `agent` field on each command config
    // causes opencode to switch to that agent when the command is invoked.
    // Subsequent user messages stay on that agent (opencode-native behavior).
    config.command ??= {}
    for (const [phase, agent] of Object.entries(PHASE_AGENT_MAP)) {
      config.command[phase] = {
        template: `{{args}}`,
        description: `Enter ${phase} mode`,
        agent,
      }
    }

    // Apply tool shaping per phase agent
    config.agent ??= {}
    for (const [phase, matrix] of Object.entries(PHASE_TOOL_MATRIX)) {
      const agentName = PHASE_AGENT_MAP[phase as PhaseName]
      config.agent[agentName] ??= {}
      config.agent[agentName].tools ??= {}

      // Hide workflow tools per the phase matrix
      for (const hiddenTool of matrix.hidden) {
        config.agent[agentName].tools[hiddenTool] = false
      }
    }

    // Built-in tool posture: brainstorm and plan deny code-editing and shell tools
    const readOnlyPhases: PhaseName[] = ["brainstorm", "plan"]
    const deniedBuiltinTools = ["edit", "write", "bash"]
    for (const phase of readOnlyPhases) {
      const agentName = PHASE_AGENT_MAP[phase]
      for (const tool of deniedBuiltinTools) {
        config.agent[agentName].tools[tool] = false
      }
    }

    // Supporting subagent tool posture: enforce read-only / non-mutating contracts
    const readOnlySubagents = ["workflow-explore", "workflow-research", "workflow-reviewer"]
    for (const agentName of readOnlySubagents) {
      config.agent[agentName] ??= {}
      config.agent[agentName].tools ??= {}
      for (const tool of deniedBuiltinTools) {
        config.agent[agentName].tools[tool] = false
      }
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
  runBootstrapFn: (dir: string) => Promise<void> = defaultRunBootstrap
) {
  const phaseNames = new Set(Object.keys(PHASE_AGENT_MAP))

  return async (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: any[] }
  ) => {
    // Only handle workflow commands
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

    // Submit entry prompt to session with noReply.
    // Agent switching is handled by two complementary mechanisms:
    // 1. The command config's `agent` field (set in createConfigHook) tells opencode
    //    to switch the session's active agent when the command is invoked.
    // 2. The `body.agent` field on this prompt call ensures this specific message
    //    is routed to the correct agent.
    // The throw below aborts the command template pipeline but does NOT undo
    // the agent switch — this follows the same pattern used by the DCP plugin.
    // Runtime verification of this behavior is in Chunk 5, Task 13, Steps 5-6.
    await client.session.prompt({
      path: { id: input.sessionID },
      body: {
        noReply: true,
        agent,
        parts: [{ type: "text", text: entryPrompt }],
      },
    })

    // Abort the command pipeline so opencode doesn't also send the template
    throw new Error("__WORKFLOW_HANDLED__")
  }
}
