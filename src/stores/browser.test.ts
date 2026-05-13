import { describe, it, expect, beforeEach } from 'vitest'
import useBrowserStore from './browser'

describe('useBrowserStore nav', () => {
  beforeEach(() => {
    useBrowserStore.getState().resetNavState()
    useBrowserStore.getState().setDevtoolsOpen(false)
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

describe('useBrowserStore devtools', () => {
  it('starts closed', () => {
    useBrowserStore.getState().setDevtoolsOpen(false)
    expect(useBrowserStore.getState().devtoolsOpen).toBe(false)
  })

  it('setDevtoolsOpen updates flag', () => {
    useBrowserStore.getState().setDevtoolsOpen(true)
    expect(useBrowserStore.getState().devtoolsOpen).toBe(true)
    useBrowserStore.getState().setDevtoolsOpen(false)
    expect(useBrowserStore.getState().devtoolsOpen).toBe(false)
  })
})

describe('useBrowserStore downloads', () => {
  beforeEach(() => {
    useBrowserStore.getState().resetDownloadCount()
  })

  it('starts at 0', () => {
    expect(useBrowserStore.getState().downloadInProgressCount).toBe(0)
  })

  it('increment + decrement track in-progress count', () => {
    const s = useBrowserStore.getState()
    s.incrementDownloadCount()
    s.incrementDownloadCount()
    expect(useBrowserStore.getState().downloadInProgressCount).toBe(2)
    s.decrementDownloadCount()
    expect(useBrowserStore.getState().downloadInProgressCount).toBe(1)
  })

  it('decrement clamps at 0 (never goes negative)', () => {
    useBrowserStore.getState().decrementDownloadCount()
    useBrowserStore.getState().decrementDownloadCount()
    expect(useBrowserStore.getState().downloadInProgressCount).toBe(0)
  })

  it('resetDownloadCount zeros out an in-progress count', () => {
    useBrowserStore.getState().incrementDownloadCount()
    useBrowserStore.getState().incrementDownloadCount()
    useBrowserStore.getState().resetDownloadCount()
    expect(useBrowserStore.getState().downloadInProgressCount).toBe(0)
  })
})
