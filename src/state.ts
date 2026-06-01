// src/state.ts
import type { PhaseName } from "./constants"

export interface WorkflowState {
  phase: PhaseName | null
  lastBaseSha: string | null
}

const initialState: WorkflowState = {
  phase: null,
  lastBaseSha: null,
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
