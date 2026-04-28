"use client"
import * as React from "react"
import { MessageSquarePlus } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import { useChatStoreFromContext } from "./chat-store-context"
import { useTranslations } from 'next-intl'

export function NewChat() {
  const { startNewConversation, chats } = useChatStoreFromContext()
  const t = useTranslations()

  function newChatHandler() {
    startNewConversation()
  }

  // 当前会话没有消息时禁用新对话按钮
  const isDisabled = chats.length === 0

  return (
    <div>
      <TooltipButton icon={<MessageSquarePlus />} tooltipText={t('record.chat.input.newChat')} side="bottom" onClick={newChatHandler} disabled={isDisabled}/>
    </div>
  )
}
