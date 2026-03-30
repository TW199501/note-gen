'use client';
import { UserRoundCog } from "lucide-react"
import { SettingType } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import ShowUndoRedo from './show-undo-redo';
import ShowEditorToolbar from './show-editor-toolbar';
import CenteredContent from './centered-content';
import Outline from './outline';
import BrowserHomepage from './browser-homepage';

export default function EditorSettingPage() {
  const t = useTranslations('settings.editor');
  return <SettingType id="editorSetting" icon={<UserRoundCog />} title={t('title')} desc={t('desc')}>
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{t('interfaceSettings')}</h3>
      <CenteredContent />
      <Outline />
      <ShowUndoRedo />
      <ShowEditorToolbar />
      <h3 className="text-lg font-semibold mt-6">{t('browserSettings')}</h3>
      <BrowserHomepage />
    </div>
  </SettingType>
}
