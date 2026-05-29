// src/bootstrap.ts
import { mkdir, writeFile, access, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { AGENT_NAMES, AGENTS_DIR, PLANS_DIR, type AgentName } from "./constants"
import { getAgentContent } from "./agents"

export type BootstrapStatus =
  | { status: "ready" }
  | { status: "needs-bootstrap" }
  | { status: "partial"; missing: AgentName[]; present: AgentName[] }

/**
 * Check whether the required workflow agent files exist.
 * Returns 'ready' if all exist, 'needs-bootstrap' if all missing,
 * 'partial' if some but not all exist.
 */
export async function checkBootstrapStatus(
  projectDir: string
): Promise<BootstrapStatus> {
  const agentsDir = join(projectDir, AGENTS_DIR)

  const results = await Promise.all(
    AGENT_NAMES.map(async (name) => {
      const filePath = join(agentsDir, `${name}.md`)
      try {
        await access(filePath)
        return { name, exists: true }
      } catch {
        return { name, exists: false }
      }
    })
  )

  const present = results.filter((r) => r.exists).map((r) => r.name)
  const missing = results.filter((r) => !r.exists).map((r) => r.name)

  if (missing.length === 0) return { status: "ready" }
  if (present.length === 0) return { status: "needs-bootstrap" }
  return { status: "partial", missing, present }
}

/**
 * Generate all 7 workflow agent files and ensure required directories exist.
 * All-or-nothing: writes all files to a staging directory, then moves each
 * file to the target. On any failure, removes both staging dir and any files
 * already moved to the target, leaving a clean 'needs-bootstrap' state.
 *
 * Refuses to run if agents are already bootstrapped (status != 'needs-bootstrap').
 *
 * @param contentGenerator - optional override for agent content (used in tests for failure injection)
 */
export async function runBootstrap(
  projectDir: string,
  contentGenerator?: (name: AgentName) => string
): Promise<void> {
  // Refuse to run if already bootstrapped
  const status = await checkBootstrapStatus(projectDir)
  if (status.status === "ready") {
    throw new Error("Workflow agents are already bootstrapped")
  }
  if (status.status === "partial") {
    throw new Error("Partial bootstrap detected — cannot auto-bootstrap")
  }

  const agentsDir = join(projectDir, AGENTS_DIR)
  const plansDir = join(projectDir, PLANS_DIR)
  const stagingDir = join(projectDir, ".opencode/.agents-staging")
  const getContent = contentGenerator ?? getAgentContent

  // Ensure target directories exist
  await mkdir(agentsDir, { recursive: true })
  await mkdir(plansDir, { recursive: true })

  // Write all files to staging first
  await mkdir(stagingDir, { recursive: true })
  const movedFiles: string[] = []
  try {
    // Stage all files
    for (const name of AGENT_NAMES) {
      const content = getContent(name)
      await writeFile(join(stagingDir, `${name}.md`), content, "utf-8")
    }

    // Move files to final location one by one, tracking what moved
    for (const name of AGENT_NAMES) {
      const target = join(agentsDir, `${name}.md`)
      await rename(join(stagingDir, `${name}.md`), target)
      movedFiles.push(target)
    }
  } catch (error) {
    // Clean up: remove any files already moved to target
    for (const file of movedFiles) {
      await rm(file, { force: true }).catch(() => {})
    }
    // Remove staging dir
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    throw error
  } finally {
    // Clean up empty staging dir on success
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Format a user-facing error message for partial bootstrap state.
 */
export function formatPartialBootstrapError(
  missing: AgentName[],
  present: AgentName[]
): string {
  const missingList = missing.map((n) => `  - .opencode/agents/${n}.md`).join("\n")
  return [
    "Workflow plugin error: partial agent installation detected.",
    "",
    "Missing agent files:",
    missingList,
    "",
    `${present.length} of 7 agent files exist. The workflow plugin requires all 7.`,
    "",
    "To recover, either:",
    "  1. Delete all .opencode/agents/workflow-*.md files and re-run the command (triggers fresh bootstrap)",
    "  2. Manually create the missing files listed above",
  ].join("\n")
}
