'use client'

import React, { useCallback, useRef, useState, useEffect } from "react"
import { MoreVertical } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

interface MobileActionMenuProps {
  children: React.ReactNode
  className?: string
}

export function MobileActionMenu({ children, className }: MobileActionMenuProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setOpen((prev) => !prev)
  }, [])

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handleClickOutside)
    return () => document.removeEventListener('pointerdown', handleClickOutside)
  }, [open])

  if (!isMobile) {
    return null
  }

  return (
    <div ref={menuRef} className="relative">
      <div
        className={cn(
          "h-6 w-6 p-0 hover:bg-muted rounded flex items-center justify-center cursor-pointer",
          className
        )}
        onClick={handleToggle}
      >
        <MoreVertical className="h-4 w-4" />
      </div>
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function MobileMenuItem({
  children,
  onClick,
  disabled,
  className,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground",
        disabled && "pointer-events-none opacity-50",
        className
      )}
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </div>
  )
}

export function MobileSeparator({ className }: { className?: string }) {
  return <div className={cn("-mx-1 my-1 h-px bg-muted", className)} />
}
