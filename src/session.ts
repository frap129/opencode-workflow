// src/session.ts
// Variant cache: tracks the last known model variant per session.
// The chat.message hook calls cacheVariant() on every message,
// and getCachedVariant() is used by command/tool hooks to retrieve
// the variant that was set BEFORE opencode's agent switch reset it.

const variantCache = new Map<string, string | undefined>()

/**
 * Cache the variant for a session.
 * Called from the chat.message hook.
 */
export function cacheVariant(sessionID: string, variant: string | undefined): void {
  variantCache.set(sessionID, variant)
}

/**
 * Retrieve the cached variant for a session.
 * Returns undefined if no variant was ever cached.
 */
export function getCachedVariant(sessionID: string): string | undefined {
  return variantCache.get(sessionID)
}

/**
 * Creates the `chat.message` hook callback.
 * Captures the model variant from every message so it can be
 * re-applied after agent switches that reset it.
 */
export function createChatMessageHook() {
  return async (input: {
    sessionID: string
    agent?: string
    model?: { providerID: string; modelID: string }
    messageID?: string
    variant?: string
  }) => {
    cacheVariant(input.sessionID, input.variant)
  }
}
