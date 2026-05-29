import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client"

export type V2Client = OpencodeClient

export function createV2Client(serverUrl: URL, directory: string): V2Client {
  return createOpencodeClient({
    baseUrl: serverUrl.toString(),
    directory,
  })
}

export async function getSessionVariant(
  v2Client: V2Client,
  sessionID: string
): Promise<string | undefined> {
  try {
    const response = await v2Client.session.get({ sessionID })
    return response.data?.model?.variant
  } catch {
    return undefined
  }
}
