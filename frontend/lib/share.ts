import { Platform, Share } from 'react-native';
import { API_URL } from './api';

export function getInviteUrl(code: string): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    const origin = window.location.origin;
    const pathname = window.location.pathname.startsWith('/household-ledger')
      ? '/household-ledger'
      : '';
    return `${origin}${pathname}/invite?code=${encodeURIComponent(code)}`;
  }
  // Mobile fallback or API_URL based
  const baseUrl = API_URL.replace(/\/api\/?$/, '');
  return `${baseUrl}/invite?code=${encodeURIComponent(code)}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback for web without clipboard API or other environments
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    }
    return false;
  } catch {
    return false;
  }
}

export async function shareInviteLink({
  ledgerName,
  inviterName,
  code,
}: {
  ledgerName: string;
  inviterName?: string;
  code: string;
}): Promise<void> {
  const url = getInviteUrl(code);
  const message = `[가계부 초대]\n${
    inviterName ? `${inviterName}님이 ` : ''
  }'${ledgerName}' 가계부에 초대했습니다!\n\n아래 링크를 눌러 가계부에 참여하세요:\n${url}`;

  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && (navigator as any).share) {
    try {
      await (navigator as any).share({
        title: `${ledgerName} 가계부 초대`,
        text: message,
        url,
      });
      return;
    } catch (err) {
      // If user cancelled or not supported, continue to fallback
      if ((err as Error).name === 'AbortError') return;
    }
  }

  // React Native Share / Web fallback
  try {
    await Share.share(
      {
        title: `${ledgerName} 가계부 초대`,
        message,
        url,
      },
      {
        dialogTitle: `${ledgerName} 가계부 초대 링크 공유`,
      },
    );
  } catch {
    // If share fails, copy to clipboard as fallback
    await copyToClipboard(url);
  }
}
