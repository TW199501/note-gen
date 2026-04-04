import {getRequestConfig} from 'next-intl/server';

// 支持的语言列表
export const locales = ['en', 'zh', 'ja', 'pt-BR', 'zh-TW'];
export const defaultLocale = 'zh';

export default getRequestConfig(async ({requestLocale}) => {
  const locale = (await requestLocale) || defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  };
});
