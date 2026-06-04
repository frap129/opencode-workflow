// src/tools/artifacts.ts
import { tool } from "@opencode-ai/plugin"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { PLANS_DIR, SPEC_FILENAME_REGEX, PLAN_FILENAME_REGEX } from "../constants"
import { updateState } from "../state"

/** Structured tool result — serialized to JSON for the model */
interface ToolResult {
  title: string
  output: string
  metadata: {
    success: boolean
    errorCode?: string
    [key: string]: unknown
  }
}

function result(r: ToolResult): string {
  return JSON.stringify(r)
}

function errorResult(title: string, message: string, errorCode: string): string {
  return result({ title, output: message, metadata: { success: false, errorCode } })
}

function validateFilename(filename: string, pattern: RegExp, kind: string): string | null {
  if (!pattern.test(filename)) {
    return errorResult(
      `Invalid ${kind} filename`,
      `"${filename}" is not a valid ${kind} filename. Must match: ${pattern.toString()}. ` +
        `Must be a simple basename (no paths), start with lowercase alphanumeric, ` +
        `and end with -${kind}.md`,
      "INVALID_FILENAME"
    )
  }
  return null
}

function resolvePlanPath(directory: string, filename: string): string {
  return join(directory, PLANS_DIR, filename)
}

export function createReadSpecTool() {
  return tool({
    description:
      "Read a spec artifact file from .opencode/plans/. " +
      "Filename must be a simple basename matching the pattern: " +
      "[a-z0-9][a-z0-9._-]*-spec.md",
    args: {
      filename: tool.schema.string().describe(
        "Spec filename (e.g. 'my-feature-spec.md'). Must end with -spec.md."
      ),
    },
    async execute(args, context) {
      const validationError = validateFilename(args.filename, SPEC_FILENAME_REGEX, "spec")
      if (validationError) return validationError

      const filePath = resolvePlanPath(context.directory, args.filename)
      context.metadata({ title: `Reading ${args.filename}` })

      try {
        const content = await readFile(filePath, "utf-8")
        return result({
          title: `Read ${args.filename}`,
          output: content,
          metadata: { success: true, filename: args.filename },
        })
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return errorResult(
            `File not found: ${args.filename}`,
            `Spec file "${args.filename}" does not exist in ${PLANS_DIR}/`,
            "FILE_NOT_FOUND"
          )
        }
        throw err
      }
    },
  })
}

export function createWriteSpecTool() {
  return tool({
    description:
      "Write (create or replace) a spec artifact file in .opencode/plans/. " +
      "Filename must be a simple basename matching the pattern: " +
      "[a-z0-9][a-z0-9._-]*-spec.md",
    args: {
      filename: tool.schema.string().describe(
        "Spec filename (e.g. 'my-feature-spec.md'). Must end with -spec.md."
      ),
      content: tool.schema.string().describe("Full file content to write."),
    },
    async execute(args, context) {
      const validationError = validateFilename(args.filename, SPEC_FILENAME_REGEX, "spec")
      if (validationError) return validationError

      const filePath = resolvePlanPath(context.directory, args.filename)
      context.metadata({ title: `Writing ${args.filename}` })

      // Ensure plans directory exists
      await mkdir(join(context.directory, PLANS_DIR), { recursive: true })
      await writeFile(filePath, args.content, "utf-8")

      return result({
        title: `Wrote ${args.filename}`,
        output: `✅ Wrote ${args.filename}\nNEXT REQUIRED STEP: run review_spec for this file before treating the spec as complete.`,
        metadata: { success: true, filename: args.filename, bytes: args.content.length },
      })
    },
  })
}

export function createReadPlanTool() {
  return tool({
    description:
      "Read a plan artifact file from .opencode/plans/. " +
      "Filename must be a simple basename matching the pattern: " +
      "[a-z0-9][a-z0-9._-]*-plan.md",
    args: {
      filename: tool.schema.string().describe(
        "Plan filename (e.g. 'my-feature-plan.md'). Must end with -plan.md."
      ),
    },
    async execute(args, context) {
      const validationError = validateFilename(args.filename, PLAN_FILENAME_REGEX, "plan")
      if (validationError) return validationError

      const filePath = resolvePlanPath(context.directory, args.filename)
      context.metadata({ title: `Reading ${args.filename}` })

      try {
        const content = await readFile(filePath, "utf-8")
        updateState({ activePlanFilename: args.filename })
        return result({
          title: `Read ${args.filename}`,
          output: content,
          metadata: { success: true, filename: args.filename },
        })
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return errorResult(
            `File not found: ${args.filename}`,
            `Plan file "${args.filename}" does not exist in ${PLANS_DIR}/`,
            "FILE_NOT_FOUND"
          )
        }
        throw err
      }
    },
  })
}

export function createWritePlanTool() {
  return tool({
    description:
      "Write (create or replace) a plan artifact file in .opencode/plans/. " +
      "Filename must be a simple basename matching the pattern: " +
      "[a-z0-9][a-z0-9._-]*-plan.md",
    args: {
      filename: tool.schema.string().describe(
        "Plan filename (e.g. 'my-feature-plan.md'). Must end with -plan.md."
      ),
      content: tool.schema.string().describe("Full file content to write."),
    },
    async execute(args, context) {
      const validationError = validateFilename(args.filename, PLAN_FILENAME_REGEX, "plan")
      if (validationError) return validationError

      const filePath = resolvePlanPath(context.directory, args.filename)
      context.metadata({ title: `Writing ${args.filename}` })

      await mkdir(join(context.directory, PLANS_DIR), { recursive: true })
      await writeFile(filePath, args.content, "utf-8")

      updateState({ activePlanFilename: args.filename })

      return result({
        title: `Wrote ${args.filename}`,
        output: `✅ Wrote ${args.filename}\nNEXT REQUIRED STEP: run review_plan for this file before treating the plan as complete.`,
        metadata: { success: true, filename: args.filename, bytes: args.content.length },
      })
    },
  })
}

async function editArtifact(params: {
  directory: string
  filename: string
  filenameRegex: RegExp
  kind: string
  oldText: string
  newText: string
  reviewNudge: string
}): Promise<string> {
  const { directory, filename, filenameRegex, kind, oldText, newText, reviewNudge } = params

  const validationError = validateFilename(filename, filenameRegex, kind)
  if (validationError) return validationError

  if (oldText.length === 0) {
    return errorResult(
      `Cannot edit ${filename}`,
      `old_text must not be empty.`,
      "EMPTY_OLD_TEXT"
    )
  }

  const filePath = resolvePlanPath(directory, filename)
  const content = await readFile(filePath, "utf-8")

  let count = 0
  let idx = content.indexOf(oldText)
  while (idx !== -1) {
    count++
    idx = content.indexOf(oldText, idx + oldText.length)
  }

  if (count === 0) {
    return errorResult(
      `Text not found in ${filename}`,
      `The specified old_text was not found in "${filename}".`,
      "TEXT_NOT_FOUND"
    )
  }

  if (count > 1) {
    return errorResult(
      `Ambiguous match in ${filename}`,
      `old_text matched ${count} locations in "${filename}". Provide more context to make it unique.`,
      "AMBIGUOUS_MATCH"
    )
  }

  const updated = content.replace(oldText, newText)
  await writeFile(filePath, updated, "utf-8")

  return result({
    title: `Updated ${filename}`,
    output: `✅ Updated ${filename}\nNEXT REQUIRED STEP: this artifact was modified. Re-review is required before proceeding. Run ${reviewNudge} for this file.`,
    metadata: { success: true, filename, bytes: updated.length },
  })
}

export function createEditSpecTool() {
  return tool({
    description:
      "Edit a spec artifact file in .opencode/plans/ using exact search-and-replace. " +
      "Filename must be a simple basename matching the pattern: " +
      "[a-z0-9][a-z0-9._-]*-spec.md",
    args: {
      filename: tool.schema.string().describe(
        "Spec filename (e.g. 'my-feature-spec.md'). Must end with -spec.md."
      ),
      old_text: tool.schema.string().describe("Exact text to find (must match exactly once)."),
      new_text: tool.schema.string().describe("Replacement text (may be empty to delete)."),
    },
    async execute(args, context) {
      context.metadata({ title: `Editing ${args.filename}` })
      try {
        return await editArtifact({
          directory: context.directory,
          filename: args.filename,
          filenameRegex: SPEC_FILENAME_REGEX,
          kind: "spec",
          oldText: args.old_text,
          newText: args.new_text,
          reviewNudge: "review_spec",
        })
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return errorResult(
            `File not found: ${args.filename}`,
            `Spec file "${args.filename}" does not exist in ${PLANS_DIR}/`,
            "FILE_NOT_FOUND"
          )
        }
        throw err
      }
    },
  })
}

export function createEditPlanTool() {
  return tool({
    description:
      "Edit a plan artifact file in .opencode/plans/ using exact search-and-replace. " +
      "Filename must be a simple basename matching the pattern: " +
      "[a-z0-9][a-z0-9._-]*-plan.md",
    args: {
      filename: tool.schema.string().describe(
        "Plan filename (e.g. 'my-feature-plan.md'). Must end with -plan.md."
      ),
      old_text: tool.schema.string().describe("Exact text to find (must match exactly once)."),
      new_text: tool.schema.string().describe("Replacement text (may be empty to delete)."),
    },
    async execute(args, context) {
      context.metadata({ title: `Editing ${args.filename}` })
      try {
        const editResult = await editArtifact({
          directory: context.directory,
          filename: args.filename,
          filenameRegex: PLAN_FILENAME_REGEX,
          kind: "plan",
          oldText: args.old_text,
          newText: args.new_text,
          reviewNudge: "review_plan",
        })
        const parsed = JSON.parse(editResult)
        if (parsed.metadata.success) {
          updateState({ activePlanFilename: args.filename })
        }
        return editResult
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return errorResult(
            `File not found: ${args.filename}`,
            `Plan file "${args.filename}" does not exist in ${PLANS_DIR}/`,
            "FILE_NOT_FOUND"
          )
        }
        throw err
      }
    },
  })
}
