export interface NavState {
  index: number
  max: number
}

export type NavEventKind = 'navigate' | 'back' | 'forward' | 'reload'

export const initialNavState: NavState = { index: 0, max: 0 }

export function reduceNavState(state: NavState, kind: NavEventKind): NavState {
  switch (kind) {
    case 'navigate':
      return { index: state.index + 1, max: state.index + 1 }
    case 'back':
      return state.index > 0 ? { index: state.index - 1, max: state.max } : state
    case 'forward':
      return state.index < state.max ? { index: state.index + 1, max: state.max } : state
    case 'reload':
      return state
  }
}

export function canGoBack(state: NavState): boolean {
  return state.index > 0
}

export function canGoForward(state: NavState): boolean {
  return state.index < state.max
}
