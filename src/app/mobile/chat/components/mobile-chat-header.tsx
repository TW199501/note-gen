"use client"

import { useMemo, useState } from "react"
import { History, MessageSquarePlus, Search, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import useChatStore from "@/stores/chat"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { SearchDialog } from "@/components/search-dialog"

dayjs.extend(relativeTime)

function formatRelativeTime(timestamp: number): string {
  return dayjs(timestamp).fromNow()
}

export function MobileChatHeader() {
  const {
    startNewConversation,
    conversations,
    currentConversationId,
    switchConversation,
    deleteConversation,
    loading,
  } = useChatStore()
  const tEmpty = useTranslations("record.chat.empty")
  const tInput = useTranslations("record.chat.input")
  const tSearch = useTranslations("search")

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  const hasCurrentMessages = conversations.some(
    (conversation) =>
      conversation.id === currentConversationId && conversation.messageCount > 0
  )
  const disableNewChat = !hasCurrentMessages || loading

  const filteredConversations = useMemo(() => {
    return conversations
      .filter((conversation) => conversation.messageCount > 0)
      .filter((conversation) =>
        conversation.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
        return b.updatedAt - a.updatedAt
      })
  }, [conversations, searchQuery])

  return (
    <>
      <header className="mobile-page-header w-full border-b px-2 flex items-center gap-2 bg-background">
        <button
          type="button"
          aria-label={tSearch("placeholder")}
          onClick={() => setSearchOpen(true)}
          className="flex h-9 min-w-0 flex-1 items-center rounded-md border bg-muted/30 px-3 text-left"
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <span className="ml-2 truncate text-sm text-muted-foreground">
            {tSearch("placeholder")}
          </span>
        </button>

        <div className="flex items-center shrink-0">
          <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DrawerTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={tEmpty("conversationHistory")}>
                <History className="size-4" />
              </Button>
            </DrawerTrigger>
            <DrawerContent className="max-h-[85vh]">
              <DrawerHeader className="pb-2">
                <DrawerTitle>{tEmpty("conversationHistory")}</DrawerTitle>
              </DrawerHeader>
              <div className="px-4 pb-4">
                <div className="relative mb-3">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={tEmpty("searchPlaceholder")}
                    className="pl-8"
                  />
                </div>
                <div className="max-h-[56vh] overflow-y-auto">
                  {filteredConversations.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-8 text-center">
                      {searchQuery
                        ? tEmpty("noMatchingConversations")
                        : tEmpty("noConversationHistory")}
                    </div>
                  ) : (
                    filteredConversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        className="w-full text-left p-3 rounded-lg border mb-2 active:bg-accent transition-colors"
                        onClick={() => {
                          switchConversation(conversation.id)
                          setDrawerOpen(false)
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{conversation.title}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatRelativeTime(conversation.updatedAt)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0 size-8 text-muted-foreground active:text-destructive"
                            onClick={(event) => {
                              event.stopPropagation()
                              deleteConversation(conversation.id)
                            }}
                            aria-label={tEmpty("deleteConversation")}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </DrawerContent>
          </Drawer>

          <Button
            variant="ghost"
            size="icon"
            aria-label={tInput("newChat")}
            onClick={() => startNewConversation()}
            disabled={disableNewChat}
          >
            <MessageSquarePlus className="size-4" />
          </Button>
        </div>
      </header>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  )
}
