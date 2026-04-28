import { Chat } from "@/db/chats"
import { useChatStoreFromContext } from "../chat-store-context"
import { XIcon } from "lucide-react"
import { clear, hasText, readText } from "tauri-plugin-clipboard-api"
import { MessageInfo } from "./message-info"
import { CondensedIndicator } from "./condensed-indicator"
import { CopyControl } from "./copy-control"
import { ReadAloudControl } from "./read-aloud-control"
import { TooltipButton } from "@/components/tooltip-button"
import { useTranslations } from 'next-intl';

export default function MessageControl({chat, children}: {chat: Chat, children: React.ReactNode}) {
  const { deleteChat } = useChatStoreFromContext()
  const t = useTranslations('common')
  
  async function deleteHandler() {
    if (chat.type === "clipboard" && !chat.image) {
      const hasTextRes = await hasText()
      if (hasTextRes) {
        try {
          const text = await readText()
          if (text === chat.content) {
            await clear()
          }
        } catch {}
      }
    }
    deleteChat(chat.id)
  }

  return (
    <>
      <div className='flex items-center justify-between mt-2'>

        <div className="flex items-center gap-2">
          <MessageInfo chat={chat} />
          <CondensedIndicator chat={chat} />
        </div>

        <div className='flex items-center'>
          {children || null}

          <CopyControl chat={chat} translatedContent="" />

          <ReadAloudControl chat={chat} translatedContent="" />

          <TooltipButton icon={<XIcon className='size-4' />} tooltipText={t('delete')} variant={"ghost"} size={"icon"} onClick={deleteHandler}/>
        </div>
      </div>
    </>
  )
}
