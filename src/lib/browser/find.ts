export interface MatchPosition {
  start: number
  end: number
}

export interface FindOptions {
  caseSensitive?: boolean
}

export function findMatchPositions(
  text: string,
  query: string,
  options: FindOptions = {},
): MatchPosition[] {
  if (!query) return []
  const haystack = options.caseSensitive ? text : text.toLowerCase()
  const needle = options.caseSensitive ? query : query.toLowerCase()
  const matches: MatchPosition[] = []
  let i = 0
  while (i <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, i)
    if (found === -1) break
    matches.push({ start: found, end: found + needle.length })
    i = found + needle.length
  }
  return matches
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function clampMatchIndex(index: number, total: number): number {
  if (total === 0) return -1
  const m = ((index % total) + total) % total
  return m
}
