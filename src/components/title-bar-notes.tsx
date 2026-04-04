'use client'

import React from 'react'
import { Search, PanelLeft, PanelRight, SquarePen } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useSidebarStore } from '@/stores/sidebar'
import useSettingStore from '@/stores/setting'
import useArticleStore from '@/stores/article'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ControlText } from '@/app/core/main/mark/control-text'
import { ControlRecording } from '@/app/core/main/mark/control-recording'
import { ControlScan } from '@/app/core/main/mark/control-scan'
import { ControlImage } from '@/app/core/main/mark/control-image'
import { ControlLink } from '@/app/core/main/mark/control-link'
import { ControlFile } from '@/app/core/main/mark/control-file'
import { ControlTodo } from '@/app/core/main/mark/control-todo'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import { DraggableToolbarItem } from './draggable-toolbar-item'
import { useToolbarShortcuts } from '@/hooks/use-toolbar-shortcuts'

interface NotesToolbarProps {
  onSearchClick?: () => void
}

export function NotesToolbar({ onSearchClick }: NotesToolbarProps) {
  const t = useTranslations()
  const { leftSidebarVisible, centerPanelVisible, rightSidebarVisible, toggleLeftSidebar, toggleCenterPanel, toggleRightSidebar } = useSidebarStore()
  const { recordToolbarConfig, setRecordToolbarConfig } = useSettingStore()
  const { activeFilePath } = useArticleStore()
  const { isModifierPressed } = useToolbarShortcuts()

  // 检查关闭面板后是否会导致"仅左"状态或无面板状态
  const wouldCauseLeftOnly = (currentVisible: boolean, panel: 'left' | 'center' | 'right') => {
    if (!currentVisible) return false
    const visibleCount = [leftSidebarVisible, centerPanelVisible, rightSidebarVisible].filter(Boolean).length
    if (visibleCount === 1) return true
    if (visibleCount === 2) {
      if (panel === 'center' && leftSidebarVisible && !rightSidebarVisible) return true
      if (panel === 'right' && leftSidebarVisible && !centerPanelVisible) return true
    }
    return false
  }

  const getFileName = () => {
    if (!activeFilePath) return ''
    const parts = activeFilePath.split('/')
    return parts[parts.length - 1]
  }

  const searchPlaceholder = getFileName() || t('navigation.searchPlaceholder')

  // 拖拽传感器配置
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    })
  )

  // 处理拖拽结束
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = recordToolbarConfig.findIndex((item) => item.id === active.id)
      const newIndex = recordToolbarConfig.findIndex((item) => item.id === over.id)
      const newItems = arrayMove(recordToolbarConfig, oldIndex, newIndex)
      const updatedItems = newItems.map((item, index) => ({
        ...item,
        order: index
      }))
      setRecordToolbarConfig(updatedItems)
    }
  }

  return (
    <>
      {/* 左侧记录工具栏按钮 */}
      <div id="onboarding-target-record-toolbar" className="flex items-center gap-0.5 px-2 shrink-0" data-tauri-drag-region="false">
        <TooltipProvider>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={recordToolbarConfig.filter(item => item.enabled).map(item => item.id)}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex">
                {recordToolbarConfig
                  .filter(item => item.enabled)
                  .sort((a, b) => a.order - b.order)
                  .map((item, index) => {
                    const renderToolbarItem = () => {
                      switch (item.id) {
                        case 'text':
                          return <ControlText />
                        case 'recording':
                          return <ControlRecording />
                        case 'scan':
                          return <ControlScan />
                        case 'image':
                          return <ControlImage />
                        case 'link':
                          return <ControlLink />
                        case 'file':
                          return <ControlFile />
                        case 'todo':
                          return <ControlTodo />
                        default:
                          return null
                      }
                    }

                    return (
                      <DraggableToolbarItem
                        key={item.id}
                        id={item.id}
                        shortcutNumber={index + 1}
                        showShortcut={isModifierPressed && index < 9}
                      >
                        {renderToolbarItem()}
                      </DraggableToolbarItem>
                    )
                  })}
              </div>
            </SortableContext>
          </DndContext>
        </TooltipProvider>
      </div>

      {/* 中间搜索输入框 */}
      <div className="flex-1 flex items-center justify-center px-4 min-w-[200px] max-w-[600px] mx-auto" data-tauri-drag-region>
        <div
          className="relative w-full h-6 max-w-md group cursor-pointer flex justify-center items-center border rounded-sm"
          onClick={() => onSearchClick?.()}
          data-tauri-drag-region="false"
        >
          <Search className="size-3.5 text-muted-foreground" />
          <div className="pl-2 text-xs text-muted-foreground transition-colors">
            <span className="truncate">{searchPlaceholder}</span>
          </div>
        </div>
      </div>

      {/* Sidebar 切换按钮 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8',
              leftSidebarVisible
                ? 'bg-primary/10 text-primary hover:bg-primary/20'
                : 'text-muted-foreground hover:text-foreground',
              wouldCauseLeftOnly(leftSidebarVisible, 'left') && 'cursor-not-allowed opacity-50'
            )}
            onClick={() => {
              if (!wouldCauseLeftOnly(leftSidebarVisible, 'left')) {
                toggleLeftSidebar()
              }
            }}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{leftSidebarVisible ? t('navigation.hideLeftSidebar') : t('navigation.showLeftSidebar')}</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8',
              centerPanelVisible
                ? 'bg-primary/10 text-primary hover:bg-primary/20'
                : 'text-muted-foreground hover:text-foreground',
              wouldCauseLeftOnly(centerPanelVisible, 'center') && 'cursor-not-allowed opacity-50'
            )}
            onClick={() => {
              if (!wouldCauseLeftOnly(centerPanelVisible, 'center')) {
                toggleCenterPanel()
              }
            }}
          >
            <SquarePen className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{centerPanelVisible ? t('navigation.hideCenterPanel') : t('navigation.showCenterPanel')}</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8',
              rightSidebarVisible
                ? 'bg-primary/10 text-primary hover:bg-primary/20'
                : 'text-muted-foreground hover:text-foreground',
              wouldCauseLeftOnly(rightSidebarVisible, 'right') && 'cursor-not-allowed opacity-50'
            )}
            onClick={() => {
              if (!wouldCauseLeftOnly(rightSidebarVisible, 'right')) {
                toggleRightSidebar()
              }
            }}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{rightSidebarVisible ? t('navigation.hideRightSidebar') : t('navigation.showRightSidebar')}</p>
        </TooltipContent>
      </Tooltip>
    </>
  )
}
