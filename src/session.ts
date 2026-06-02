// src/session.ts
// Session cache: tracks the last known model and variant per session.
// The chat.message hook calls cacheVariant()/cacheModel() on every message,
// and the getters are used by command/tool hooks to retrieve
// the values that were set BEFORE opencode's agent switch reset them.

export type ModelRef = { providerID: string; modelID: string }

const variantCache = new Map<string, string | undefined>()
const modelCache = new Map<string, ModelRef | undefined>()

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
 * Cache the model for a session.
 * Called from the chat.message hook.
 */
export function cacheModel(sessionID: string, model: ModelRef | undefined): void {
  modelCache.set(sessionID, model)
}

/**
 * Retrieve the cached model for a session.
 * Returns undefined if no model was ever cached.
 */
export function getCachedModel(sessionID: string): ModelRef | undefined {
  return modelCache.get(sessionID)
}

/**
 * Creates the `chat.message` hook callback.
 * Captures the model and variant from every message so they can be
 * re-applied after agent switches that reset them.
 */
export function createChatMessageHook() {
  return async (input: {
    sessionID: string
    agent?: string
    model?: ModelRef
    messageID?: string
    variant?: string
  }) => {
    cacheVariant(input.sessionID, input.variant)
    cacheModel(input.sessionID, input.model)
  }
}
