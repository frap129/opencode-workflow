// src/state.ts
import type { PhaseName } from "./constants"

export interface WorkflowState {
  phase: PhaseName | null
  lastBaseSha: string | null
  dispatchInProgress: boolean
  activePlanFilename: string | null
}

const initialState: WorkflowState = {
  phase: null,
  lastBaseSha: null,
  dispatchInProgress: false,
  activePlanFilename: null,
}

export function acquireDispatchLock(): boolean {
  if (state.dispatchInProgress) return false
  state.dispatchInProgress = true
  return true
}

export function releaseDispatchLock(): void {
  state.dispatchInProgress = false
}

let state: WorkflowState = { ...initialState }

export function getState(): WorkflowState {
  return { ...state }
}

export function updateState(partial: Partial<WorkflowState>): void {
  state = { ...state, ...partial }
}

export function resetState(): void {
  state = { ...initialState }
}
