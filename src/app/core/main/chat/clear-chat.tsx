"use client"
import * as React from "react"
import { Eraser } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import { useChatStoreFromContext } from "./chat-store-context"
import useTagStore from "@/stores/tag"
import { useTranslations } from 'next-intl'

export function ClearChat() {
  const { clearChats } = useChatStoreFromContext()
  const { currentTagId } = useTagStore()
  const t = useTranslations()

  function clearHandler() {
    clearChats(currentTagId)
  }

  return (
    <div>
      <TooltipButton icon={<Eraser />} tooltipText={t('record.chat.input.clearChat')} side="bottom" onClick={clearHandler}/>
    </div>
  )
}
