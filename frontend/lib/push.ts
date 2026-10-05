import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { api } from './api';

// The web app is served under a context root (see app.json experiments.baseUrl),
// and the service worker must be registered inside it.
const BASE: string = (
  (process.env.EXPO_BASE_URL as string | undefined) ??
  ((Constants.expoConfig?.experiments as { baseUrl?: string } | undefined)?.baseUrl ?? '')
).replace(/\/$/, '');

const SW_URL = `${BASE}/sw.js`;
const SW_SCOPE = `${BASE}/`;

/** Web Push and service workers only exist in secure contexts (https or localhost). */
export function insecureOrigin(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && !window.isSecureContext;
}

export function pushSupported(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** iOS only delivers web push to apps added to the home screen. */
export function needsHomeScreenInstall(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone =
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches;
  return ios && !standalone;
}

function urlB64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function isPushEnabledOnThisDevice(): Promise<boolean> {
  try {
    return (await currentSubscription()) !== null;
  } catch {
    return false;
  }
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('이 브라우저는 푸시 알림을 지원하지 않습니다');
  if (needsHomeScreenInstall()) {
    throw new Error('iPhone에서는 공유 버튼 → "홈 화면에 추가"로 앱을 설치한 뒤 설치된 앱에서 켜주세요');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('알림 권한이 허용되지 않았습니다. 브라우저 설정에서 알림을 허용해 주세요');
  }

  const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  await navigator.serviceWorker.ready;

  const { public_key } = await api<{ public_key: string }>('/api/push/vapid-public-key', { auth: false });
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(public_key) as BufferSource,
    }));

  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint } });
}
