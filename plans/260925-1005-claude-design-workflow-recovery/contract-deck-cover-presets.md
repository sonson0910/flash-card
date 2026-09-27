---
title: "Contract — custom deck cover presets"
status: proposed; owner approval required before implementation
---

# Custom deck cover presets

`DlgDeckNew` shows five selectable covers. The current custom-deck profile stores only `{ decks: string[] }`, and cards store only the deck name in `customDeck`; rendering a selected cover after sign-in requires profile metadata. This contract adds fixed visual presets, not uploaded images or card fields.

## Current trace

- `LibraryDialogOverlays.tsx` renders the real `DeckCreationDialog` with name/suggestions and status, but no cover choice.
- `customDecks.ts` normalizes deck names and caps the collection at 100.
- `ownerLibrarySessionFirebaseAdapter.ts` subscribes to `users/{uid}/profile/custom_decks` and creates/deletes names with one merged `setDoc` using `arrayUnion`/`arrayRemove`.
- `firestore.rules` allows only the `decks` field on that profile document. Older deployed clients can still write only `decks`.

## Proposed document shape and behavior

Keep `decks` and `CardData.customDeck` unchanged. Add an optional map to the **same** profile document:

```ts
type CoverPreset = 'aurora' | 'violet' | 'amber' | 'slate' | 'moss';
type CustomDeckProfile = {
  decks: string[];
  coverPresets?: Record<string, CoverPreset>;
};
```

Before storage and key generation, normalize a deck name with the existing trim/control-character/128-code-unit limit, then make the result well-formed Unicode. A truncation beside an astral character becomes the replacement character consistently in both `decks` and the key. The map key is `d_` followed by base64url of the UTF-8 bytes of that final normalized name. This avoids reserved Firestore field names, supports punctuation, and round-trips through Firestore's string encoding. A preset ID maps to theme-specific colors/monogram treatment; the five Canvas light and dark swatches are two presentations of the same five choices. Existing decks or decks created by older clients without an entry use a deterministic default cover. Only active names in `decks` are rendered, so an orphaned map entry from an older client's deletion is ignored.

| Stored ID | Classic light swatch | Classic dark swatch |
| --- | --- | --- |
| `aurora` | Terracotta | Aurora |
| `violet` | Moss | Violet |
| `amber` | Gold | Amber |
| `slate` | Ink | Slate |
| `moss` | Linen | Moss |

Crystal themes use the same selection order with their own token treatments. The fallback for a missing or invalid preset is always `aurora`; it is not recomputed from theme, deck order or a mutable hash. The image-free monogram is the first displayed character of the deck name, as in the Canvas. The stored ID represents the selected swatch position across themes, not a literal color name in every theme.

The creation dialog chooses one preset and previews it. A new client creates the name and its encoded cover key in **one profile transaction**: read the current profile document, reject a duplicate name or the existing 100-deck limit, prune map keys absent from the current `decks`, then write the new `decks` and `coverPresets` together. The transaction's fresh read and retry prevent pruning a concurrently recreated deck's cover; concurrent creates of distinct names retain both covers. This adds **one document read per new-client deck creation** to the existing single write; transaction contention can retry the read. A new client deletes the name and its preset in **one profile update** using a `FieldPath` for the encoded map key. Existing card-assignment clearing remains unchanged. Cover editing after creation is outside this contract; the Canvas only exposes the creation choice. Local owner-scoped cache and the current profile subscription carry the selected preset with the names. Account switch clears the previous owner's covers.

Rules must accept absent `coverPresets` for old profiles and old clients, and validate a present value as a map with at most 1,000 entries, encoded-key format and values from the five-ID enum. Rules cannot require map keys to equal `decks`, because an old client may delete a deck without deleting its preset. Rendering must never display orphaned entries; recreating a name replaces its existing preset. Rules must continue to reject unknown top-level fields and retain the migration fence. The 1 MiB Firestore document limit still applies.

The owner-scoped local cache migrates from version 1 `{ ownerId, decks }` to version 2 `{ ownerId, decks, coverPresets }`. Its parser accepts version 1 and supplies default covers, while serialization writes version 2. Cache and live subscription data are always scoped to the active owner; sign-out/account switch drops the previous owner's map.

## Firestore cost

| Action | Existing | With this contract | Incremental |
| --- | --- | --- | --- |
| Hydrate decks | One `onSnapshot` subscription on `profile/custom_decks` | Same subscription, larger document payload | **0 document reads/subscriptions** |
| Create deck | One merged profile write | One profile transaction read + one write; contention may retry the read | **+1 document read normally, +0 writes/queries** |
| Delete deck | Existing card-assignment work + one merged profile write | Same card-assignment work + one profile write | **0 reads/writes/queries** |
| Assign card to deck | Existing card patch | Same card patch | **0** |

No Functions callable, Storage object, index or extra card write. The Rules/schema change still requires owner approval. The new document payload is slightly larger and remains within Firestore's document limit under the existing 100-deck cap.

## Compatibility and acceptance

1. Old `{ decks }` documents render with default covers; an old client can create/delete a deck after a new client added `coverPresets` without a Rules denial.
2. Names containing dots, Unicode and `__...__` round-trip through the encoded key; truncation beside an astral character is well-formed before storage and encoding. No path-string interpolation is used for map-field deletion.
3. Concurrent creates of distinct names keep both names and covers; deleting one deck never removes another deck's cover. Recreating a name may replace its orphaned preset. An emulator test creates at the 1,000-entry cap after old-client deletion churn and verifies that the transaction prunes inactive keys, adds the new cover and stays within Rules; another test races prune with recreation of the same name.
4. Five selections persist after sign-out/in and account switch, and render across Classic/Crystal light/dark using the mapping above. A version-1 cache survives upgrade with default covers and cannot leak covers into a second account. Keyboard, focus return, reduced-motion and visual checks compare against `DlgDeckNew-{light,dark}.png` at desktop and 390px.
5. Focused deck/session tests, Firestore Rules emulator, `i18n:extract`/`i18n:check`, build/bundle and affected Chromium e2e pass.

## Approval gate

Owner approval is required before changing the profile schema or Firestore Rules. This contract chooses creation-only fixed presets and **one incremental document read per new-client deck creation** (plus possible transaction retries); it does not authorize uploaded cover images.
