'use client'
import { Toaster } from "@/components/ui/toaster"
import "./globals.css";
import 'react-photo-view/dist/react-photo-view.css';
import { Suspense, useEffect } from "react";
import { NextIntlProvider } from "@/components/providers/NextIntlProvider";
import Script from "next/script";
import { getSyncPushQueue } from "@/lib/sync/sync-push-queue";
import { ConsoleFilter } from "@/components/console-filter";
import { AppContextMenu } from "@/components/app-context-menu";

// Wrapper that mounts the global app-level context menu alongside the page.
// React 19's stricter key-warning treats `{children}` mixed with a static
// element as a key-less list, so we return an explicitly-keyed array — each
// element gets a stable string key and React stops complaining about
// IntlProvider/RootLayout children. The Fragment around `{children}` keeps
// the original page tree intact.
import { Fragment } from "react";
function PageWithAppContextMenu({ children }: { children: React.ReactNode }) {
  return [
    <Fragment key="page">{children}</Fragment>,
    <AppContextMenu key="app-context-menu" />,
  ];
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 初始化同步推送队列
  useEffect(() => {
    getSyncPushQueue()
  }, [])

  return (
    <>
      <html lang="en" suppressHydrationWarning>
        <head>
          {/* 移动端视口设置 */}
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover, height=device-height"
          />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          {/* Define isSpace function globally to fix markdown-it issues with Next.js + Turbopack
          https://github.com/markdown-it/markdown-it/issues/1082#issuecomment-2749656365 */}
          <Script id="markdown-it-fix" strategy="beforeInteractive">
            {`
              if (typeof window !== 'undefined' && typeof window.isSpace === 'undefined') {
                window.isSpace = function(code) {
                  return code === 0x20 || code === 0x09 || code === 0x0A || code === 0x0B || code === 0x0C || code === 0x0D;
                };
              }
            `}
          </Script>
        </head>
        <body suppressHydrationWarning>
          <ConsoleFilter />
          <Suspense>
            <NextIntlProvider>
              <PageWithAppContextMenu>{children}</PageWithAppContextMenu>
            </NextIntlProvider>
          </Suspense>
          <Toaster />
        </body>
      </html>
    </>
  );
}
