import { describe, it, expect } from 'vitest'
import { findMatchPositions, escapeRegExp, clampMatchIndex } from './find'

describe('findMatchPositions', () => {
  it('returns empty for empty query', () => {
    expect(findMatchPositions('hello world', '')).toEqual([])
  })

  it('returns empty for no match', () => {
    expect(findMatchPositions('hello world', 'xyz')).toEqual([])
  })

  it('finds single match', () => {
    expect(findMatchPositions('hello world', 'world')).toEqual([{ start: 6, end: 11 }])
  })

  it('finds multiple non-overlapping matches', () => {
    expect(findMatchPositions('abab abab', 'ab')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 5, end: 7 },
      { start: 7, end: 9 },
    ])
  })

  it('is case-insensitive by default', () => {
    expect(findMatchPositions('Hello WORLD', 'world')).toEqual([{ start: 6, end: 11 }])
  })

  it('honors caseSensitive option', () => {
    expect(findMatchPositions('Hello WORLD', 'world', { caseSensitive: true })).toEqual([])
    expect(findMatchPositions('Hello WORLD', 'WORLD', { caseSensitive: true })).toEqual([
      { start: 6, end: 11 },
    ])
  })

  it('handles unicode (Chinese)', () => {
    expect(findMatchPositions('這是一個測試文字測試', '測試')).toEqual([
      { start: 4, end: 6 },
      { start: 8, end: 10 },
    ])
  })

  it('handles query longer than text', () => {
    expect(findMatchPositions('hi', 'hello world')).toEqual([])
  })

  it('does not return overlapping matches', () => {
    // "aaa" with query "aa" → positions 0-2 and 1-3 overlap; only first non-overlapping should match
    expect(findMatchPositions('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ])
  })
})

describe('escapeRegExp', () => {
  it('escapes regex special characters', () => {
    expect(escapeRegExp('a.b*c+?')).toBe('a\\.b\\*c\\+\\?')
    expect(escapeRegExp('(test)[1]')).toBe('\\(test\\)\\[1\\]')
  })

  it('leaves plain text alone', () => {
    expect(escapeRegExp('hello world')).toBe('hello world')
  })
})

describe('clampMatchIndex', () => {
  it('returns -1 when no matches', () => {
    expect(clampMatchIndex(0, 0)).toBe(-1)
    expect(clampMatchIndex(5, 0)).toBe(-1)
  })

  it('keeps index in range', () => {
    expect(clampMatchIndex(0, 5)).toBe(0)
    expect(clampMatchIndex(4, 5)).toBe(4)
  })

  it('wraps positive overflow', () => {
    expect(clampMatchIndex(5, 5)).toBe(0)
    expect(clampMatchIndex(7, 5)).toBe(2)
  })

  it('wraps negative (going back from first match)', () => {
    expect(clampMatchIndex(-1, 5)).toBe(4)
    expect(clampMatchIndex(-3, 5)).toBe(2)
  })
})
