import { Alert, Platform } from 'react-native';

/**
 * Cross-platform dialogs.
 *
 * react-native-web's `Alert.alert` is a no-op (`static alert(){}`), so on the web
 * build native Alert calls silently do nothing — messages never show and, worse,
 * confirmation callbacks never fire (delete/remove buttons appear dead). These
 * helpers fall back to the browser's `window.alert` / `window.confirm` on web and
 * use the real `Alert` on native.
 */

function isWeb(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

/** Show an informational message (errors, success). */
export function notify(title: string, message?: string): void {
  if (isWeb()) {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

/** Ask the user to confirm; resolves true if confirmed, false if cancelled/dismissed. */
export function confirmAsync(
  title: string,
  message?: string,
  opts: { confirmText?: string; cancelText?: string; destructive?: boolean } = {},
): Promise<boolean> {
  const { confirmText = '확인', cancelText = '취소', destructive = false } = opts;

  if (isWeb()) {
    return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  }

  return new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
        {
          text: confirmText,
          style: destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
