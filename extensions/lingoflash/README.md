# LingoFlash Browser Extension v1.1.0

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
- The only permanent host permission is the exact LingoFlash production origin, used by `app-bridge.js` to receive the result from the authenticated app tab.
- Jobs are short-lived and stored in `storage.session` when supported, otherwise `storage.local` with explicit cleanup.
- Incognito use is disabled.

## Build

```bash
npm run extension:check
npm run extension:build
```

Output:

- `artifacts/browser-extension/lingoflash/`
- `artifacts/browser-extension/lingoflash-extension-v1.1.0.zip`

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
