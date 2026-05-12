'use client'

import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useTranslations } from 'next-intl'
import { ChevronUp, ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import useBrowserStore from '@/stores/browser'

export function FindBar() {
  const t = useTranslations('browser.find')
  const { findOpen, setFindOpen, findQuery, setFindQuery, findCount, findIndex, setFindState } = useBrowserStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [debouncedQuery, setDebouncedQuery] = useState(findQuery)

  // Listen for Ctrl/Cmd+F forwarded from the WebView (and find-state count updates).
  useEffect(() => {
    const window = getCurrentWindow()
    const requestedListener = window.listen<{ initial_query: string }>('browser-find-requested', (event) => {
      const seed = event.payload.initial_query?.trim()
      if (seed && seed.length > 0 && seed.length < 200) {
        setFindQuery(seed)
      }
      setFindOpen(true)
      // setTimeout to wait for input to mount after setFindOpen state flush
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
    })
    const stateListener = window.listen<{ count: number; index: number }>('browser-find-state', (event) => {
      setFindState(event.payload.count, event.payload.index)
    })
    return () => {
      requestedListener.then((u) => u())
      stateListener.then((u) => u())
    }
  }, [setFindOpen, setFindQuery, setFindState])

  // Auto-focus when bar opens via UI (e.g. shortcut bypass on host side)
  useEffect(() => {
    if (findOpen) {
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
    }
  }, [findOpen])

  // Debounce the query → invoke search.
  useEffect(() => {
    if (!findOpen) return
    const handle = setTimeout(() => setDebouncedQuery(findQuery), 200)
    return () => clearTimeout(handle)
  }, [findQuery, findOpen])

  useEffect(() => {
    if (!findOpen) return
    invoke('browser_find_start', { query: debouncedQuery, caseSensitive: false }).catch((e) =>
      console.error('[Browser] find_start failed:', e),
    )
  }, [debouncedQuery, findOpen])

  function handleClose() {
    setFindOpen(false)
    invoke('browser_find_close').catch((e) => console.error('[Browser] find_close failed:', e))
  }

  function handleNext() {
    invoke('browser_find_next').catch((e) => console.error('[Browser] find_next failed:', e))
  }

  function handlePrev() {
    invoke('browser_find_prev').catch((e) => console.error('[Browser] find_prev failed:', e))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      handleClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) handlePrev()
      else handleNext()
    }
  }

  if (!findOpen) return null

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b bg-background shadow-sm">
      <Input
        ref={inputRef}
        className="h-7 text-sm flex-1 max-w-sm"
        value={findQuery}
        onChange={(e) => setFindQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('placeholder')}
      />
      <span className="text-xs text-muted-foreground min-w-[3.5rem] text-center">
        {findCount === 0 ? t('noMatch') : `${findIndex + 1}/${findCount}`}
      </span>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePrev} disabled={findCount === 0} aria-label={t('previous')}>
        <ChevronUp className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNext} disabled={findCount === 0} aria-label={t('next')}>
        <ChevronDown className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose} aria-label={t('close')}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
