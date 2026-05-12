export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 5.0
export const ZOOM_STEP = 0.1
export const ZOOM_DEFAULT = 1.0

function round(v: number): number {
  return Math.round(v * 100) / 100
}

export function clampZoom(level: number): number {
  return round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level)))
}

export function zoomIn(current: number): number {
  return clampZoom(current + ZOOM_STEP)
}

export function zoomOut(current: number): number {
  return clampZoom(current - ZOOM_STEP)
}

export function zoomReset(): number {
  return ZOOM_DEFAULT
}

export function formatZoomPercent(level: number): string {
  return `${Math.round(level * 100)}%`
}
