import { loadSdk } from './store/firebase-sdk.js';

/* 기기/브라우저 도우미: 파일 저장, 복사, iOS·설치형 앱 판별, 푸시 가능 여부 */
export const Platform = {
  async init() {},
  canSaveFile() { return typeof document !== 'undefined' && typeof Blob !== 'undefined'; },
  /* 실제 다운로드: Blob → <a download> */
  saveFile(filename, blob) {
    return new Promise((resolve, reject) => {
      try {
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
        document.body.appendChild(a); a.click();
        setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {} }, 4000);
        resolve(true);
      } catch (e) { reject({ code: 'unsupported', message: String(e && e.message || e) }); }
    });
  },
  async copy(text, fallbackEl) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (e) {}
    try { if (fallbackEl) { fallbackEl.hidden = false; fallbackEl.focus(); fallbackEl.select(); return !!document.execCommand('copy'); } } catch (e) {}
    return false;
  },
  isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); },
  isStandalone() { return (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; },
  iosVersion() { const m = navigator.userAgent.match(/OS (\d+)_(\d+)/); return m ? +m[1] + m[2] / 10 : null; },
  /* 'unsupported' | 'ios-install-first' | 'default' | 'granted' | 'denied'
   * 부팅할 때 미리 계산해 두세요 (탭 핸들러 안에서 await 하면 iOS 에서 막혀요). */
  async pushState() {
    if (!('serviceWorker' in navigator) || typeof Notification === 'undefined') return Platform.isIOS() && !Platform.isStandalone() ? 'ios-install-first' : 'unsupported';
    if (Platform.isIOS() && !Platform.isStandalone()) return 'ios-install-first';
    try { const m = await loadSdk('messaging'); if (!(await m.isSupported())) return 'unsupported'; } catch (e) { return 'unsupported'; }
    return Notification.permission;
  },
  platformName() { return Platform.isIOS() ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : /Mobi/.test(navigator.userAgent) ? 'other' : 'desktop'; }
};
