// src/tools/artifacts.ts
import { tool } from "@opencode-ai/plugin"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { PLANS_DIR, SPEC_FILENAME_REGEX, PLAN_FILENAME_REGEX } from "../constants"

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
        output: `Successfully wrote ${args.filename} to ${PLANS_DIR}/`,
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

      return result({
        title: `Wrote ${args.filename}`,
        output: `Successfully wrote ${args.filename} to ${PLANS_DIR}/`,
        metadata: { success: true, filename: args.filename, bytes: args.content.length },
      })
    },
  })
}
