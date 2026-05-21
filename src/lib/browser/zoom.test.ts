import { describe, it, expect } from 'vitest'
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_DEFAULT,
  clampZoom,
  zoomIn,
  zoomOut,
  zoomReset,
  formatZoomPercent,
} from './zoom'

describe('clampZoom', () => {
  it('clamps below min', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN)
    expect(clampZoom(-1)).toBe(ZOOM_MIN)
  })

  it('clamps above max', () => {
    expect(clampZoom(10)).toBe(ZOOM_MAX)
    expect(clampZoom(99)).toBe(ZOOM_MAX)
  })

  it('passes through valid values', () => {
    expect(clampZoom(0.5)).toBe(0.5)
    expect(clampZoom(1.0)).toBe(1.0)
    expect(clampZoom(2.5)).toBe(2.5)
  })

  it('rounds floating-point error to 2 decimals', () => {
    expect(clampZoom(1.1 + 0.1 + 0.1)).toBe(1.3)
  })
})

describe('zoomIn', () => {
  it('increments by 10%', () => {
    expect(zoomIn(1.0)).toBe(1.1)
    expect(zoomIn(1.1)).toBe(1.2)
  })

  it('clamps at max', () => {
    expect(zoomIn(ZOOM_MAX)).toBe(ZOOM_MAX)
    expect(zoomIn(4.95)).toBe(ZOOM_MAX)
  })

  it('does not accumulate floating-point error across steps', () => {
    let z = 1.0
    for (let i = 0; i < 5; i++) z = zoomIn(z)
    expect(z).toBe(1.5)
  })
})

describe('zoomOut', () => {
  it('decrements by 10%', () => {
    expect(zoomOut(1.0)).toBe(0.9)
    expect(zoomOut(0.5)).toBe(0.4)
  })

  it('clamps at min', () => {
    expect(zoomOut(ZOOM_MIN)).toBe(ZOOM_MIN)
    expect(zoomOut(0.3)).toBe(ZOOM_MIN)
  })
})

describe('zoomReset', () => {
  it('returns 100%', () => {
    expect(zoomReset()).toBe(ZOOM_DEFAULT)
    expect(zoomReset()).toBe(1.0)
  })
})

describe('formatZoomPercent', () => {
  it('shows whole percentages', () => {
    expect(formatZoomPercent(1.0)).toBe('100%')
    expect(formatZoomPercent(1.5)).toBe('150%')
    expect(formatZoomPercent(0.25)).toBe('25%')
  })

  it('rounds fractional zooms', () => {
    expect(formatZoomPercent(1.23456)).toBe('123%')
  })
})
