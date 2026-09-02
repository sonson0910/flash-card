# LingoFlash Browser Extension v1.6.3

A Manifest V3 WebExtension for Chrome-compatible browsers and Safari.

## Daily flow

1. Select an English word or short phrase (maximum 80 characters).
2. Press `Ctrl+Shift+L` (`Command+Shift+L` on macOS), use the selection context menu, or use the popup.
3. A loading card appears beside the selected text on the current page.
4. The extension starts one inactive LingoFlash worker tab. The app reuses its authenticated Firebase/App Check session, generates the complete card, and persists it through the existing intake pipeline.
5. The app sends a bounded result to the extension. The worker tab closes automatically and the translation appears inline on the original page.

The extension never switches the active tab during this flow. A visible LingoFlash tab is opened only when the user explicitly chooses **Đăng nhập / mở thư viện**, or when authentication is required and the user clicks the sign-in link.

## First-time setup

Open LingoFlash once from the extension popup and sign in. The browser keeps the normal web-app session. Later additions run in an inactive temporary tab and close automatically.

## Security

- No Firebase token, Gemini key, password, or direct Firestore credential is stored by the extension.
- Page access uses `activeTab` only after a user gesture.
- Host permissions are limited to the exact LingoFlash production origin (for `app-bridge.js`) and Google Translate's official fallback origin.
- Jobs are short-lived and stored in `storage.session` when supported, otherwise `storage.local` with explicit cleanup. Deck metadata is stricter: it uses `storage.session` only and falls back to worker memory, never `storage.local`, so browsers without session storage lose deck names after a worker/browser restart.
- Silent imports use a fresh protocol-v3 nonce. The background worker verifies the persisted job, origin, worker tab, top frame, nonce, and expiry window before the app can generate a card.
- A syntactically valid but unverified URL import can only populate the app draft; it never submits or calls `generate()` automatically.
- **Quick translate:** the selected text is sent to Google Translate (the source language is auto-detected by default) and is not saved as a flashcard.
- **Create + save:** the selected text and, when available, one nearby sentence (bounded to 500 characters) are sent through LingoFlash/Gemini to choose the intended sense and generate/save the card in the signed-in account. The sentence is treated as untrusted linguistic data, not instructions.
- The extension does not retain Firebase tokens, Gemini keys, passwords, or other login credentials.
- When the signed-in library is ready, the app sends at most 100 bounded deck names to the extension popup through the same-origin bridge. The cache uses an opaque random scope and is cleared on account change or sign-out; it contains no Firebase UID, token, password, or card content. Deck-specific saves require the current app runtime; the legacy DOM fallback refuses them instead of silently saving to the common library.
- Incognito use is disabled.
- **Floating selection icon (experimental):** off by default. It is injected only on sites you explicitly allow from the popup or options page. The optional site permission is requested only after that click; protected browser URLs and the LingoFlash app are never eligible. The selected text stays in the page until you click the icon.

Privacy policy: https://encoded-hangout-433912-h2.web.app/browser-extension-privacy.html

## Protocol v3 rollout

Deploy the Cloud Function structured-input compatibility and nonce-v3 app verifier before publishing the extension. Legacy v2 draft imports remain manual-only; legacy silent imports are rejected.

## Build

```bash
npm run extension:check
npm run extension:build
```

Output:

- `artifacts/browser-extension/lingoflash/`
- `artifacts/browser-extension/lingoflash-extension-v1.6.3.zip`

## Chrome installation

1. Build, or extract the ZIP.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the folder containing `manifest.json`.
5. Use `chrome://extensions/shortcuts` to change the shortcut.

## Safari

Run on macOS with Xcode:

```bash
npm run extension:safari
```

Then sign and enable the generated Safari Web Extension.
