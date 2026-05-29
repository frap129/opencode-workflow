// src/agents.ts
import type { AgentName } from "./constants"

/** Returns the markdown content for a generated agent file.
 *  Build-order stub — replaced with full agent content in Chunk 4, Task 14.
 */
export function getAgentContent(name: AgentName): string {
  return `---\nname: ${name}\n---\n\n# ${name}\n\nWorkflow agent.\n`
}
