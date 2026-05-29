/**
 * Fetches the current model variant for a session.
 * Uses the existing v1 client (typed as any) — the server returns model.variant
 * even though the v1 TypeScript types don't declare it.
 */
export async function getSessionVariant(
  client: any,
  sessionID: string
): Promise<string | undefined> {
  try {
    const response = await client.session.get({ path: { id: sessionID } })
    return response.data?.model?.variant
  } catch {
    return undefined
  }
}
