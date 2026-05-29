// src/index.ts
import type { Plugin } from "@opencode-ai/plugin"
import {
  createReadSpecTool,
  createWriteSpecTool,
  createReadPlanTool,
  createWritePlanTool,
} from "./tools/artifacts"
import {
  createExploreTool,
  createResearchTool,
  createProgrammerTool,
  createReviewSpecTool,
  createReviewPlanTool,
} from "./tools/wrappers"
import { createConfigHook, createCommandHook } from "./commands"
import { createV2Client } from "./session"

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
  const { client, directory, serverUrl } = ctx
  const v2Client = createV2Client(serverUrl, directory)

  return {
    tool: {
      // Artifact tools
      read_spec: createReadSpecTool(),
      write_spec: createWriteSpecTool(),
      read_plan: createReadPlanTool(),
      write_plan: createWritePlanTool(),

      // Wrapper tools (need client for subtask dispatch)
      explore: createExploreTool(client),
      research: createResearchTool(client),
      programmer: createProgrammerTool(client),
      review_spec: createReviewSpecTool(client),
      review_plan: createReviewPlanTool(client),
    },

    config: createConfigHook(),

    "command.execute.before": createCommandHook(client, v2Client, directory),
  }
}

/**
 * The plugin entry point.
 * opencode calls this with PluginInput and expects a Hooks object back.
 */
const plugin: Plugin = async (ctx) => createPlugin(ctx)

export default plugin
