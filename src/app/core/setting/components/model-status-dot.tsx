'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import useSettingStore from '@/stores/setting';

const MODEL_KEY_MAP: Record<string, string> = {
  primaryModel: 'primaryModel',
  imageMethod: 'imageMethodModel',
  completion: 'completionModel',
  markDesc: 'markDescModel',
  audio: 'audioModel',
  tts: 'audioModel',
  stt: 'sttModel',
  embedding: 'embeddingModel',
  reranking: 'rerankingModel',
  condense: 'condenseModel',
  inspiration: 'inspirationModel',
  organize: 'organizeModel',
  commit: 'commitModel',
};

function toStoreKey(modelKey: string): string {
  return MODEL_KEY_MAP[modelKey] ?? `${modelKey}Model`;
}

interface ModelStatusDotProps {
  modelKey: string;
  className?: string;
}

export function ModelStatusDot({ modelKey, className }: ModelStatusDotProps) {
  const t = useTranslations('settings.ai.status');
  const storeKey = toStoreKey(modelKey);
  const status = useSettingStore((s) => s.modelStatusMap[storeKey]);
  const errorMsg = useSettingStore((s) => s.modelStatusErrors[storeKey]);

  if (!status || status === 'idle') {
    return (
      <span
        className={cn('inline-block h-2.5 w-2.5 rounded-full bg-muted-foreground/30', className)}
      />
    );
  }

  if (status === 'checking') {
    return <Loader2 className={cn('h-3 w-3 animate-spin text-yellow-500', className)} />;
  }

  const dot = (
    <span
      className={cn(
        'inline-block h-2.5 w-2.5 rounded-full',
        status === 'ok' ? 'bg-green-500' : 'bg-red-500',
        className,
      )}
    />
  );

  const tooltipText = status === 'ok' ? t('ok') : errorMsg || t('error');

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{dot}</TooltipTrigger>
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
