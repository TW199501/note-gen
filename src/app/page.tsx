'use client'
import { Store } from '@tauri-apps/plugin-store'
import { useRouter  } from 'next/navigation'
import { useEffect, useState } from 'react'
import { checkIsTauri, isMobileDevice } from '@/lib/check'

export default function Home() {
  const router = useRouter()
  const [notTauri, setNotTauri] = useState(false)

  async function init() {
    if (!checkIsTauri()) {
      setNotTauri(true)
      return
    }

    const store = await Store.load('store.json')
    let currentPage = await store.get<string>('currentPage')
    
    if (isMobileDevice()) {
      if (currentPage?.includes('/mobile')) {
        router.push(currentPage || '/mobile/chat')
      } else {
        router.push('/mobile/chat')
      }
    } else {
      if (currentPage === '/core/article' || currentPage === '/core/record') {
        currentPage = '/core/main'
        await store.set('currentPage', '/core/main')
        await store.save()
      }
      
      if (!currentPage?.includes('/mobile')) {
        router.push(currentPage || '/core/main')
      } else {
        router.push('/core/main')
      }
    }
  }
  useEffect(() => {
    init()
  }, [])

  if (notTauri) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui' }}>
        <p>Please run with <code>pnpm tauri dev</code> to start the full app.</p>
      </div>
    )
  }

  return null
}
