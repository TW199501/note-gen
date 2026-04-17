'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import useSettingStore from '@/stores/setting'
import {
  Item,
  ItemGroup,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from '@/components/ui/item'
import {
  BotMessageSquare,
  FileText,
  Lightbulb,
  FolderOpen,
  Zap,
  GitCommit,
  PenTool,
  ChartScatter,
  ListOrdered,
  ScanText,
  Volume2,
  Mic,
  AudioLines,
} from 'lucide-react'
import { ModelSelect } from '../components/model-select'
import { ModelStatusDot } from '../components/model-status-dot'

interface ModelItem {
  modelKey: string
  icon: React.ReactNode
  titleKey: string
  descKey: string
}

interface ModelGroup {
  label: string
  items: ModelItem[]
}

export function ModelAssignment() {
  const t = useTranslations('settings')
  const { checkAllModelStatus } = useSettingStore()

  useEffect(() => {
    void checkAllModelStatus()
  }, [])

  const groups: ModelGroup[] = [
    {
      label: t('ai.assignment.chat'),
      items: [
        { modelKey: 'primaryModel', icon: <BotMessageSquare className="size-4" />, titleKey: 'chat.primaryModel.model.title', descKey: 'chat.primaryModel.model.desc' },
        { modelKey: 'condense', icon: <FileText className="size-4" />, titleKey: 'chat.condense.model.title', descKey: 'chat.condense.model.desc' },
        { modelKey: 'inspiration', icon: <Lightbulb className="size-4" />, titleKey: 'chat.inspiration.model.title', descKey: 'chat.inspiration.model.desc' },
        { modelKey: 'organize', icon: <FolderOpen className="size-4" />, titleKey: 'ai.assignment.organize.title', descKey: 'ai.assignment.organize.desc' },
      ],
    },
    {
      label: t('ai.assignment.editor'),
      items: [
        { modelKey: 'completion', icon: <Zap className="size-4" />, titleKey: 'editor.completion.model.title', descKey: 'editor.completion.model.desc' },
        { modelKey: 'commit', icon: <GitCommit className="size-4" />, titleKey: 'editor.commit.model.title', descKey: 'editor.commit.model.desc' },
      ],
    },
    {
      label: t('ai.assignment.record'),
      items: [
        { modelKey: 'markDesc', icon: <PenTool className="size-4" />, titleKey: 'record.model.markDesc.title', descKey: 'record.model.markDesc.desc' },
      ],
    },
    {
      label: t('ai.assignment.rag'),
      items: [
        { modelKey: 'embedding', icon: <ChartScatter className="size-4" />, titleKey: 'defaultModel.options.embedding.title', descKey: 'defaultModel.options.embedding.desc' },
        { modelKey: 'reranking', icon: <ListOrdered className="size-4" />, titleKey: 'defaultModel.options.reranking.title', descKey: 'defaultModel.options.reranking.desc' },
      ],
    },
    {
      label: t('ai.assignment.vision'),
      items: [
        { modelKey: 'imageMethod', icon: <ScanText className="size-4" />, titleKey: 'imageMethod.vlm.title', descKey: 'imageMethod.vlm.desc' },
      ],
    },
    {
      label: t('ai.assignment.voice'),
      items: [
        { modelKey: 'tts', icon: <Volume2 className="size-4" />, titleKey: 'audio.tts.model.title', descKey: 'audio.tts.model.desc' },
        { modelKey: 'stt', icon: <Mic className="size-4" />, titleKey: 'audio.stt.model.title', descKey: 'audio.stt.model.desc' },
        { modelKey: 'audio', icon: <AudioLines className="size-4" />, titleKey: 'ai.assignment.audio.title', descKey: 'ai.assignment.audio.desc' },
      ],
    },
  ]

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.label}>
          <h3 className="text-sm font-medium text-foreground mb-3">{group.label}</h3>
          <ItemGroup className="gap-2">
            {group.items.map((item) => (
              <Item key={item.modelKey} className="max-md:flex-col max-md:items-start" variant="outline">
                <ModelStatusDot modelKey={item.modelKey} />
                <ItemMedia variant="icon">{item.icon}</ItemMedia>
                <ItemContent>
                  <ItemTitle>{t(item.titleKey)}</ItemTitle>
                  <ItemDescription>{t(item.descKey)}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ModelSelect modelKey={item.modelKey} />
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </div>
      ))}
    </div>
  )
}
