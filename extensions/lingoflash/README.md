# LingoFlash Browser Extension

A single Manifest V3 WebExtension codebase for Chrome-compatible browsers and Safari.

## What it does

1. Select an English word or short phrase (up to 80 characters).
2. Press `Ctrl+Shift+L` (`Command+Shift+L` on macOS), use the selection context menu, or open the extension popup.
3. The extension opens LingoFlash with a versioned import intent in the URL fragment.
4. LingoFlash removes the fragment immediately, uses the signed-in app session, generates the complete English → Vietnamese card, reuses duplicates, and persists through the existing intake pipeline.

The extension never stores a Firebase token, Gemini key, or direct Firestore credential. It requests no broad website host permission.

## Build

From the repository root:

```bash
npm run extension:check
npm run extension:build
```

Outputs:

- Unpacked extension: `artifacts/browser-extension/lingoflash/`
- Chrome/Safari WebExtension ZIP: `artifacts/browser-extension/lingoflash-extension-v1.0.0.zip`

## Chrome installation

1. Run `npm run extension:build` and open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select `artifacts/browser-extension/lingoflash/`.
4. Open `chrome://extensions/shortcuts` to change the shortcut if needed.

When installing from the supplied ZIP, extract it first, then choose the extracted folder with **Load unpacked**.

## Safari installation for local testing

On current macOS Safari, open **Safari → Settings → Developer → Add Temporary Extension…** and select either the built ZIP or the unpacked `lingoflash` folder. Safari removes temporary extensions after 24 hours or when Safari quits.

For a signed macOS/iOS package, run this on a Mac with Xcode:

```bash
npm run extension:safari
```

The script builds the WebExtension and runs Apple’s Safari Web Extension Converter. Open the generated Xcode project, choose the signing team, run the containing app, then enable the extension under **Safari → Settings → Extensions**. Apple’s App Store Connect Safari Web Extension Packager can also package the same ZIP without Xcode.

## Configuration

The default app URL is:

`https://encoded-hangout-433912-h2.web.app/?view=library`

Use the extension settings page to point at another HTTPS deployment or an HTTP localhost URL during development.

## Import protocol

The extension places a compact JSON payload in `#lf-import=<base64url>`. The payload contains only:

```json
{
  "v": 1,
  "id": "random-operation-id",
  "text": "selected word or phrase",
  "createdAt": 1787126400000
}
```

The app accepts fresh payloads only, validates the text and operation ID, stores a pending intent in per-tab `sessionStorage`, and removes the fragment with `history.replaceState` before generating the card.
