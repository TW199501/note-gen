'use client'

import { useState, useCallback, useRef } from 'react'
import { Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Strikethrough,
  Underline as UnderlineIcon,
  Code,
  Highlighter,
  Heading1,
  Heading2,
  Heading3,
  Link,
  Quote,
  List,
  ListOrdered,
  CheckSquare,
  Code2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  Table,
  Image as ImageIcon,
  Undo2,
  Redo2,
  Sparkles,
  Minimize2,
  Maximize2,
  MessageCircle,
  ListTree,
  Plus,
  Sigma,
  GitBranch,
  Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { handleImageUpload } from '@/lib/image-handler'
import useArticleStore from '@/stores/article'
import { toast } from '@/hooks/use-toast'

interface EditorToolbarProps {
  editor: Editor
  onAIPolish?: () => void
  onAIConcise?: () => void
  onAIExpand?: () => void
  onAIOrganize?: () => void
  onQuoteToChat?: () => void
}

type ToolbarItem =
  | { type: 'button'; name: string; icon: React.ComponentType<{ className?: string }>; action: () => void; isActive: () => boolean }
  | { type: 'separator' }

export function EditorToolbar({ editor, onAIPolish, onAIConcise, onAIExpand, onAIOrganize, onQuoteToChat }: EditorToolbarProps) {
  const t = useTranslations('editor')
  const [linkUrl, setLinkUrl] = useState('')
  const [showLinkInput, setShowLinkInput] = useState(false)
  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null)

  /** 在開啟 AI 選單前儲存選區；無選取時清除 ref，避免沿用過期選區 */
  const saveSelection = useCallback(() => {
    const { from, to } = editor.state.selection
    savedSelectionRef.current = from !== to ? { from, to } : null
  }, [editor])

  /**
   * 還原開啟選單前儲存的選区後再執行動作。
   * - 使用雙 rAF：等 Radix 關閉選單、焦點回復後再讀取選区，避免還原被覆寫。
   * - 無儲存選區時仍 focus 編輯器，AI 會改對「游標所在段落」作用（見 getMarkdownForAiEdit）。
   */
  const restoreAndRun = useCallback((action?: () => void) => {
    if (!action) return
    const sel = savedSelectionRef.current
    if (sel) {
      editor.chain().focus().setTextSelection(sel).run()
      savedSelectionRef.current = null
    } else {
      editor.chain().focus().run()
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        action()
      })
    })
  }, [editor])

  const handleInsertImage = useCallback(async () => {
    try {
      const file = await open({
        multiple: false,
        filters: [{
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
        }],
      })
      if (!file) return

      const pos = editor.state.selection.from
      editor.chain().focus().insertContentAt(pos, { type: 'text', text: 'Uploading... ' }).run()
      const placeholderEnd = pos + 'Uploading... '.length

      const activeFilePath = useArticleStore.getState().activeFilePath
      let fileObj: File
      if (typeof file === 'string') {
        const fileData = await readFile(file)
        const ext = file.split('.').pop() || 'png'
        const fileName = file.split('/').pop() || `image.${ext}`
        const arrayBuffer = new Uint8Array(fileData).buffer
        fileObj = new File([arrayBuffer], fileName, { type: `image/${ext}` })
      } else {
        fileObj = file
      }

      const result = await handleImageUpload(fileObj, activeFilePath)
      editor.chain().focus().deleteRange({ from: pos, to: placeholderEnd }).run()
      editor.chain().focus().insertContentAt(pos, {
        type: 'image',
        attrs: { src: result.src, alt: fileObj.name, relativeSrc: result.relativePath },
      }).run()
    } catch (error) {
      toast({
        title: t('slashCommand.imageUpload.failed'),
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }, [editor, t])

  const setLink = useCallback(() => {
    if (showLinkInput) {
      if (linkUrl === '') {
        editor.chain().focus().extendMarkRange('link').unsetLink().run()
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run()
      }
      setShowLinkInput(false)
      setLinkUrl('')
    } else {
      const previousUrl = editor.getAttributes('link').href
      setLinkUrl(previousUrl || '')
      setShowLinkInput(true)
    }
  }, [editor, linkUrl, showLinkInput])

  const historyItems: ToolbarItem[] = [
    { type: 'button', name: 'undo', icon: Undo2, action: () => editor.chain().focus().undo().run(), isActive: () => false },
    { type: 'button', name: 'redo', icon: Redo2, action: () => editor.chain().focus().redo().run(), isActive: () => false },
  ]

  const headingItems: ToolbarItem[] = [
    { type: 'button', name: 'heading1', icon: Heading1, action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), isActive: () => editor.isActive('heading', { level: 1 }) },
    { type: 'button', name: 'heading2', icon: Heading2, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), isActive: () => editor.isActive('heading', { level: 2 }) },
    { type: 'button', name: 'heading3', icon: Heading3, action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), isActive: () => editor.isActive('heading', { level: 3 }) },
  ]

  const textFormatItems: ToolbarItem[] = [
    { type: 'button', name: 'bold', icon: Bold, action: () => editor.chain().focus().toggleBold().run(), isActive: () => editor.isActive('bold') },
    { type: 'button', name: 'italic', icon: Italic, action: () => editor.chain().focus().toggleItalic().run(), isActive: () => editor.isActive('italic') },
    { type: 'button', name: 'strike', icon: Strikethrough, action: () => editor.chain().focus().toggleStrike().run(), isActive: () => editor.isActive('strike') },
    { type: 'button', name: 'underline', icon: UnderlineIcon, action: () => editor.chain().focus().toggleUnderline().run(), isActive: () => editor.isActive('underline') },
    { type: 'button', name: 'inlineCode', icon: Code, action: () => editor.chain().focus().toggleCode().run(), isActive: () => editor.isActive('code') },
    { type: 'button', name: 'highlight', icon: Highlighter, action: () => editor.chain().focus().toggleHighlight().run(), isActive: () => editor.isActive('highlight') },
  ]

  const blockItems: ToolbarItem[] = [
    { type: 'button', name: 'blockquote', icon: Quote, action: () => editor.chain().focus().toggleBlockquote().run(), isActive: () => editor.isActive('blockquote') },
    { type: 'button', name: 'bulletList', icon: List, action: () => editor.chain().focus().toggleBulletList().run(), isActive: () => editor.isActive('bulletList') },
    { type: 'button', name: 'orderedList', icon: ListOrdered, action: () => editor.chain().focus().toggleOrderedList().run(), isActive: () => editor.isActive('orderedList') },
    { type: 'button', name: 'taskList', icon: CheckSquare, action: () => editor.chain().focus().toggleTaskList().run(), isActive: () => editor.isActive('taskList') },
    { type: 'button', name: 'codeBlock', icon: Code2, action: () => editor.chain().focus().toggleCodeBlock().run(), isActive: () => editor.isActive('codeBlock') },
  ]

  const alignItems: ToolbarItem[] = [
    { type: 'button', name: 'alignLeft', icon: AlignLeft, action: () => editor.chain().focus().setTextAlign('left').run(), isActive: () => editor.isActive({ textAlign: 'left' }) },
    { type: 'button', name: 'alignCenter', icon: AlignCenter, action: () => editor.chain().focus().setTextAlign('center').run(), isActive: () => editor.isActive({ textAlign: 'center' }) },
    { type: 'button', name: 'alignRight', icon: AlignRight, action: () => editor.chain().focus().setTextAlign('right').run(), isActive: () => editor.isActive({ textAlign: 'right' }) },
  ]

  const insertItems: ToolbarItem[] = [
    { type: 'button', name: 'horizontalRule', icon: Minus, action: () => editor.chain().focus().setHorizontalRule().run(), isActive: () => false },
    { type: 'button', name: 'table', icon: Table, action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), isActive: () => editor.isActive('table') },
    { type: 'button', name: 'image', icon: ImageIcon, action: handleInsertImage, isActive: () => false },
  ]

  const groups = [
    historyItems,
    headingItems,
    textFormatItems,
    blockItems,
    alignItems,
    insertItems,
  ]

  const insertInlineMath = () => {
    editor.chain().focus().insertContent('$E=mc^2$').run()
  }

  const insertBlockMath = () => {
    editor.chain().focus().insertContent('\n$$\nx^2 + y^2 = z^2\n$$\n').run()
  }

  const insertMermaid = (type: string) => {
    const templates: Record<string, string> = {
      flowchart: '```mermaid\ngraph TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[OK]\n    B -->|No| D[Cancel]\n```',
      sequence: '```mermaid\nsequenceDiagram\n    Alice->>Bob: Hello\n    Bob-->>Alice: Hi\n```',
      gantt: '```mermaid\ngantt\n    title Plan\n    dateFormat YYYY-MM-DD\n    section Tasks\n    Task 1: 2024-01-01, 30d\n```',
      classDiagram: '```mermaid\nclassDiagram\n    class Animal {\n        +String name\n        +move()\n    }\n```',
      stateDiagram: '```mermaid\nstateDiagram-v2\n    [*] --> Active\n    Active --> Inactive\n    Inactive --> [*]\n```',
      pie: '```mermaid\npie title Distribution\n    "A": 40\n    "B": 30\n    "C": 30\n```',
      er: '```mermaid\nerDiagram\n    USER ||--o{ ORDER : places\n    ORDER ||--|{ ITEM : contains\n```',
      journey: '```mermaid\njourney\n    title User Journey\n    section Login\n      Open app: 5: User\n      Enter credentials: 3: User\n```',
    }
    editor.chain().focus().insertContent(templates[type] || templates.flowchart).run()
  }

  const triggerSearch = () => {
    const event = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
    })
    document.dispatchEvent(event)
  }

  const renderButton = (item: ToolbarItem, index: number) => {
    if (item.type === 'separator') {
      return <div key={`sep-${index}`} className="w-px h-5 bg-border mx-1" />
    }
    const Icon = item.icon
    return (
      <Tooltip key={item.name}>
        <TooltipTrigger asChild>
          <button
            className={cn(
              'p-1.5 rounded hover:bg-muted transition-colors',
              item.isActive() && 'bg-muted text-primary'
            )}
            onMouseDown={(e) => e.preventDefault()}
            onClick={item.action}
          >
            <Icon className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          <p>{t(`toolbar.${item.name}`)}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-0.5 px-3 py-1 border-b border-border bg-background shrink-0 sticky top-0 z-10 overflow-x-auto scrollbar-hide">
        {/* AI dropdown：Tooltip 不可與 Trigger 直接 asChild 合併到同一顆按鈕，否則易無法開啟選單 */}
        <DropdownMenu onOpenChange={(open) => { if (open) saveSelection() }}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0">
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="p-1.5 rounded hover:bg-muted transition-colors text-primary shrink-0"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      saveSelection()
                    }}
                  >
                    <Sparkles className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              <p>{t('toolbar.ai')}</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" sideOffset={4}>
            <DropdownMenuItem onSelect={() => restoreAndRun(onAIPolish)}>
              <Sparkles className="w-3.5 h-3.5 mr-2" />
              {t('bubbleMenu.polish')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => restoreAndRun(onAIConcise)}>
              <Minimize2 className="w-3.5 h-3.5 mr-2" />
              {t('bubbleMenu.concise')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => restoreAndRun(onAIExpand)}>
              <Maximize2 className="w-3.5 h-3.5 mr-2" />
              {t('bubbleMenu.expand')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => restoreAndRun(onAIOrganize)}>
              <ListTree className="w-3.5 h-3.5 mr-2" />
              {t('bubbleMenu.organize')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => restoreAndRun(onQuoteToChat)}>
              <MessageCircle className="w-3.5 h-3.5 mr-2" />
              {t('bubbleMenu.quoteToChat')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="w-px h-5 bg-border mx-1 shrink-0" />

        {groups.map((group, groupIndex) => (
          <div key={groupIndex} className="flex items-center gap-0.5 shrink-0">
            {groupIndex > 0 && <div className="w-px h-5 bg-border mx-1 shrink-0" />}
            {group.map((item, itemIndex) => renderButton(item, itemIndex))}
          </div>
        ))}

        {/* Link button with inline input */}
        <div className="flex items-center gap-0.5 shrink-0">
          <div className="w-px h-5 bg-border mx-1 shrink-0" />
          {showLinkInput ? (
            <div className="flex items-center gap-1 shrink-0">
              <input
                type="url"
                placeholder={t('bubbleMenu.linkPlaceholder')}
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setLink()
                  else if (e.key === 'Escape') { setShowLinkInput(false); setLinkUrl('') }
                }}
                className="w-40 px-2 py-0.5 text-sm bg-muted rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
              <button className="p-1 rounded hover:bg-muted text-xs shrink-0" onClick={setLink}>{t('bubbleMenu.confirm')}</button>
              <button className="p-1 rounded hover:bg-muted text-xs shrink-0" onClick={() => { setShowLinkInput(false); setLinkUrl('') }}>{t('bubbleMenu.cancel')}</button>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    'p-1.5 rounded hover:bg-muted transition-colors',
                    editor.isActive('link') && 'bg-muted text-primary'
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={setLink}
                >
                  <Link className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                <p>{t('toolbar.link')}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* More insert dropdown */}
        <div className="shrink-0">
          <div className="w-px h-5 bg-border mx-1 shrink-0 inline-block align-middle" />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    className="p-1.5 rounded hover:bg-muted transition-colors shrink-0"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                <p>{t('toolbar.moreInsert')}</p>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" sideOffset={4}>
              <DropdownMenuItem onClick={insertInlineMath}>
                <Sigma className="w-3.5 h-3.5 mr-2" />
                {t('toolbar.inlineMath')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={insertBlockMath}>
                <Sigma className="w-3.5 h-3.5 mr-2" />
                {t('toolbar.blockMath')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <GitBranch className="w-3.5 h-3.5 mr-2" />
                  {t('toolbar.mermaid')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => insertMermaid('flowchart')}>
                    {t('toolbar.mermaidFlowchart')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => insertMermaid('sequence')}>
                    {t('toolbar.mermaidSequence')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => insertMermaid('gantt')}>
                    {t('toolbar.mermaidGantt')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => insertMermaid('classDiagram')}>
                    {t('toolbar.mermaidClass')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => insertMermaid('stateDiagram')}>
                    {t('toolbar.mermaidState')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => insertMermaid('pie')}>
                    {t('toolbar.mermaidPie')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => insertMermaid('er')}>
                    {t('toolbar.mermaidER')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => insertMermaid('journey')}>
                    {t('toolbar.mermaidJourney')}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={triggerSearch}>
                <Search className="w-3.5 h-3.5 mr-2" />
                {t('toolbar.searchReplace')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  )
}