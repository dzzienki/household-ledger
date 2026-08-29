import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Custom root HTML template for Expo Router Web / PWA.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />

        <title>스마트 가계부</title>
        <meta name="application-name" content="스마트 가계부" />
        <meta name="apple-mobile-web-app-title" content="스마트 가계부" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#3B82F6" />

        {/* PWA Manifest */}
        <link rel="manifest" href="./manifest.json" />

        {/* Icons */}
        <link rel="icon" type="image/png" sizes="48x48" href="./favicon.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="./icon-192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="./icon-512.png" />
        <link rel="apple-touch-icon" href="./apple-touch-icon.png" />

        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
