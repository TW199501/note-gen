'use client';
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import useSettingStore from '@/stores/setting';

export default function BrowserHomepage() {
  const t = useTranslations('settings.editor');
  const { browserHomepage, setBrowserHomepage } = useSettingStore();

  return <Item variant="outline">
    <ItemContent>
      <ItemTitle>{t('browserHomepage')}</ItemTitle>
      <ItemDescription>{t('browserHomepageDesc')}</ItemDescription>
    </ItemContent>
    <ItemActions>
      <Input
        className="w-64 h-8 text-sm"
        value={browserHomepage}
        onChange={(e) => setBrowserHomepage(e.target.value)}
        placeholder="https://www.google.com"
      />
    </ItemActions>
  </Item>
}
