// src/tools/bash.ts
import { tool } from "@opencode-ai/plugin"

function truncateOutput(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text
  return text.slice(0, maxBytes) + `\n... [truncated at ${maxBytes} bytes]`
}

function result(data: { title: string; output: string; metadata: Record<string, unknown> }): string {
  return JSON.stringify(data)
}

export function createBashTool(options?: { timeoutMs?: number; outputLimitBytes?: number }) {
  const timeoutMs = options?.timeoutMs ?? 120_000
  const outputLimitBytes = options?.outputLimitBytes ?? 50 * 1024

  return tool({
    description:
      "Run a shell command in the project directory. " +
      "Returns stdout, stderr, exit code, and metadata.",
    args: {
      command: tool.schema.string().describe("The shell command to run."),
      description: tool.schema.string().optional().describe(
        "Brief description shown in the metadata title."
      ),
    },
    async execute(args, context) {
      if (!args.command || !args.command.trim()) {
        return JSON.stringify({
          title: "Invalid command",
          output: "Command must be non-empty.",
          metadata: { success: false, errorCode: "EMPTY_COMMAND" },
        })
      }

      context.metadata({ title: args.description || `bash: ${args.command.slice(0, 80)}` })

      const proc = Bun.spawn(["sh", "-c", args.command], {
        cwd: context.directory,
        stdout: "pipe",
        stderr: "pipe",
      })

      let timedOut = false
      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          timedOut = true
          proc.kill()
          resolve()
        }, timeoutMs)
      })

      await Promise.race([proc.exited, timeoutPromise])

      const exitCode = timedOut ? null : await proc.exited

      const rawStdout = await new Response(proc.stdout).text()
      const rawStderr = await new Response(proc.stderr).text()

      const truncatedStdout = truncateOutput(rawStdout, outputLimitBytes)
      const truncatedStderr = truncateOutput(rawStderr, outputLimitBytes)

      return result({
        title: args.description || `bash: ${args.command.slice(0, 80)}`,
        output: truncatedStdout + (truncatedStderr ? `\n\nSTDERR:\n${truncatedStderr}` : ""),
        metadata: {
          success: exitCode === 0 && !timedOut,
          exitCode,
          stdout: truncatedStdout,
          stderr: truncatedStderr,
          timedOut,
        },
      })
    },
  })
}
