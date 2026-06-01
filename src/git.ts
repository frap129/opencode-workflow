export async function getHeadSha(cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git rev-parse HEAD failed (exit ${exitCode}): ${stderr.trim()}`)
  }

  const stdout = await new Response(proc.stdout).text()
  return stdout.trim()
}
