import { describe, it, expect, beforeEach } from 'vitest'
import useBrowserStore from './browser'

describe('useBrowserStore nav', () => {
  beforeEach(() => {
    useBrowserStore.getState().resetNavState()
  })

  it('starts with both buttons disabled', () => {
    const s = useBrowserStore.getState()
    expect(s.canGoBack).toBe(false)
    expect(s.canGoForward).toBe(false)
  })

  it('navigate enables back, keeps forward disabled', () => {
    useBrowserStore.getState().applyNavEvent('navigate')
    const s = useBrowserStore.getState()
    expect(s.canGoBack).toBe(true)
    expect(s.canGoForward).toBe(false)
  })

  it('back after navigate enables forward, disables back', () => {
    useBrowserStore.getState().applyNavEvent('navigate')
    useBrowserStore.getState().applyNavEvent('back')
    const s = useBrowserStore.getState()
    expect(s.canGoBack).toBe(false)
    expect(s.canGoForward).toBe(true)
  })

  it('reload does not change nav state', () => {
    useBrowserStore.getState().applyNavEvent('navigate')
    useBrowserStore.getState().applyNavEvent('navigate')
    const before = useBrowserStore.getState().navState
    useBrowserStore.getState().applyNavEvent('reload')
    const s = useBrowserStore.getState()
    expect(s.navState).toEqual(before)
    expect(s.canGoBack).toBe(true)
    expect(s.canGoForward).toBe(false)
  })

  it('navigate after back truncates forward stack', () => {
    const a = useBrowserStore.getState()
    a.applyNavEvent('navigate')
    a.applyNavEvent('navigate')
    a.applyNavEvent('back')
    expect(useBrowserStore.getState().canGoForward).toBe(true)
    a.applyNavEvent('navigate')
    expect(useBrowserStore.getState().canGoForward).toBe(false)
  })

  it('resetNavState clears everything', () => {
    useBrowserStore.getState().applyNavEvent('navigate')
    useBrowserStore.getState().applyNavEvent('navigate')
    useBrowserStore.getState().resetNavState()
    const s = useBrowserStore.getState()
    expect(s.canGoBack).toBe(false)
    expect(s.canGoForward).toBe(false)
    expect(s.navState).toEqual({ index: 0, max: 0 })
  })
})
