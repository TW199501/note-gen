'use client'

import { Switch } from "@/components/ui/switch"
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { useTranslations } from 'next-intl'
import useSettingStore from '@/stores/setting'

export default function ShowEditorToolbar() {
  const t = useTranslations('settings.editor')
  const { showEditorToolbar, setShowEditorToolbar } = useSettingStore()

  return <Item variant="outline">
    <ItemContent>
      <ItemTitle>{t('showEditorToolbar')}</ItemTitle>
      <ItemDescription>{t('showEditorToolbarDesc')}</ItemDescription>
    </ItemContent>
    <ItemActions>
      <Switch
        checked={showEditorToolbar}
        onCheckedChange={setShowEditorToolbar}
      />
    </ItemActions>
  </Item>
}
