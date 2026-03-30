import { platform } from "@tauri-apps/plugin-os";

let cachedResult: boolean | null = null;
let cachedTauriResult: boolean | null = null;

// 检查是否在 Tauri 环境中运行（不调用任何 Tauri API，纯属性检测）
export function checkIsTauri(): boolean {
  if (cachedTauriResult !== null) {
    return cachedTauriResult;
  }

  cachedTauriResult =
    typeof window !== 'undefined' &&
    typeof (window as any).__TAURI_INTERNALS__ === 'object';
  return cachedTauriResult;
}

export function isMobileDevice() {
  if (cachedResult !== null) {
    return cachedResult;
  }

  if (!checkIsTauri()) {
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      const userAgent = navigator.userAgent.toLowerCase();
      cachedResult = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
      return cachedResult;
    }
    cachedResult = false;
    return false;
  }

  try {
    const platformName = platform();
    cachedResult = platformName === 'android' || platformName === 'ios';
    return cachedResult;
  } catch {
    cachedResult = false;
    return false;
  }
}
