# Phase 04: Entitlements, operator grant, purchase intent (gateway deferred)

Effort: 2d (red team #10, #13: intent callable moved here, fixed-duration grant, revoke, audit trail,
target restriction, client-readable offer). Blocked by: 02 (plan summary schema). Release: R2 (G2).

The owner's decision of 2026-09-23 stands: **no payment gateway in the pilot.** Pro is granted by
the operator; willingness to pay is measured by recorded purchase intent and interviews. The
gateway, orders, checkout, webhook and refunds are listed under "Deferred until business
registration" and are not built in the pilot.

## Context

- R5: Pro VN 79,000 VND (net of VAT) for one month, no auto-renewal, a server-side entitlement
  record with expiry. GPT §B9: never trust a client "paid" signal; a minimal operator tool is
  acceptable for a small cohort.
- No entitlement or Pro code exists (search for `entitlement|isPro|subscription` in `src` and
  `functions/src` finds none).
- Admin operator scripts live in `functions/src/*Operator.ts` and validate every env value and a
  confirmation string before creating an Admin client. The existing one seals the production id
  (`functions/src/legacyLibraryMigrationOperator.ts:19-34`, `PROJECT_ID = 'encoded-hangout-433912-h2'`
  at `:24`), so a copy cannot run against staging (red team #13).
- The client cannot read `_serviceConfig/pilot` (default deny, `firestore.rules:6-7`), so without a
  server path the dialog would hardcode the Pro quota and price (red team #13).
- G2 is on 10-02, before phase 05 ships on 10-07, so `purchase_intent` needs its own sink here
  (red team #10).

## Requirements

1. **Entitlement** `users/{uid}/entitlements/{entitlementId}` (server-only):
   `{ tier: 'pro', source: 'operator', startsAt, expiresAt, status: 'active' | 'revoked', reason,
   createdAt, revokedAt }`. Duration is always `proDurationDays` from config; there is **no
   stacking and no custom day count** (red team #13), so each `entitlementId` maps to one fixed quota
   window `pro-{entitlementId}` (phase 02). Every entitlement write updates `users/{uid}/profile/plan`
   (phase 02 schema) in the same transaction.
2. **Operator tool** `functions/src/pilotOperator.ts` (red team #13), modes:
   - `grant` (`uid`, `reason`): refuses if an active, unexpired entitlement exists; otherwise
     creates one and sets the plan.
   - `revoke` (`uid`, `reason`): sets the active entitlement `revoked` with `revokedAt`, and in the
     same transaction deletes the plan summary (Free from now); usage in the Pro window stays for
     the record. To extend a learner, the operator revokes and grants again, which opens a new
     window.
   - `status` (`uid`): plan, entitlements, current usage and allowance counters.
   - Phase 06 adds `resume-deletion`.
   Requires `PILOT_OPERATOR_CONFIRMATION` equal to `mode:target`, like the migration operator.
3. **Target restriction (red team #13):** the tool accepts only the production project and
   database (`encoded-hangout-433912-h2`, `firestoreDatabaseId` from `firebase-applet-config.json`)
   or the staging project `sonflash-staging-20260906` and its database, chosen by an explicit
   `PILOT_TARGET=production|staging`; any other combination exits before creating an Admin client.
   The phase 01 cost report and phase 05 metrics operator reuse the same target check.
4. **Audit trail (red team #13):** every mutating mode writes `operator_audit/{autoId}`
   `{ mode, pid, reason, target, operator (OS user), at, result }` (pid from the pseudonym function
   in `functions/src/analyticsEvents.ts`, requirement 6, so the record survives account deletion
   without a uid).
5. **`getPilotOffer` callable (red team #13):** signed-in only, returns
   `{ proMonthlyAiCards, displayPriceVnd, proDurationDays }` from the cached config. Nothing else
   from `_serviceConfig/pilot` reaches a client.
6. **`recordPurchaseIntent` callable (red team #10):** signed-in only, rate limit 5/hour/owner, body
   `{ trigger: 'quota' | 'menu' }`; writes one `purchase_intent` event with props
   `{ trigger, offerId: 'pro-vn-30d-v1', displayPriceVnd }` into `analytics_events` through the
   minimal writer this phase creates in `functions/src/analyticsEvents.ts` (pseudonym + writer +
   this one schema). Phase 05 extends the same module; there is one event table.
7. **Client:** lazy `UpgradeDialog` opened from the quota-exhausted state and the account menu. It
   calls `getPilotOffer` and shows what Pro gives (`proMonthlyAiCards` AI cards for
   `proDurationDays` days, same card quality as Free), the final price `displayPriceVnd` (VAT
   included), no auto-renewal, and links to terms. The only action is "Đăng ký mua khi mở bán",
   which calls `recordPurchaseIntent` and says the founder will contact the learner. No payment
   data is collected and no fake checkout is shown. If `displayPriceVnd` is null the dialog shows no
   price, and G2 is not go until the accountant's answer sets it.

## Files

- Create `functions/src/entitlements.ts` (grant and revoke transactions with the plan summary).
- Create `functions/src/pilotOperator.ts` (modes above, target check, audit writes).
- Create `functions/src/analyticsEvents.ts` (minimal: pseudonym with secret
  `ANALYTICS_PSEUDONYM_KEY` through `defineSecret`, writer, `purchase_intent` schema).
- Modify `functions/src/index.ts` (`getPilotOffer`, `recordPurchaseIntent`).
- Modify `functions/src/inputValidation.ts` (intent request parser).
- Create `src/features/billing/UpgradeDialog.tsx`, `src/features/billing/billingService.ts` (lazy).
- Modify `firestore.rules` only to keep `entitlements`, `operator_audit` and `analytics_events`
  default-deny (no new client access); update the source guard test if it lists collections.
- Tests: `functions/test/entitlements.test.ts` (grant, grant refused while active, revoke ends Pro
  now, no stacking), `functions/test/pilotOperator.test.ts` (target check rejects an unknown project
  or a mismatched database; audit record written per mutation), intent callable test, rules tests
  proving clients cannot write entitlements, the plan or audit records.

## Steps

1. `entitlements.ts` and the operator (`grant`, `revoke`, `status`) with target check and audit.
2. `getPilotOffer`, `recordPurchaseIntent` and the minimal analytics writer.
3. Upgrade dialog and links to terms.
4. Staging: grant, see Pro and the Pro meter; revoke, see Free; press the intent button, see one
   `purchase_intent` event.
5. G2 on production with the owner's own account: grant, revoke, and one recorded
   `purchase_intent`.

## Validation

- Functions tests listed above; `npm run test:rules`.
- Staging run in step 4; the operator refuses `PILOT_TARGET=staging` with the production database
  id.
- Production (G2): operator grant and revoke on the owner's account, one `purchase_intent` event
  recorded, `operator_audit` has both mutations.

## Risk

| Risk | L × I | Mitigation |
|---|---|---|
| Operator grants on the wrong project | L × H | Explicit target, sealed ids per target, confirmation string (red team #13) |
| Quota window breaks after an extension | M × M | No stacking; extensions are revoke + grant with a new window (red team #13) |
| Price shown before VAT | M × H | Only `displayPriceVnd` (VAT included) is shown; G2 blocked while it is null |
| Intent inflated by curiosity clicks | M × M | Intent counts only with an interview confirmation (plan.md metrics) |
| No audit of manual grants | L × M | `operator_audit` per mutation |

## Rollback

Hide the upgrade entry by a hosting rollback; the callables can stay. Existing entitlements stay
valid until expiry or `revoke`. Entitlements, audit records and events are additive collections.

## Deferred until business registration (not in the pilot)

Kept for the post-registration release, not built now: gateway selection (PayOS, SePay, VietQR
manual transfer or MoMo; fees and eligibility unverified), `payment_orders`, `createPaymentOrder`,
`paymentWebhook` with signature and amount checks, `payment_exceptions`, a `reconcile` operator
mode, a refund mode that ends the entitlement, the billing return route, gateway secrets through
`defineSecret`, and any CSP change for the gateway. A paid entitlement will add `source: 'payment'`
and an order reference; the no-stacking rule above stays unless the quota key is redesigned first.
The gateway decision will be recorded in the decision log (phase 11).
