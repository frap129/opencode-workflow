// src/index.ts
import type { Plugin } from "@opencode-ai/plugin"
import {
  createReadSpecTool,
  createWriteSpecTool,
  createReadPlanTool,
  createWritePlanTool,
  createEditSpecTool,
  createEditPlanTool,
} from "./tools/artifacts"
import {
  createExploreTool,
  createResearchTool,
  createProgrammerTool,
  createReviewSpecTool,
  createReviewPlanTool,
  createVerifySpecComplianceTool,
  createCodeReviewTool,
  createInvestigateTool,
} from "./tools/wrappers"
import { createBashTool } from "./tools/bash"
import { createConfigHook, createCommandHook } from "./commands"
import { createChatMessageHook } from "./session"
import { updateState } from "./state"

/**
 * Creates the workflow plugin hooks object.
 * Exported for testing — the default export wraps this in the Plugin type.
 */
export async function createPlugin(ctx: {
  client: any
  project?: any
  directory: string
  worktree: string
  serverUrl: URL
  $: any
}) {
  const { client, directory } = ctx

  return {
    tool: {
      read_spec: createReadSpecTool(),
      write_spec: createWriteSpecTool(),
      edit_spec: createEditSpecTool(),
      read_plan: createReadPlanTool(),
      write_plan: createWritePlanTool(),
      edit_plan: createEditPlanTool(),

      // Wrapper tools (need client for subtask dispatch)
      explore: createExploreTool(client),
      research: createResearchTool(client),
      programmer: createProgrammerTool(client),
      review_spec: createReviewSpecTool(client),
      review_plan: createReviewPlanTool(client),
      verify_spec_compliance: createVerifySpecComplianceTool(client),
      code_review: createCodeReviewTool(client),
      investigate: createInvestigateTool(client),
      bash: createBashTool(),
    },

    config: createConfigHook(),

    "chat.message": createChatMessageHook(),

    "command.execute.before": createCommandHook(client, directory, undefined, undefined, undefined, updateState),
  }
}

/**
 * The plugin entry point.
 * opencode calls this with PluginInput and expects a Hooks object back.
 */
const plugin: Plugin = async (ctx) => createPlugin(ctx)

export default plugin
