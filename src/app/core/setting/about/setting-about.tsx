'use client';
import { SettingType } from "../components/setting-base";
import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from "@/components/ui/item";
import { useTranslations } from 'next-intl';
import Updater from "./updater";
import { Bug, DownloadIcon, Github, HomeIcon, MessageSquare, SettingsIcon } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";

export function SettingAbout({id, icon}: {id: string, icon?: React.ReactNode}) {
  const t = useTranslations('settings.about');

  // TODO: 替換為自己的網站和 GitHub repo
  const items: { url: string; title: string; desc?: string; icon: React.ReactNode; buttonName: string }[] = [
  ]

  return (
    <SettingType id={id} icon={icon} title={t('title')} desc={t('desc')}>
      <Updater />
      <ItemGroup className="gap-4 pt-8">
        {
          items.map(item => <AboutItem key={item.url} {...item} />)
        }
      </ItemGroup>
    </SettingType>
  )
}

function AboutItem({url, title, desc, icon, buttonName}: {url: string, title: string, desc?: string, icon?: React.ReactNode, buttonName?: string}) {
  const openInBrowser = () => {
    open(url);
  }
  return <Item variant="outline">
    <ItemMedia variant="icon">{icon}</ItemMedia>
    <ItemContent>
      <ItemTitle>{title}</ItemTitle>
      {desc && <ItemDescription>{desc}</ItemDescription>}
    </ItemContent>
    <ItemActions>
      <Button variant="outline" onClick={openInBrowser}>{buttonName}</Button>
    </ItemActions>
  </Item>
}
