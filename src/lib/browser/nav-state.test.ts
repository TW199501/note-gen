import { describe, it, expect } from 'vitest'
import {
  initialNavState,
  reduceNavState,
  canGoBack,
  canGoForward,
  type NavState,
} from './nav-state'

describe('initial state', () => {
  it('has no back or forward', () => {
    expect(canGoBack(initialNavState)).toBe(false)
    expect(canGoForward(initialNavState)).toBe(false)
  })
})

describe('navigate', () => {
  it('advances index and clears forward stack', () => {
    const s1 = reduceNavState(initialNavState, 'navigate')
    expect(s1).toEqual({ index: 1, max: 1 })
    expect(canGoBack(s1)).toBe(true)
    expect(canGoForward(s1)).toBe(false)
  })

  it('after going back, a new navigate truncates the forward stack', () => {
    let s: NavState = initialNavState
    s = reduceNavState(s, 'navigate') // index=1, max=1
    s = reduceNavState(s, 'navigate') // index=2, max=2
    s = reduceNavState(s, 'navigate') // index=3, max=3
    s = reduceNavState(s, 'back')     // index=2, max=3
    s = reduceNavState(s, 'back')     // index=1, max=3
    expect(canGoForward(s)).toBe(true)
    s = reduceNavState(s, 'navigate') // index=2, max=2 (forward gone)
    expect(s).toEqual({ index: 2, max: 2 })
    expect(canGoForward(s)).toBe(false)
  })
})

describe('back', () => {
  it('does nothing at index 0', () => {
    const s = reduceNavState(initialNavState, 'back')
    expect(s).toEqual(initialNavState)
  })

  it('decrements index without changing max', () => {
    const s1 = reduceNavState(initialNavState, 'navigate')   // 1,1
    const s2 = reduceNavState(s1, 'navigate')                // 2,2
    const s3 = reduceNavState(s2, 'back')                    // 1,2
    expect(s3).toEqual({ index: 1, max: 2 })
    expect(canGoBack(s3)).toBe(true)
    expect(canGoForward(s3)).toBe(true)
  })

  it('disables back when reaching index 0', () => {
    const s1 = reduceNavState(initialNavState, 'navigate')   // 1,1
    const s2 = reduceNavState(s1, 'back')                    // 0,1
    expect(canGoBack(s2)).toBe(false)
    expect(canGoForward(s2)).toBe(true)
  })
})

describe('forward', () => {
  it('does nothing at max', () => {
    const s1 = reduceNavState(initialNavState, 'navigate')
    const s2 = reduceNavState(s1, 'forward')
    expect(s2).toEqual(s1)
  })

  it('increments index until max', () => {
    let s: NavState = initialNavState
    s = reduceNavState(s, 'navigate') // 1,1
    s = reduceNavState(s, 'navigate') // 2,2
    s = reduceNavState(s, 'back')     // 1,2
    s = reduceNavState(s, 'forward')  // 2,2
    expect(s).toEqual({ index: 2, max: 2 })
    expect(canGoForward(s)).toBe(false)
  })
})

describe('reload', () => {
  it('does not change state', () => {
    const s1 = reduceNavState(initialNavState, 'navigate')
    const s2 = reduceNavState(s1, 'navigate')
    const s3 = reduceNavState(s2, 'back')
    const after = reduceNavState(s3, 'reload')
    expect(after).toEqual(s3)
  })
})

describe('realistic browsing session', () => {
  it('A → B → C → back → back → click link to D', () => {
    let s: NavState = initialNavState
    s = reduceNavState(s, 'navigate') // A: 1,1
    expect([canGoBack(s), canGoForward(s)]).toEqual([true, false])
    s = reduceNavState(s, 'navigate') // B: 2,2
    s = reduceNavState(s, 'navigate') // C: 3,3
    expect([canGoBack(s), canGoForward(s)]).toEqual([true, false])
    s = reduceNavState(s, 'back')     // B: 2,3
    expect([canGoBack(s), canGoForward(s)]).toEqual([true, true])
    s = reduceNavState(s, 'back')     // A: 1,3
    expect([canGoBack(s), canGoForward(s)]).toEqual([true, true])
    s = reduceNavState(s, 'navigate') // D: 2,2 (forward stack to B/C gone)
    expect(s).toEqual({ index: 2, max: 2 })
    expect([canGoBack(s), canGoForward(s)]).toEqual([true, false])
  })
})
