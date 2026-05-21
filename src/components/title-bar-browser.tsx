'use client'

import { TabStrip } from '@/app/core/main/browser/tab-strip'

/** Title-bar slot for browser mode. Hosts the per-tab strip, sitting between
 *  the traffic-light padding on the left and the common app buttons on the
 *  right. Page-content actions (extract text / screenshot) live one row
 *  down in BrowserNavBar — keep this slot for tabs only. */
export function BrowserToolbar() {
  return <TabStrip />
}
