import * as React from "react"
import { useEffect, useMemo, useState } from "react"
import { ModelConfig } from "../../setting/config"
import { Store } from "@tauri-apps/plugin-store"
import useSettingStore from "@/stores/setting"
import useBrowserStore from "@/stores/browser"
import { BotMessageSquare, BotOff } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Check,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { TooltipButton } from "@/components/tooltip-button"

interface GroupedModel {
  configKey: string
  configTitle: string
  model: ModelConfig
}

export function ModelSelect() {
  const [groupedModels, setGroupedModels] = useState<GroupedModel[]>([])
  const { primaryModel, setPrimaryModel, aiModelList } = useSettingStore()
  const [open, setOpen] = React.useState(false)
  const t = useTranslations('record.chat.input.modelSelect')

  async function modelSelectChangeHandler(modelId: string) {
    setPrimaryModel(modelId)
    const store = await Store.load('store.json');
    store.set('primaryModel', modelId)
    await store.save()
  }

  const { pushOverlay, popOverlay } = useBrowserStore()

  function handleSetOpen(isOpen: boolean) {
    setOpen(isOpen)
    if (isOpen) {
      pushOverlay()
    } else {
      popOverlay()
    }
  }

  const noteGenConfigKeys = useMemo(() => new Set(['note-gen-free', 'note-gen-limited']), [])

  useEffect(() => {
    if (aiModelList && aiModelList.length > 0) {
      const models: GroupedModel[] = []

      const hasUserModels = aiModelList.some(
        config => config.baseURL && !noteGenConfigKeys.has(config.key)
      )
      
      aiModelList.forEach(config => {
        if (!config.baseURL) return

        if (hasUserModels && noteGenConfigKeys.has(config.key)) return
        
        if (config.models && config.models.length > 0) {
          config.models.forEach(model => {
            if (model.modelType === 'chat' && model.model) {
              models.push({
                configKey: config.key,
                configTitle: config.title,
                model: model
              })
            }
          })
        } else {
          if ((config.modelType === 'chat' || !config.modelType) && config.model) {
            models.push({
              configKey: config.key,
              configTitle: config.title,
              model: {
                id: config.key,
                model: config.model,
                modelType: config.modelType || 'chat',
                temperature: config.temperature,
                topP: config.topP,
                voice: config.voice,
                enableStream: config.enableStream
              }
            })
          }
        }
      })
      
      setGroupedModels(models)
    }
  }, [aiModelList, noteGenConfigKeys])

  // 按配置分组模型
  const groupedByConfig = groupedModels.reduce((acc, item) => {
    if (!acc[item.configTitle]) {
      acc[item.configTitle] = []
    }
    acc[item.configTitle].push(item)
    return acc
  }, {} as Record<string, GroupedModel[]>)

  return (
    <Popover open={open} onOpenChange={handleSetOpen}>
      <PopoverTrigger asChild>
        <div className="hidden md:block">
          <TooltipButton
            icon={groupedModels.length > 0 ? <BotMessageSquare className="size-4" /> : <BotOff className="size-4" />}
            tooltipText={t('tooltip')}
            size="icon"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0">
        <Command>
          <CommandInput placeholder={t('placeholder')} className="h-9" />
          <CommandList>
            <CommandEmpty>{t('noModel')}</CommandEmpty>
            {Object.entries(groupedByConfig).map(([configTitle, models]) => (
              <CommandGroup key={configTitle} heading={configTitle}>
                {models.map((item) => (
                  <CommandItem
                    key={item.model.id}
                    value={item.model.id}
                    onSelect={(currentValue) => {
                      modelSelectChangeHandler(currentValue)
                      setOpen(false)
                    }}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{item.model.model}</span>
                    </div>
                    <Check
                      className={cn(
                        "ml-auto size-4",
                        primaryModel === item.model.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
