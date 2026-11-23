'use strict';

(() => {
  const {
    APP_ORIGIN, DEFAULT_APP_URL, IMPORT_PROTOCOL_VERSION, MAX_CONTEXT_LENGTH,
    sanitizeSourceUrl, boundedPageTitle, DECK_METADATA_STORAGE_KEY, DECK_METADATA_GENERATION_STORAGE_KEY, DECK_METADATA_RETIRED_SCOPES_STORAGE_KEY,
    DUE_COUNT_STORAGE_KEY, DUE_COUNT_RETIRED_SCOPES_STORAGE_KEY, extensionApi, transientStorage, deckMetadataStorage, usesPromiseApi,
    apiCall, buildImportUrl, createImportNonce, createIntentId, isValidImportNonce, selectionValidation, normalizeSilentImportIntent,
    readSettings, writeUserSettings, updateSelectionIconSites, readRecentLookups, recordRecentLookup, clearRecentLookups, clearCreatedRecentLookups, normalizeDeckScope, normalizeDeckMetadata, normalizeRetiredDeckScopes,
    normalizeDueCountMetadata, normalizeRetiredDueCountScopes,
    COURSE_LOCALE_STORAGE_KEY, COURSE_LOCALE_RETIRED_SCOPES_STORAGE_KEY, normalizeCourseTargetLanguage, normalizeCourseLocaleMetadata, normalizeRetiredCourseLocaleScopes,
    normalizeSelectionIconSites, selectionIconSitePatternFromUrl, isProtectedSelectionIconUrl, t,
  } = globalThis.LingoFlashExtension;
  const { captureSelectionFromPage, renderInlineBubble } = globalThis.LingoFlashExtensionUi;
  const VERSION = extensionApi.runtime.getManifest().version;
  const CONTEXT_TRANSLATE_ID = 'lingoflash-translate-only';
  const CONTEXT_SAVE_ID = 'lingoflash-translate-save';
  const SAVE_COMMAND_ID = 'translate-selection';
  const TRANSLATE_COMMAND_ID = 'translate-only-selection';
  const JOB_KEY_PREFIX = 'lingoflash_quick_add_job_';
  const RETRY_KEY_PREFIX = 'lingoflash_quick_add_retry_';
  const OWNER_MARKER_KEY = 'lingoflash_owner_marker';
  const INLINE_SAVE_KEY_PREFIX = 'lingoflash_inline_save_';
  const INLINE_SAVE_TTL_MS = 30 * 60_000;
  // Marks a retry receipt whose capture had no confirmed course language, so a
  // retry keeps it unknown instead of treating the receipt as ambiguous.
  const UNKNOWN_CAPTURE_LANGUAGE = 'unknown';
  const JOB_ALARM_PREFIX = 'lingoflash_quick_add_timeout_';
  // Keep the background job alive through the bridge's full two-attempt AI
  // budget, including all bounded pre-submit waits and final cleanup.
  const FALLBACK_GRACE_MS = 1_500;
  const FALLBACK_FORM_TIMEOUT_MS = 8_000;
  const FALLBACK_HANDOFF_MS = 80;
  const FALLBACK_BUTTON_READY_TIMEOUT_MS = 3_000;
  const AI_ATTEMPT_TIMEOUT_MS = 65_000;
  const AI_RETRY_DELAY_MS = 500;
  const APP_RESPONSE_RENDER_MARGIN_MS = 4_500;
  const BRIDGE_GENERATION_TIMEOUT_MS = 135_000;
  const JOB_CLEANUP_MARGIN_MS = 5_000;
  const JOB_TIMEOUT_MS = 152_580;
  if (BRIDGE_GENERATION_TIMEOUT_MS !== AI_ATTEMPT_TIMEOUT_MS * 2
    + AI_RETRY_DELAY_MS + APP_RESPONSE_RENDER_MARGIN_MS
    || JOB_TIMEOUT_MS !== FALLBACK_GRACE_MS + FALLBACK_FORM_TIMEOUT_MS
      + FALLBACK_HANDOFF_MS + FALLBACK_BUTTON_READY_TIMEOUT_MS
      + BRIDGE_GENERATION_TIMEOUT_MS + JOB_CLEANUP_MARGIN_MS) {
    throw new Error('LingoFlash job timeout no longer covers the bridge lifecycle.');
  }
  const JOB_TIMEOUT_MINUTES = JOB_TIMEOUT_MS / (60 * 1000);
  const MAX_ACTIVE_JOBS = 3;
  const GOOGLE_TRANSLATE_TIMEOUT_MS = 9_000;
  const APP_RESULT_MESSAGE = 'LINGOFLASH_EXTENSION_RESULT';
  const QUICK_ADD_STATUS_MESSAGE = 'QUICK_ADD_STATUS';
  const SELECTION_ICON_SCRIPT_ID = 'lingoflash-selection-icon';
  const SELECTION_ICON_DISABLED_MESSAGE = 'FLOATING_SELECTION_DISABLED';
  const VERIFY_IMPORT_MESSAGE = 'VERIFY_IMPORT_INTENT';
  const APP_BRIDGE_PORT_NAME = 'sonflash-app-bridge';
  const APP_BRIDGE_PROVIDER_MESSAGE = 'LINGOFLASH_EXTENSION_PROVIDER';
  const METADATA_INVALIDATED_MESSAGE = 'LINGOFLASH_EXTENSION_METADATA_INVALIDATED';
  const verifyLocks = new Map();
  const resultLocks = new Map();
  const terminalLocks = new Map();
  const cleanupLocks = new Map();
  const tabRemovalLocks = new Map();
  const terminalErrorClaims = new Set();
  const quickAddSourceLocks = new Set();
  let quickAddCapacityTail = Promise.resolve();
  let deckMetadataTail = Promise.resolve();
  let confirmedDeckScope = '';
  let dueCountTail = Promise.resolve();
  // 07.6: mirrors confirmedDeckScope exactly. A due count is only ever served
  // to the popup once its scope has been confirmed by the current app-bridge
  // sync, so a reconnect or account switch can never surface a stale count
  // synced under a previous account.
  let confirmedDueCountScope = '';
  let courseLocaleTail = Promise.resolve();
  // 07.5: mirrors confirmedDeckScope/confirmedDueCountScope exactly. The
  // active course's native/target language is only ever served to the popup
  // or a fresh capture once its scope has been confirmed by the current
  // app-bridge sync, so a reconnect or account switch can never resurface a
  // previous account's course language pair.
  let confirmedCourseLocaleScope = '';
  let providerGeneration = 0;
  let currentProvider = null;
  const providers = new Map();
  let selectionIconRegistrationTail = Promise.resolve();
  const bounded = (v,n) => typeof v === 'string' ? v.trim().slice(0,n) : '';
  const key = id => `${JOB_KEY_PREFIX}${id}`;
  const retryKey = tabId => `${RETRY_KEY_PREFIX}${tabId}`;
  const alarmName = id => `${JOB_ALARM_PREFIX}${id}`;
  const withTerminalLock = async (id, work) => {
    const previous = terminalLocks.get(id) ?? Promise.resolve();
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const chained = previous.catch(() => undefined).then(() => pending);
    terminalLocks.set(id, chained);
    await previous.catch(() => undefined);
    try { return await work(); } finally { release(); if (terminalLocks.get(id) === chained) terminalLocks.delete(id); }
  };
  const saveJob = job => apiCall(transientStorage,'set',{[key(job.id)]:job});
  const saveRetry = async job => {
    if (!Number.isSafeInteger(job?.sourceTabId) || typeof job?.id !== 'string') return false;
    const sourceLanguage = normalizeCourseTargetLanguage(job.sourceLanguage);
    const binding = normalizeProviderBinding(job);
    try {
      await apiCall(transientStorage, 'set', { [retryKey(job.sourceTabId)]: {
        id: job.id, text: job.text, context: job.context || '', anchor: job.anchor,
        requestedDeck: job.requestedDeck || '', sourceUrl: job.sourceUrl || '', pageTitle: job.pageTitle || '',
        sourceLanguage: sourceLanguage || UNKNOWN_CAPTURE_LANGUAGE,
        ...(binding ?? {}),
        expiresAt: Date.now() + 86_400_000,
      } });
      return true;
    } catch { return false; }
  };
  const readRetry = async tabId => {
    const receipt = (await apiCall(transientStorage, 'get', retryKey(tabId)))?.[retryKey(tabId)];
    return receipt && typeof receipt.id === 'string' && typeof receipt.text === 'string'
      && Number.isSafeInteger(receipt.expiresAt) && receipt.expiresAt > Date.now() ? receipt : null;
  };
  const clearRetry = async tabId => { try { await apiCall(transientStorage, 'remove', retryKey(tabId)); } catch {} };
  // The capture history of saved words and the retry receipts describe one
  // signed-in session. When a confirmed session ends or is replaced, the next
  // account on this browser must not inherit them. Translate-only history has
  // no owner and stays.
  const dropOwnerBoundHistory = async () => {
    try { await clearCreatedRecentLookups(); } catch {}
    try {
      const stored = await apiCall(transientStorage, 'get', null) ?? {};
      for (const name of Object.keys(stored)) {
        if (name.startsWith(RETRY_KEY_PREFIX)) await apiCall(transientStorage, 'remove', name);
      }
    } catch {}
  };
  // Scopes are random per app document, so they cannot say whether a new scope
  // belongs to the same account. The app therefore sends an opaque, stable
  // marker of the signed-in account with the syncs it publishes. The marker is
  // kept beside the history it guards: a different marker means another account
  // took over the browser, and only then are the previous account's history and
  // receipts dropped. A reload, a second tab or a course switch keeps the marker.
  const readOwnerMarker = async () => {
    try { return normalizeDeckScope((await apiCall(transientStorage, 'get', OWNER_MARKER_KEY))?.[OWNER_MARKER_KEY]); } catch { return ''; }
  };
  let ownerMarkerTail = Promise.resolve();
  const adoptOwnerMarker = value => {
    const marker = normalizeDeckScope(value);
    if (!marker) return ownerMarkerTail;
    ownerMarkerTail = ownerMarkerTail.catch(() => undefined).then(async () => {
      const stored = await readOwnerMarker();
      if (stored === marker) return;
      if (stored) await dropOwnerBoundHistory();
      try { await apiCall(transientStorage, 'set', { [OWNER_MARKER_KEY]: marker }); } catch {}
    });
    return ownerMarkerTail;
  };
  // A job records the marker that was current when it started. A result that
  // arrives after another account took over must not enter that account's history.
  const jobOwnerIsCurrent = async job => {
    const stored = await readOwnerMarker();
    return !job?.ownerMarker || !stored || job.ownerMarker === stored;
  };
  // A quick translation shown in a page can offer "Save" once. The bubble only
  // holds an opaque id; the text and course stay here, so a save request can
  // only ever save the word this tab was shown, into the course it named.
  const inlineSaveKey = tabId => `${INLINE_SAVE_KEY_PREFIX}${tabId}`;
  const issueInlineSave = async (tabId, text, courseLanguage) => {
    if (!Number.isSafeInteger(tabId) || !courseLanguage) return '';
    const id = createIntentId();
    try {
      await apiCall(transientStorage, 'set', { [inlineSaveKey(tabId)]: { id, text, courseLanguage, expiresAt: Date.now() + INLINE_SAVE_TTL_MS } });
      return id;
    } catch { return ''; }
  };
  const takeInlineSave = async (tabId, id) => {
    const stored = (await apiCall(transientStorage, 'get', inlineSaveKey(tabId)))?.[inlineSaveKey(tabId)];
    if (!stored || typeof id !== 'string' || stored.id !== id || typeof stored.text !== 'string'
      || !Number.isSafeInteger(stored.expiresAt) || stored.expiresAt <= Date.now()) return null;
    try { await apiCall(transientStorage, 'remove', inlineSaveKey(tabId)); } catch {}
    return stored;
  };
  const readJob = async id => (await apiCall(transientStorage,'get',key(id)))?.[key(id)] ?? null;
  const removeJob = async id => {
    try {
      await apiCall(transientStorage, 'remove', key(id));
      return true;
    } catch {
      return false;
    }
  };
  const readJobs = async () => { try { return Object.entries(await apiCall(transientStorage,'get',null) ?? {}).filter(([k,v])=>k.startsWith(JOB_KEY_PREFIX)&&v&&typeof v==='object').map(([,v])=>v); } catch { return []; } };
  const readDeckMetadata = async () => {
    const stored = (await apiCall(deckMetadataStorage, 'get', DECK_METADATA_STORAGE_KEY))?.[DECK_METADATA_STORAGE_KEY];
    return normalizeDeckMetadata(stored);
  };
  const readDeckMetadataGeneration = async () => {
    const stored = (await apiCall(deckMetadataStorage, 'get', DECK_METADATA_GENERATION_STORAGE_KEY))?.[DECK_METADATA_GENERATION_STORAGE_KEY];
    return isValidImportNonce(stored) ? stored : '';
  };
  const readRetiredDeckScopes = async () => {
    try {
      const stored = (await apiCall(deckMetadataStorage, 'get', DECK_METADATA_RETIRED_SCOPES_STORAGE_KEY))?.[DECK_METADATA_RETIRED_SCOPES_STORAGE_KEY];
      return normalizeRetiredDeckScopes(stored);
    } catch { return []; }
  };
  const retireDeckScope = async scope => {
    const retired = normalizeRetiredDeckScopes([...(await readRetiredDeckScopes()), scope]);
    await apiCall(deckMetadataStorage, 'set', { [DECK_METADATA_RETIRED_SCOPES_STORAGE_KEY]: retired });
  };
  const withDeckMetadataLock = async work => {
    const previous = deckMetadataTail;
    let release;
    deckMetadataTail = new Promise(resolve => { release = resolve; });
    await previous.catch(() => undefined);
    try { return await work(); } finally { release(); }
  };
  const readDueCountMetadata = async () => {
    const stored = (await apiCall(deckMetadataStorage, 'get', DUE_COUNT_STORAGE_KEY))?.[DUE_COUNT_STORAGE_KEY];
    return normalizeDueCountMetadata(stored);
  };
  const readRetiredDueCountScopes = async () => {
    try {
      const stored = (await apiCall(deckMetadataStorage, 'get', DUE_COUNT_RETIRED_SCOPES_STORAGE_KEY))?.[DUE_COUNT_RETIRED_SCOPES_STORAGE_KEY];
      return normalizeRetiredDueCountScopes(stored);
    } catch { return []; }
  };
  const retireDueCountScope = async scope => {
    const retired = normalizeRetiredDueCountScopes([...(await readRetiredDueCountScopes()), scope]);
    await apiCall(deckMetadataStorage, 'set', { [DUE_COUNT_RETIRED_SCOPES_STORAGE_KEY]: retired });
  };
  const withDueCountLock = async work => {
    const previous = dueCountTail;
    let release;
    dueCountTail = new Promise(resolve => { release = resolve; });
    await previous.catch(() => undefined);
    try { return await work(); } finally { release(); }
  };
  // The popup and the browser action read the same confirmed, scoped count.
  // Badge support is optional (notably in Safari); a missing or failed action
  // API must never make the real count unavailable in the popup.
  const setDueCountActionBadge = async count => {
    try {
      await apiCall(extensionApi.action, 'setBadgeText', { text: count > 0 ? String(count) : '' });
      return true;
    } catch { return false; }
  };
  const clearDueCountActionBadge = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await setDueCountActionBadge(0)) return true;
      if (attempt < 2) await new Promise(resolve => globalThis.setTimeout(resolve, 100));
    }
    return false;
  };
  const readCourseLocaleMetadata = async () => {
    const stored = (await apiCall(deckMetadataStorage, 'get', COURSE_LOCALE_STORAGE_KEY))?.[COURSE_LOCALE_STORAGE_KEY];
    return normalizeCourseLocaleMetadata(stored);
  };
  const readRetiredCourseLocaleScopes = async () => {
    try {
      const stored = (await apiCall(deckMetadataStorage, 'get', COURSE_LOCALE_RETIRED_SCOPES_STORAGE_KEY))?.[COURSE_LOCALE_RETIRED_SCOPES_STORAGE_KEY];
      return normalizeRetiredCourseLocaleScopes(stored);
    } catch { return []; }
  };
  const retireCourseLocaleScope = async scope => {
    const retired = normalizeRetiredCourseLocaleScopes([...(await readRetiredCourseLocaleScopes()), scope]);
    await apiCall(deckMetadataStorage, 'set', { [COURSE_LOCALE_RETIRED_SCOPES_STORAGE_KEY]: retired });
  };
  const withCourseLocaleLock = async work => {
    const previous = courseLocaleTail;
    let release;
    courseLocaleTail = new Promise(resolve => { release = resolve; });
    await previous.catch(() => undefined);
    try { return await work(); } finally { release(); }
  };
  const senderHasImportHandoff = sender => {
    try {
      const hash = new URL(sender?.url || '').hash;
      return new URLSearchParams(hash.slice(1)).has('lf-import');
    } catch { return false; }
  };
  const providerSenderIsValid = sender => appOriginIsValid(sender)
    && !senderHasImportHandoff(sender)
    && Number.isSafeInteger(sender?.tab?.id)
    && sender.frameId === 0;
  const providerIsCurrent = provider => provider
    && provider.active
    && !provider.retired
    && currentProvider === provider;
  const providerError = () => new Error('Kênh app LingoFlash không hợp lệ hoặc đã hết hiệu lực.');
  const createProviderId = () => {
    try {
      if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
    } catch {}
    return `provider_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 18)}`;
  };
  const canClearProviderStorage = provider => currentProvider === null && provider.retired;
  const clearProviderStorage = provider => {
    const clear = async () => {
      await withDeckMetadataLock(async () => {
        if (!canClearProviderStorage(provider)) return;
        try { await apiCall(deckMetadataStorage, 'remove', DECK_METADATA_STORAGE_KEY); } catch {}
        if (!canClearProviderStorage(provider)) return;
      });
      await withDueCountLock(async () => {
        if (!canClearProviderStorage(provider)) return;
        try { await apiCall(deckMetadataStorage, 'remove', DUE_COUNT_STORAGE_KEY); } catch {}
        if (!canClearProviderStorage(provider)) return;
        await clearDueCountActionBadge();
      });
      await withCourseLocaleLock(async () => {
        if (!canClearProviderStorage(provider)) return;
        try { await apiCall(deckMetadataStorage, 'remove', COURSE_LOCALE_STORAGE_KEY); } catch {}
      });
    };
    void clear().catch(() => undefined);
  };
  const retireProvider = provider => {
    if (!provider || provider.retired) return;
    provider.retired = true;
    provider.active = false;
    providers.delete(provider.id);
    if (currentProvider === provider) {
      notifyMetadataInvalidated(provider.generation, {
        deck: confirmedDeckScope,
        due: confirmedDueCountScope,
        locale: confirmedCourseLocaleScope,
      });
      currentProvider = null;
      confirmedDeckScope = '';
      confirmedDueCountScope = '';
      confirmedCourseLocaleScope = '';
    }
    clearProviderStorage(provider);
  };
  const retireAllProviders = () => {
    for (const provider of [...providers.values()]) retireProvider(provider);
    if (currentProvider) retireProvider(currentProvider);
  };
  const claimProvider = (providerId, sender) => {
    if (!providerSenderIsValid(sender)) throw providerError();
    const provider = providers.get(providerId);
    if (!provider || provider.tabId !== sender.tab.id || !provider.active || provider.retired) throw providerError();
    if (currentProvider !== provider) {
      if (currentProvider) retireProvider(currentProvider);
      currentProvider = provider;
      provider.claimed = true;
      confirmedDeckScope = '';
      confirmedDueCountScope = '';
      confirmedCourseLocaleScope = '';
      void withDueCountLock(async () => {
        if (providerIsCurrent(provider)) await clearDueCountActionBadge();
      }).catch(() => undefined);
    }
    return provider;
  };
  const requireCurrentProvider = (providerId, sender, allowPending = false) => {
    if (!providerSenderIsValid(sender)) throw providerError();
    const provider = providers.get(providerId);
    if (!provider || provider.tabId !== sender.tab.id || !provider.active || provider.retired) {
      throw providerError();
    }
    if (allowPending) return provider;
    if (!providerIsCurrent(provider)) return null;
    return provider;
  };
  const confirmedProviderScope = () => {
    const channels = [
      ['deck', confirmedDeckScope],
      ['locale', confirmedCourseLocaleScope],
      ['due', confirmedDueCountScope],
    ];
    for (const [channel, value] of channels) {
      const scope = normalizeDeckScope(value);
      if (scope) return { channel, scope };
    }
    return null;
  };
  const captureProviderBinding = () => {
    if (!providerIsCurrent(currentProvider)) return null;
    const confirmed = confirmedProviderScope();
    if (!confirmed) return null;
    return {
      providerId: currentProvider.id,
      providerGeneration: currentProvider.generation,
      providerScope: confirmed.scope,
      providerScopeChannel: confirmed.channel,
    };
  };
  const normalizeProviderBinding = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (typeof value.providerId !== 'string' || !value.providerId
      || !Number.isSafeInteger(value.providerGeneration)) return null;
    const providerScope = normalizeDeckScope(value.providerScope);
    if (!providerScope) return null;
    const providerScopeChannel = value.providerScopeChannel === undefined
      ? 'deck'
      : value.providerScopeChannel;
    if (!['deck', 'locale', 'due'].includes(providerScopeChannel)) return null;
    return {
      providerId: value.providerId,
      providerGeneration: value.providerGeneration,
      providerScope,
      providerScopeChannel,
    };
  };
  const confirmedScopeForChannel = channel => channel === 'locale'
    ? confirmedCourseLocaleScope
    : channel === 'due'
      ? confirmedDueCountScope
      : confirmedDeckScope;
  const jobProviderBindingIsCurrent = job => {
    const binding = normalizeProviderBinding(job);
    if (!binding) return !job?.providerId && !job?.providerGeneration && !job?.providerScope;
    const provider = providers.get(binding.providerId);
    return providerIsCurrent(provider)
      && provider.generation === binding.providerGeneration
      && confirmedScopeForChannel(binding.providerScopeChannel) === binding.providerScope;
  };
  // A retry can outlive the worker that issued its binding: the worker idles
  // out, the app document reconnects under a new provider id and re-publishes
  // the same scope. Same scope means the same app document and owner, so the
  // retry moves to the live provider. A different or missing scope proves
  // nothing about the owner, so the caller must refuse the retry.
  const rebindRetryProviderBinding = binding => {
    if (!providerIsCurrent(currentProvider)) return null;
    if (confirmedScopeForChannel(binding.providerScopeChannel) !== binding.providerScope) return null;
    return {
      providerId: currentProvider.id,
      providerGeneration: currentProvider.generation,
      providerScope: binding.providerScope,
      providerScopeChannel: binding.providerScopeChannel,
    };
  };
  // The target language a fresh capture is studying: the confirmed active
  // course's target language when the app has synced one, else '' (unknown).
  // An unknown language is never guessed; the app then saves the word into
  // whatever course is active instead of asking to switch to a guessed one.
  const activeCaptureSourceLanguage = async () => {
    const metadata = await readCourseLocaleMetadata();
    return metadata && metadata.scope === confirmedCourseLocaleScope ? metadata.targetLanguage : '';
  };
  // The confirmed active course, or null while no app session has confirmed
  // one. The in-page bubble names it; it never guesses a course.
  const confirmedCourseLocale = async () => {
    if (!confirmedCourseLocaleScope) return null;
    try {
      const metadata = await readCourseLocaleMetadata();
      return metadata && metadata.scope === confirmedCourseLocaleScope ? metadata : null;
    } catch { return null; }
  };
  const clearAlarm = async id => { try { await apiCall(extensionApi.alarms,'clear',alarmName(id)); } catch {} };
  const closeTab = async id => { if (typeof id==='number') try { await apiCall(extensionApi.tabs,'remove',id); } catch {} };
  const cleanup = job => {
    if (!job || typeof job.id !== 'string') return Promise.resolve(false);
    const existing = cleanupLocks.get(job.id);
    if (existing) return existing;
    const pending = (async () => {
      // Remove the persisted job before closing its worker tab. Chrome can
      // deliver tabs.onRemoved synchronously; leaving the job visible while
      // closing the tab makes a successful result look like a worker failure.
      const removed = await removeJob(job.id);
      await Promise.allSettled([clearAlarm(job.id), closeTab(job.workerTabId)]);
      return removed;
    })();
    const tracked = pending.then(result => {
      if (result) terminalErrorClaims.delete(job.id);
      return result;
    }).finally(() => {
      cleanupLocks.delete(job.id);
      tabRemovalLocks.delete(job.id);
    });
    cleanupLocks.set(job.id, tracked);
    return tracked;
  };
  const claimTerminalError = async job => withTerminalLock(job?.id, async () => {
    if (!job || typeof job.id !== 'string' || job.resultClaimedAt || job.errorClaimedAt
      || terminalErrorClaims.has(job.id)) return false;
    terminalErrorClaims.add(job.id);
    const current = await readJob(job.id);
    if (!current || current.resultClaimedAt || current.errorClaimedAt) return false;
    current.errorClaimedAt = Date.now();
    try {
      await saveJob(current);
      await saveRetry(current);
    } catch {
      // Do not publish a terminal notice unless its durable claim succeeded.
      terminalErrorClaims.delete(job.id);
      return null;
    }
    return true;
  });
  const claimTerminalResult = async job => withTerminalLock(job?.id, async () => {
    const current = await readJob(job?.id);
    if (!current || current.resultClaimedAt || current.errorClaimedAt || isExpiredJob(current)) return null;
    current.resultClaimedAt = Date.now();
    await saveJob(current);
    return current;
  });
  const createAlarm = (id, createdAt = Date.now()) => {
    const elapsed = Math.max(0, Date.now() - createdAt);
    const remaining = Math.max(0, JOB_TIMEOUT_MS - elapsed);
    try { extensionApi.alarms?.create(alarmName(id),{delayInMinutes:remaining / (60 * 1000)}); } catch {}
  };
  const isExpiredJob = (job, now = Date.now()) => !Number.isSafeInteger(job?.createdAt)
    || job.createdAt > now
    || now - job.createdAt >= JOB_TIMEOUT_MS;
  const withQuickAddCapacityLock = async work => {
    const previous = quickAddCapacityTail;
    let release;
    quickAddCapacityTail = new Promise(resolve => { release = resolve; });
    await previous.catch(() => undefined);
    try { return await work(); } finally { release(); }
  };
  const reportQuickAddFailure = async (job, error) => {
    const message = error instanceof Error ? error.message : t('errorStartExtension', undefined, 'Không thể khởi động LingoFlash.');
    await saveRetry(job);
    await cleanup(job);
    const displayed = await show(job.sourceTabId,{status:'error',modeLabel:t('bubbleModeSave', undefined, 'TẠO + LƯU'),text:job.text,anchor:job.anchor,message,retryId:job.id});
    notifyPopupStatus({id:job.id,status:'error',text:job.text,message,inlineShown:displayed.ok});
  };
  const sweepExpiredJobs = async () => {
    const now = Date.now();
    for (const job of await readJobs()) {
      if (!isExpiredJob(job, now)) continue;
      if (job.resultClaimedAt || job.errorClaimedAt) {
        if (!(await cleanup(job))) createAlarm(job.id, job.createdAt);
        continue;
      }
      const message = t('errorJobExpired', undefined, 'Tác vụ LingoFlash đã hết hạn. Hãy thử lại.');
      const errorClaim = await claimTerminalError(job);
      if (errorClaim === null) {
        createAlarm(job.id, job.createdAt);
        continue;
      }
      if (errorClaim) {
        const displayed = await show(job.sourceTabId,{status:'error',modeLabel:t('bubbleModeSave', undefined, 'TẠO + LƯU'),text:job.text,anchor:job.anchor,message,retryId:job.id});
        notifyPopupStatus({id:job.id,status:'error',text:job.text,message,inlineShown:displayed.ok});
      }
      if (!(await cleanup(job))) createAlarm(job.id, job.createdAt);
    }
  };

  const show = async (tabId,payload) => {
    if (typeof tabId!=='number') return {ok:false,error:t('errorNoActiveTab', undefined, 'Không tìm thấy tab đang hoạt động.')};
    try {
      const settings = await readSettings();
      const course = await confirmedCourseLocale();
      const courseFields = course ? {courseLanguage:course.targetLanguage,nativeLanguage:course.nativeLanguage} : {};
      const result = await apiCall(extensionApi.scripting,'executeScript',{target:{tabId},func:renderInlineBubble,args:[{version:VERSION,...courseFields,...payload,bubbleDurationMs:settings.bubbleDurationMs,autoSpeak:settings.autoSpeak,themeFamily:settings.themeFamily,colorScheme:settings.colorScheme}]});
      const renderResult = Array.isArray(result) ? result[0]?.result : result;
      if (renderResult?.ok !== true) {
        return {ok:false,error:renderResult?.error || 'Không thể xác nhận kết quả đã hiển thị trên trang.'};
      }
      return {ok:true,result};
    } catch (error) {
      return {ok:false,error:error instanceof Error?error.message:String(error)};
    }
  };
  const notifyPopupStatus = payload => {
    try {
      void apiCall(extensionApi.runtime,'sendMessage',{type:QUICK_ADD_STATUS_MESSAGE,payload}).catch(()=>undefined);
    } catch {}
  };
  const notifyMetadataInvalidated = (generation, scopes = {}) => {
    if (!Number.isSafeInteger(generation) || generation <= 0) return;
    const payload = { generation, scopes: {} };
    for (const channel of ['deck', 'due', 'locale']) {
      const scope = normalizeDeckScope(scopes[channel]);
      if (scope) payload.scopes[channel] = scope;
    }
    try {
      void apiCall(extensionApi.runtime, 'sendMessage', {
        type: METADATA_INVALIDATED_MESSAGE,
        generation,
        scopes: payload.scopes,
      }).catch(() => undefined);
    } catch {}
  };
  const speechLocaleForLanguage = value => {
    const code = String(value || '').toLowerCase().split('-')[0];
    const locales = { en: 'en-US', vi: 'vi-VN', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT', pt: 'pt-BR', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', ru: 'ru-RU' };
    return locales[code] || 'en-US';
  };
  const normalizeDetectedLanguage = value => {
    const code = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return code === 'auto' || /^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(code) ? code : '';
  };
  const activeTab = async () => { const tabs=await apiCall(extensionApi.tabs,'query',{active:true,currentWindow:true}); return Array.isArray(tabs)?tabs[0]??null:null; };
  const capture = async (tabId,supplied='') => {
    const direct=selectionValidation(supplied);
    if (typeof tabId !== 'number') return {text:direct.ok?direct.text:'',anchor:null,context:'',pageLanguage:''};
    try {
      const r=await apiCall(extensionApi.scripting,'executeScript',{target:{tabId},func:captureSelectionFromPage});
      const capturedText=Array.isArray(r)?r[0]?.result?.text??'':'';
      const captured=selectionValidation(capturedText);
      const pageLanguage=normalizeDetectedLanguage(Array.isArray(r)?r[0]?.result?.pageLanguage:'').replace(/^auto$/,'');
      if (!direct.ok) {
        return {text:captured.ok?captured.text:'',anchor:Array.isArray(r)?r[0]?.result?.anchor??null:null,context:Array.isArray(r)?r[0]?.result?.context??'':'',pageLanguage:captured.ok?pageLanguage:''};
      }
      const sameSelection=captured.ok && captured.text===direct.text;
      return {text:direct.text,anchor:sameSelection&&Array.isArray(r)?r[0]?.result?.anchor??null:null,context:sameSelection&&Array.isArray(r)?r[0]?.result?.context??'':'',pageLanguage:sameSelection?pageLanguage:''};
    } catch {
      return {text:direct.ok?direct.text:'',anchor:null,context:'',pageLanguage:''};
    }
  };
  const tabPageInfo = async tab => {
    // A tab passed in as a bare `{id}` (context-menu click) never carries
    // `url`/`title`; only the `activeTab()` query result does. Fetch the
    // full tab record in that case so captured-source metadata is available
    // regardless of which path led here.
    let full = tab;
    if (typeof full?.url !== 'string' && typeof full?.id === 'number') {
      try { full = await apiCall(extensionApi.tabs,'get',full.id); } catch { full = tab; }
    }
    return {sourceUrl:sanitizeSourceUrl(full?.url),pageTitle:boundedPageTitle(full?.title)};
  };
  const selection = async ({tabId,suppliedText=''}={}) => {
    const tab=typeof tabId==='number'?{id:tabId}:await activeTab();
    if (typeof tab?.id!=='number') throw new Error(t('errorNoActiveTab', undefined, 'Không tìm thấy tab đang hoạt động.'));
    const c=await capture(tab.id,suppliedText), v=selectionValidation(c.text); if (!v.ok) throw new Error(v.error);
    const {sourceUrl,pageTitle}=await tabPageInfo(tab);
    return {sourceTabId:tab.id,text:v.text,anchor:c.anchor,context:c.context || '',pageLanguage:c.pageLanguage || '',sourceUrl,pageTitle};
  };

  const appOriginIsValid = sender => {
    try { return new URL(sender?.url || '').origin === APP_ORIGIN; } catch { return false; }
  };
  const syncDeckMetadata = async (payload, sender, providerId) => {
    if (!appOriginIsValid(sender) || sender.frameId !== 0 || !Number.isSafeInteger(sender?.tab?.id)) {
      throw new Error('Nguồn metadata deck không hợp lệ.');
    }
    const metadata = normalizeDeckMetadata(payload);
    if (!metadata) throw new Error('Metadata deck không hợp lệ.');
    const provider = claimProvider(providerId, sender);
    const ensureCurrent = () => { if (!providerIsCurrent(provider)) throw providerError(); };
    return withDeckMetadataLock(async () => {
      ensureCurrent();
      if (!isValidImportNonce(payload?.generation) || payload.generation !== await readDeckMetadataGeneration()) throw new Error('Phiên metadata deck đã hết hiệu lực.');
      ensureCurrent();
      const retiredScopes = await readRetiredDeckScopes();
      ensureCurrent();
      if (retiredScopes.includes(metadata.scope)) throw new Error('Scope metadata deck đã hết hiệu lực.');
      const current = await readDeckMetadata();
      ensureCurrent();
      const previousScope = current?.scope && current.scope !== metadata.scope ? current.scope : '';
      if (previousScope) await retireDeckScope(previousScope);
      ensureCurrent();
      await apiCall(deckMetadataStorage, 'set', { [DECK_METADATA_STORAGE_KEY]: metadata });
      ensureCurrent();
      confirmedDeckScope = metadata.scope;
      if (previousScope) notifyMetadataInvalidated(provider.generation, { deck: previousScope });
      return { count: metadata.decks.length };
    });
  };
  const clearDeckMetadata = async (payload, sender, providerId) => {
    if (!appOriginIsValid(sender) || sender.frameId !== 0 || !Number.isSafeInteger(sender?.tab?.id)) {
      throw new Error('Nguồn metadata deck không hợp lệ.');
    }
    const scope = normalizeDeckScope(payload?.scope);
    if (!scope) throw new Error('Scope metadata deck không hợp lệ.');
    const provider = requireCurrentProvider(providerId, sender);
    if (!provider) return { cleared: false, ignored: true };
    return withDeckMetadataLock(async () => {
      if (!providerIsCurrent(provider)) return { cleared: false, ignored: true };
      if (!isValidImportNonce(payload?.generation) || payload.generation !== await readDeckMetadataGeneration()) throw new Error('Phiên metadata deck đã hết hiệu lực.');
      const current = await readDeckMetadata();
      if (!providerIsCurrent(provider)) return { cleared: false, ignored: true };
      const cleared = current?.scope === scope || confirmedDeckScope === scope;
      if (current?.scope === scope) await apiCall(deckMetadataStorage, 'remove', DECK_METADATA_STORAGE_KEY);
      if (!providerIsCurrent(provider)) return { cleared: false, ignored: true };
      await retireDeckScope(scope);
      await apiCall(deckMetadataStorage, 'remove', DECK_METADATA_GENERATION_STORAGE_KEY);
      if (!providerIsCurrent(provider)) return { cleared: false, ignored: true };
      if (confirmedDeckScope === scope) confirmedDeckScope = '';
      if (cleared) notifyMetadataInvalidated(provider.generation, { deck: scope });
      return { cleared };
    });
  };

  // 07.6: due count follows the exact deck-metadata contract (session-only
  // storage, per-scope retirement, origin-checked writes) so the popup badge
  // is always real, current-account study state and never a leaked or
  // fabricated number.
  const syncDueCount = async (payload, sender, providerId) => {
    if (!appOriginIsValid(sender) || sender.frameId !== 0 || !Number.isSafeInteger(sender?.tab?.id)) {
      throw new Error('Nguồn due-count không hợp lệ.');
    }
    const metadata = normalizeDueCountMetadata(payload);
    if (!metadata) throw new Error('Due-count không hợp lệ.');
    const provider = claimProvider(providerId, sender);
    const ensureCurrent = () => { if (!providerIsCurrent(provider)) throw providerError(); };
    return withDueCountLock(async () => {
      ensureCurrent();
      const retiredScopes = await readRetiredDueCountScopes();
      ensureCurrent();
      if (retiredScopes.includes(metadata.scope)) throw new Error('Scope due-count đã hết hiệu lực.');
      const current = await readDueCountMetadata();
      ensureCurrent();
      const previousScope = current?.scope && current.scope !== metadata.scope ? current.scope : '';
      if (previousScope) await retireDueCountScope(previousScope);
      ensureCurrent();
      await apiCall(deckMetadataStorage, 'set', { [DUE_COUNT_STORAGE_KEY]: metadata });
      ensureCurrent();
      confirmedDueCountScope = metadata.scope;
      await setDueCountActionBadge(metadata.count);
      ensureCurrent();
      await adoptOwnerMarker(payload?.owner);
      if (previousScope) notifyMetadataInvalidated(provider.generation, { due: previousScope });
      return { count: metadata.count };
    });
  };
  const clearDueCount = async (payload, sender, providerId) => {
    if (!appOriginIsValid(sender) || sender.frameId !== 0 || !Number.isSafeInteger(sender?.tab?.id)) {
      throw new Error('Nguồn due-count không hợp lệ.');
    }
    const scope = normalizeDeckScope(payload?.scope);
    if (!scope) throw new Error('Scope due-count không hợp lệ.');
    const provider = requireCurrentProvider(providerId, sender);
    if (!provider) return { cleared: false, ignored: true };
    return withDueCountLock(async () => {
      if (!providerIsCurrent(provider)) return { cleared: false, ignored: true };
      const current = await readDueCountMetadata();
      if (!providerIsCurrent(provider)) return { cleared: false, ignored: true };
      const cleared = current?.scope === scope || confirmedDueCountScope === scope;
      if (cleared) await apiCall(deckMetadataStorage, 'remove', DUE_COUNT_STORAGE_KEY);
      if (!providerIsCurrent(provider)) return { cleared: false, ignored: true };
      await retireDueCountScope(scope);
      if (!providerIsCurrent(provider)) return { cleared: false, ignored: true };
      if (confirmedDueCountScope === scope) confirmedDueCountScope = '';
      if (cleared) await clearDueCountActionBadge();
      if (!providerIsCurrent(provider)) return { cleared: false, ignored: true };
      if (cleared) notifyMetadataInvalidated(provider.generation, { due: scope });
      return { cleared };
    });
  };

  // 07.5: course locale follows the exact deck-metadata/due-count contract
  // (session-only storage, per-scope retirement, origin-checked writes) so
  // the popup/options UI locale and a fresh capture's assumed target
  // language are always real, current-account course state and never a
  // leaked or fabricated pair.
  const syncCourseLocale = async (payload, sender, providerId) => {
    if (!appOriginIsValid(sender) || sender.frameId !== 0 || !Number.isSafeInteger(sender?.tab?.id)) {
      throw new Error('Nguồn course locale không hợp lệ.');
    }
    const metadata = normalizeCourseLocaleMetadata(payload);
    if (!metadata) throw new Error('Course locale không hợp lệ.');
    const provider = claimProvider(providerId, sender);
    const ensureCurrent = () => { if (!providerIsCurrent(provider)) throw providerError(); };
    return withCourseLocaleLock(async () => {
      ensureCurrent();
      const retiredScopes = await readRetiredCourseLocaleScopes();
      ensureCurrent();
      if (retiredScopes.includes(metadata.scope)) throw new Error('Scope course locale đã hết hiệu lực.');
      const current = await readCourseLocaleMetadata();
      ensureCurrent();
      const previousScope = current?.scope && current.scope !== metadata.scope ? current.scope : '';
      if (previousScope) await retireCourseLocaleScope(previousScope);
      ensureCurrent();
      await apiCall(deckMetadataStorage, 'set', { [COURSE_LOCALE_STORAGE_KEY]: metadata });
      ensureCurrent();
      confirmedCourseLocaleScope = metadata.scope;
      await adoptOwnerMarker(payload?.owner);
      if (previousScope) notifyMetadataInvalidated(provider.generation, { locale: previousScope });
      return { nativeLanguage: metadata.nativeLanguage, targetLanguage: metadata.targetLanguage };
    });
  };
  const clearCourseLocale = async (payload, sender, providerId) => {
    if (!appOriginIsValid(sender) || sender.frameId !== 0 || !Number.isSafeInteger(sender?.tab?.id)) {
      throw new Error('Nguồn course locale không hợp lệ.');
    }
    const scope = normalizeDeckScope(payload?.scope);
    if (!scope) throw new Error('Scope course locale không hợp lệ.');
    const provider = requireCurrentProvider(providerId, sender);
    if (!provider) return { cleared: false, ignored: true };
    return withCourseLocaleLock(async () => {
      if (!providerIsCurrent(provider)) return { cleared: false, ignored: true };
      const current = await readCourseLocaleMetadata();
      if (!providerIsCurrent(provider)) return { cleared: false, ignored: true };
      const cleared = current?.scope === scope || confirmedCourseLocaleScope === scope;
      if (current?.scope === scope) await apiCall(deckMetadataStorage, 'remove', COURSE_LOCALE_STORAGE_KEY);
      if (!providerIsCurrent(provider)) return { cleared: false, ignored: true };
      await retireCourseLocaleScope(scope);
      if (!providerIsCurrent(provider)) return { cleared: false, ignored: true };
      if (confirmedCourseLocaleScope === scope) confirmedCourseLocaleScope = '';
      if (cleared) notifyMetadataInvalidated(provider.generation, { locale: scope });
      return { cleared };
    });
  };

  const hasSelectionIconPermission = async sitePattern => {
    if (!extensionApi.permissions?.contains || !sitePattern) return false;
    try { return await apiCall(extensionApi.permissions, 'contains', { origins: [sitePattern] }); }
    catch { return false; }
  };

  const readPermittedSelectionIconSites = async () => {
    const settings = await readSettings();
    const configured = normalizeSelectionIconSites(settings.selectionIconSites);
    if (!configured.length || !extensionApi.permissions?.contains) return [];
    const permitted = await Promise.all(configured.map(async site => (
      await hasSelectionIconPermission(site) ? site : null
    )));
    return permitted.filter(Boolean);
  };

  const notifySelectionIconDisabled = async sites => {
    if (!Array.isArray(sites) || !extensionApi.tabs?.query || !extensionApi.tabs?.sendMessage) return;
    for (const site of sites) {
      let tabs = [];
      try { tabs = await apiCall(extensionApi.tabs, 'query', { url: site }); } catch { tabs = []; }
      for (const tab of Array.isArray(tabs) ? tabs : []) {
        if (typeof tab?.id !== 'number') continue;
        try { await apiCall(extensionApi.tabs, 'sendMessage', tab.id, { type: SELECTION_ICON_DISABLED_MESSAGE }); } catch {}
      }
    }
  };

  const syncSelectionIconRegistration = async () => {
    if (!extensionApi.scripting?.registerContentScripts || !extensionApi.scripting?.unregisterContentScripts) return [];
    const previous = selectionIconRegistrationTail;
    let release;
    selectionIconRegistrationTail = new Promise(resolve => { release = resolve; });
    await previous.catch(() => undefined);
    try {
      const sites = await readPermittedSelectionIconSites();
      try { await apiCall(extensionApi.scripting, 'unregisterContentScripts', { ids: [SELECTION_ICON_SCRIPT_ID] }); } catch {}
      if (!sites.length) return sites;
      await apiCall(extensionApi.scripting, 'registerContentScripts', [{
        id: SELECTION_ICON_SCRIPT_ID,
        matches: sites,
        js: ['selection-icon.js'],
        runAt: 'document_start',
        persistAcrossSessions: true,
      }]);
      return sites;
    } finally {
      release();
    }
  };

  const getSelectionIconSites = async () => ({
    sites: normalizeSelectionIconSites((await readSettings()).selectionIconSites),
    permittedSites: await readPermittedSelectionIconSites(),
  });

  const enableSelectionIconSite = async pattern => {
    const site = selectionIconSitePatternFromUrl(pattern) || normalizeSelectionIconSites([pattern])[0] || '';
    if (!site || isProtectedSelectionIconUrl(site)) throw new Error(t('errorFloatingIconProtected', undefined, 'Website này không thể bật floating icon.'));
    if (!(await hasSelectionIconPermission(site))) throw new Error(t('errorFloatingIconNoPermission', undefined, 'Website chưa được cấp quyền cho floating icon.'));
    const mutation = await updateSelectionIconSites(sites => [...sites, site]);
    if (!mutation.settings.selectionIconSites.includes(site)) {
      // The bounded allowlist rejected this new site. Do not leave the
      // optional host permission behind or report a misleading success.
      try { await apiCall(extensionApi.permissions, 'remove', { origins: [site] }); } catch {}
      throw new Error(t('errorFloatingIconLimit', [100], 'Đã đạt giới hạn 100 website cho floating icon.'));
    }
    const addedByThisCall = !mutation.previousSites.includes(site);
    try {
      await syncSelectionIconRegistration();
    } catch (error) {
      // Do not leave a site marked as enabled when dynamic registration failed.
      if (addedByThisCall) {
        try { await updateSelectionIconSites(sites => sites.filter(candidate => candidate !== site)); } catch {}
      }
      // The permission was only useful for this registration. Roll it back so
      // a failed enable cannot leave an unused host grant behind.
      try {
        await apiCall(extensionApi.permissions, 'remove', { origins: [site] });
      } catch {}
      try { await syncSelectionIconRegistration(); } catch {}
      throw error;
    }
    return { enabled: true, ...(await getSelectionIconSites()) };
  };

  const disableSelectionIconSite = async pattern => {
    const site = selectionIconSitePatternFromUrl(pattern) || normalizeSelectionIconSites([pattern])[0] || '';
    if (!site) throw new Error(t('errorFloatingIconInvalidSite', undefined, 'Website floating icon không hợp lệ.'));
    const mutation = await updateSelectionIconSites(sites => sites.filter(candidate => candidate !== site));
    const removedByThisCall = mutation.previousSites.includes(site);
    try {
      await syncSelectionIconRegistration();
    } catch (error) {
      if (removedByThisCall) {
        try { await updateSelectionIconSites(sites => [...sites, site]); } catch {}
      }
      try { await syncSelectionIconRegistration(); } catch {}
      throw error;
    }
    await notifySelectionIconDisabled([site]);
    return { enabled: false, ...(await getSelectionIconSites()) };
  };

  const handleSelectionIconPermissionRemoved = async permissions => {
    const removed = normalizeSelectionIconSites(permissions?.origins ?? []);
    if (!removed.length) return;
    try {
      await updateSelectionIconSites(sites => sites.filter(candidate => !removed.includes(candidate)));
    } catch {}
    // Even if settings storage is unavailable, permission revocation must
    // still tear down an existing registration and any open-page control.
    await notifySelectionIconDisabled(removed);
    try { await syncSelectionIconRegistration(); } catch {}
  };

  const googleTranslate = async text => {
    const settings = await readSettings();
    const u=new URL('https://translate.googleapis.com/translate_a/single');
    // dt=rm adds a transliteration chunk ([null,null,target,source]) after the
    // translated chunks; the source half is the reading of a Korean, Japanese
    // or Chinese selection.
    u.search=new URLSearchParams([['client','gtx'],['sl',settings.quickTranslateSource],['tl',settings.quickTranslateTarget],['dt','t'],['dt','rm'],['q',text]]).toString();
    const controller = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
    let timeoutId = null;
    const timeout = new Promise((_, reject) => {
      timeoutId = globalThis.setTimeout(() => {
        controller?.abort();
        reject(new Error(t('errorTranslateTimeout', undefined, 'Google Translate hết thời gian sau 9 giây.')));
      }, GOOGLE_TRANSLATE_TIMEOUT_MS);
    });
    try {
      const request = (async () => {
        const response = await fetch(u.toString(), {
          cache:'no-store',
          credentials:'omit',
          ...(controller ? {signal: controller.signal} : {}),
        });
        if (!response.ok) throw new Error(`Google Translate HTTP ${response.status}`);
        const p=await response.json(), chunks=Array.isArray(p?.[0])?p[0]:[];
        const translatedText=chunks.map(x=>Array.isArray(x)&&typeof x[0]==='string'?x[0]:'').join('').trim();
        if (!translatedText) throw new Error(t('errorTranslateEmpty', undefined, 'Google Translate trả về kết quả trống.'));
        const reading=chunks.find(x=>Array.isArray(x)&&x[0]==null&&typeof x[3]==='string'&&x[3].trim());
        return { text: translatedText, sourceLanguage: normalizeDetectedLanguage(p?.[2]) || settings.quickTranslateSource || 'auto', romanization: reading ? bounded(reading[3],256) : '' };
      })();
      return await Promise.race([request, timeout]);
    } finally {
      if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
    }
  };
  const translateOnly = async input => {
    const s=await selection(input); await show(s.sourceTabId,{status:'loading-translate',modeLabel:t('bubbleModeTranslateFree', undefined, 'DỊCH NHANH • FREE'),text:s.text,anchor:s.anchor});
    try {
      const translated=await googleTranslate(s.text);
      const settings=await readSettings();
      await recordRecentLookup({text:s.text,translation:translated.text,sourceLanguage:translated.sourceLanguage,targetLanguage:settings.quickTranslateTarget,kind:'translate',status:'translated',timestamp:Date.now()});
      // Offer "Save" in the page only for a confirmed course whose language
      // the selection is in; anything else stays a translation, as before.
      const course=await confirmedCourseLocale();
      const detected=String(translated.sourceLanguage||'').split('-')[0];
      const saveId=course && detected===course.targetLanguage ? await issueInlineSave(s.sourceTabId,s.text,course.targetLanguage) : '';
      const inline=await show(s.sourceTabId,{status:'translated',modeLabel:t('bubbleModeTranslateGoogle', undefined, 'DỊCH NHANH • GOOGLE'),text:s.text,anchor:s.anchor,translation:bounded(translated.text,1024),speechLocale:speechLocaleForLanguage(translated.sourceLanguage),
        sourceLanguage:translated.sourceLanguage,translationLanguage:settings.quickTranslateTarget,romanization:translated.romanization||'',context:bounded(s.context,500),pageLanguage:s.pageLanguage||'',
        ...(saveId?{saveId}:{})});
      return {text:s.text,translation:translated.text,sourceLanguage:translated.sourceLanguage,romanization:translated.romanization||'',inlineShown:inline.ok};
    }
    catch(e){ await show(s.sourceTabId,{status:'error',modeLabel:t('bubbleModeTranslateFree', undefined, 'DỊCH NHANH • FREE'),text:s.text,anchor:s.anchor,message:e instanceof Error?e.message:t('errorTranslateFailed', undefined, 'Không thể dịch đoạn này.')}); throw e; }
  };

  const quickAdd = async input => {
    const retry = input?.retryReceipt;
    const providerWasCurrentAtCapture = !retry && providerIsCurrent(currentProvider);
    const capturedProviderBinding = !retry ? captureProviderBinding() : null;
    const s = retry
      ? { sourceTabId: input.tabId, text: retry.text, context: retry.context, anchor: retry.anchor, sourceUrl: retry.sourceUrl || '', pageTitle: retry.pageTitle || '' }
      : await selection(input);
    const id=retry?.id ?? createIntentId(), nonce=createImportNonce();
    const requestedDeck = retry?.requestedDeck || (typeof input?.requestedDeck === 'string' ? input.requestedDeck.trim().slice(0, 128) : '');
    let providerBinding = retry ? normalizeProviderBinding(retry) : capturedProviderBinding;
    if (!retry && providerWasCurrentAtCapture && !providerBinding) {
      throw new Error(t('errorMetadataNotConfirmed', undefined, 'Phiên app chưa xác nhận metadata hiện tại. Hãy chờ SonFlash đồng bộ rồi thử lại.'));
    }
    if (retry?.providerId && !providerBinding) {
      throw new Error(t('errorRetrySessionUnverified', undefined, 'Không thể xác minh phiên app của lượt thử lại. Hãy chọn lại văn bản và tạo flashcard mới.'));
    }
    if (retry && providerBinding && !jobProviderBindingIsCurrent(providerBinding)) {
      providerBinding = rebindRetryProviderBinding(providerBinding);
      if (!providerBinding) {
        await clearRetry(input.tabId);
        throw new Error(t('errorRetrySessionUnverified', undefined, 'Không thể xác minh phiên app của lượt thử lại. Hãy chọn lại văn bản và tạo flashcard mới.'));
      }
    }
    // A retry must preserve the captured course language, including a
    // language recorded as unknown. Receipts with neither are ambiguous, so
    // require the user to capture again. A new capture with no provider at its
    // start stays unknown even if a provider appears while selection is being
    // read; otherwise that later provider could lend its locale to an unbound
    // job.
    const retryLanguageUnknown = retry?.sourceLanguage === UNKNOWN_CAPTURE_LANGUAGE;
    const sourceLanguage = retry
      ? (retryLanguageUnknown ? '' : normalizeCourseTargetLanguage(retry.sourceLanguage))
      : providerBinding
        ? await activeCaptureSourceLanguage()
        : '';
    if (retry && !sourceLanguage && !retryLanguageUnknown) throw new Error(t('errorRetryLanguageUnverified', undefined, 'Không thể xác minh ngôn ngữ của lượt thử lại. Hãy chọn lại văn bản và tạo flashcard mới.'));
    if (!retry && providerBinding && !jobProviderBindingIsCurrent(providerBinding)) {
      throw providerError();
    }
    const ownerMarker = await readOwnerMarker();
    const job={v:IMPORT_PROTOCOL_VERSION,id,nonce,text:s.text,context:bounded(s.context,MAX_CONTEXT_LENGTH),...(sourceLanguage ? { sourceLanguage } : {}),mode:'silent',sourceTabId:s.sourceTabId,workerTabId:null,anchor:s.anchor,createdAt:Date.now(),sourceUrl:s.sourceUrl||'',pageTitle:s.pageTitle||'',...(providerBinding ?? {}),...(ownerMarker ? { ownerMarker } : {}),...(requestedDeck ? { requestedDeck } : {})};
    if (quickAddSourceLocks.has(job.sourceTabId)) throw new Error(t('errorConcurrentJob', undefined, 'Đã có một tác vụ quick-add đang chạy trên tab này.'));
    quickAddSourceLocks.add(job.sourceTabId);
    try {
      return await withQuickAddCapacityLock(async () => {
        const now = Date.now();
        const activeJobs = [];
        for (const existing of await readJobs()) {
          if (isExpiredJob(existing, now)) await cleanup(existing);
          else activeJobs.push(existing);
        }
        if (activeJobs.some(existing => existing.sourceTabId === job.sourceTabId)) {
          throw new Error(t('errorConcurrentJob', undefined, 'Đã có một tác vụ quick-add đang chạy trên tab này.'));
        }
        if (activeJobs.length >= MAX_ACTIVE_JOBS) {
          throw new Error(t('errorTooManyJobs', undefined, 'Extension đang có quá nhiều tác vụ quick-add. Hãy chờ một tác vụ hoàn tất rồi thử lại.'));
        }
        await show(job.sourceTabId,{status:'loading-save',modeLabel:t('bubbleModeSaveOneAi', undefined, 'TẠO + LƯU • 1 AI REQUEST'),text:job.text,anchor:job.anchor});
        // Critical ordering: persist job first, then create about:blank, persist tab id,
        // and only then navigate. Fast app responses can no longer beat job storage.
        await saveJob(job);
        const importUrl=buildImportUrl(DEFAULT_APP_URL,job.text,{id,nonce:job.nonce,mode:'silent',createdAt:job.createdAt});
        const tab=await apiCall(extensionApi.tabs,'create',{url:'about:blank',active:false});
        if (typeof tab?.id!=='number') throw new Error(t('errorCreateBackgroundWorker', undefined, 'Không thể tạo tiến trình LingoFlash ở nền.'));
        job.workerTabId=tab.id; await saveJob(job); createAlarm(id, job.createdAt);
        await apiCall(extensionApi.tabs,'update',tab.id,{url:importUrl,active:false});
        notifyPopupStatus({id:job.id,status:'loading-save',text:job.text});
        return {id,text:job.text};
      });
    } catch (error) {
      await reportQuickAddFailure(job, error);
      throw error;
    } finally {
      quickAddSourceLocks.delete(job.sourceTabId);
    }
  };

  // Bounded failure codes from the app and the page bridge. The extension shows its own catalog text for
  // a code and keeps the app's message only as a fallback; a code not listed here is dropped.
  const RESULT_REASONS = new Set(['quota-ai-cards','quota-daily','quota-service','quota','in-flight','auth','permission','network','configuration','timeout','failed','deck-missing','course-cancelled','course-unavailable','invalid-selection','account-changed','not-verified','storage-unavailable','runtime-timeout','requires-runtime','compat-failed']);
  const normalizeResult = p => {
    if (!p||typeof p!=='object'||Array.isArray(p)||typeof p.id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(p.id)||!isValidImportNonce(p.nonce)||!['created','existing','auth-required','error'].includes(p.status)) return null;
    return {id:p.id,nonce:p.nonce,status:p.status,word:bounded(p.word,80),translation:bounded(p.translation,256),phonetic:bounded(p.phonetic,256),explanation:bounded(p.explanation,1024),exampleSentence:bounded(p.exampleSentence,1024),exampleTranslation:bounded(p.exampleTranslation,1024),aiGenerated:p.aiGenerated===true,language:normalizeCourseTargetLanguage(p.language),message:bounded(p.message,512),...(RESULT_REASONS.has(p.reason)?{reason:p.reason}:{})};
  };
  const appResult = async (payload,sender) => {
    const r=normalizeResult(payload); if (!r) throw new Error('Kết quả LingoFlash không hợp lệ.');
    let origin=''; try { origin=new URL(sender?.url||'').origin; } catch {} if (origin!==APP_ORIGIN) throw new Error('Nguồn kết quả LingoFlash không hợp lệ.');
    const existingResult = resultLocks.get(r.id);
    if (existingResult) {
      // Let a competing request retry after the current claim finishes. This
      // keeps a forged result from occupying the lock and suppressing a valid
      // result that arrives at the same time.
      await existingResult.catch(() => undefined);
      return appResult(payload,sender);
    }
    const processing = (async () => {
      let job=await readJob(r.id); if (!job) return {ignored:true};
      if (typeof sender?.tab?.id!=='number'||sender.tab.id!==job.workerTabId||sender.frameId!==0) throw new Error('Tab/frame trả kết quả không khớp với tác vụ LingoFlash.');
      if (r.nonce !== job.nonce) throw new Error('Nonce kết quả LingoFlash không khớp với tác vụ.');
      if (job.resultClaimedAt || job.errorClaimedAt) return {ignored:true};
      job = await claimTerminalResult(job);
      if (!job) return {ignored:true};

      let inlineShown = true;
      if (r.status==='created'||r.status==='existing') {
        await clearRetry(job.sourceTabId);
        // The saved card's language is the truth: a capture sent without a language is saved in the
        // learner's active course, whatever language that is. Leave the label empty rather than guess.
        let translated = { text: r.translation, sourceLanguage: r.language || normalizeCourseTargetLanguage(job.sourceLanguage) || '' };
        if (!translated.text) try { translated = await googleTranslate(job.text); } catch {}
        const translation=bounded(translated.text,256);
        // The result came from the verified worker tab and the app wrote the card, so it is
        // always reported. A capture finished after another account took over stays out of that account's history.
        if (await jobOwnerIsCurrent(job)) await recordRecentLookup({text:job.text,translation,sourceLanguage:translated.sourceLanguage,targetLanguage:'vi',kind:'create',status:r.status,timestamp:Date.now()});
        const displayed = await show(job.sourceTabId,{status:r.status,modeLabel:t('bubbleModeSaveOneAi', undefined, 'TẠO + LƯU • 1 AI REQUEST'),text:job.text,anchor:job.anchor,translation,speechLocale:speechLocaleForLanguage(translated.sourceLanguage),sourceLanguage:translated.sourceLanguage,phonetic:r.phonetic,explanation:r.explanation,exampleSentence:r.exampleSentence,exampleTranslation:r.exampleTranslation,aiGenerated:r.aiGenerated});
        inlineShown = displayed.ok;
        notifyPopupStatus({
          id: job.id,
          status: r.status,
          text: job.text,
          translation,
          sourceLanguage: translated.sourceLanguage,
          speechLocale: speechLocaleForLanguage(translated.sourceLanguage),
          phonetic: r.phonetic,
          explanation: r.explanation,
          exampleSentence: r.exampleSentence,
          exampleTranslation: r.exampleTranslation,
          aiGenerated: r.aiGenerated,
          inlineShown,
        });
      } else if (r.status==='auth-required') {
        await saveRetry(job);
        const displayed = await show(job.sourceTabId,{status:'auth-required',modeLabel:t('bubbleModeSave', undefined, 'TẠO + LƯU'),text:job.text,anchor:job.anchor,loginUrl:DEFAULT_APP_URL});
        inlineShown = displayed.ok;
        notifyPopupStatus({id:job.id,status:'auth-required',text:job.text,inlineShown});
      } else {
        await saveRetry(job);
        const displayed = await show(job.sourceTabId,{status:'error',modeLabel:t('bubbleModeSave', undefined, 'TẠO + LƯU'),text:job.text,anchor:job.anchor,message:r.message||t('statusGenericError', undefined, 'Không thể tạo hoặc lưu flashcard này.'),reason:r.reason,retryId:job.id});
        inlineShown = displayed.ok;
        notifyPopupStatus({id:job.id,status:'error',text:job.text,message:r.message||t('statusGenericError', undefined, 'Không thể tạo hoặc lưu flashcard này.'),reason:r.reason,inlineShown});
      }
      await cleanup(job); return {ignored:false};
    })();
    resultLocks.set(r.id, processing);
    try { return await processing; } finally { resultLocks.delete(r.id); }
  };

  const verifyImportIntent = async (payload,sender) => {
    const intent = normalizeSilentImportIntent(payload);
    if (!intent) return {verified:false};
    const lockKey = intent.id;
    const existingLock = verifyLocks.get(lockKey);
    if (existingLock) {
      await existingLock;
      return {verified:false};
    }

    const verification = (async () => {
      let origin = '';
      try { origin = new URL(sender?.url || '').origin; } catch {}
      if (origin !== APP_ORIGIN || typeof sender?.tab?.id !== 'number' || sender.frameId !== 0) return {verified:false};

      const job = await readJob(intent.id);
      if (!job || job.importClaimedAt || job.resultClaimedAt || job.errorClaimedAt) return {verified:false};
      const now = Date.now();
      const expired = !Number.isSafeInteger(job.createdAt)
        || job.createdAt > now
        || now - job.createdAt >= JOB_TIMEOUT_MS;
      if (expired) {
        await cleanup(job);
        return {verified:false};
      }
      if (job.v !== intent.v || job.mode !== intent.mode || job.workerTabId !== sender.tab.id) return {verified:false};
      if (job.text !== intent.text || job.nonce !== intent.nonce || job.createdAt !== intent.createdAt) return {verified:false};
      if (!jobProviderBindingIsCurrent(job)) return {verified:false};

      job.importClaimedAt = Date.now();
      await saveJob(job);
      return {
        verified:true,
        intent: { v: IMPORT_PROTOCOL_VERSION, id: job.id, nonce: job.nonce, text: job.text, context: bounded(job.context,MAX_CONTEXT_LENGTH), createdAt: job.createdAt, mode: 'silent', ...(normalizeCourseTargetLanguage(job.sourceLanguage) ? { sourceLanguage: normalizeCourseTargetLanguage(job.sourceLanguage) } : {}), ...(typeof job.requestedDeck === 'string' && job.requestedDeck ? { requestedDeck: job.requestedDeck.slice(0, 128) } : {}), ...(typeof job.sourceUrl === 'string' && job.sourceUrl ? { sourceUrl: sanitizeSourceUrl(job.sourceUrl) } : {}), ...(typeof job.pageTitle === 'string' && job.pageTitle ? { pageTitle: boundedPageTitle(job.pageTitle) } : {}) },
      };
    })();
    verifyLocks.set(lockKey, verification);
    try { return await verification; } finally { verifyLocks.delete(lockKey); }
  };

  const shortcut = async name => { try { const c=await apiCall(extensionApi.commands,'getAll'); return (Array.isArray(c)?c.find(x=>x.name===name):null)?.shortcut||''; } catch { return ''; } };
  const shortcutSettingsAvailable = !(/Safari\//.test(globalThis.navigator?.userAgent || '') && !/(?:Chrome|Chromium|CriOS|Edg)\//.test(globalThis.navigator?.userAgent || ''));
  // `target: 'webWords'` is what the popup's loop banner sends, and `target:
  // 'today'` (07.6) is what the due-count badge sends so it lands the user
  // directly on the study session instead of the plain library view every
  // other OPEN_APP caller (sign-in link, generic "open app") still opens.
  const openApp = async (target) => {
    const url = target === 'webWords'
      ? (() => { const u = new URL(DEFAULT_APP_URL); u.searchParams.set('webWords', '1'); return u.toString(); })()
      : target === 'today'
        ? (() => { const u = new URL(DEFAULT_APP_URL); u.searchParams.set('view', 'today'); return u.toString(); })()
        : DEFAULT_APP_URL;
    await apiCall(extensionApi.tabs,'create',{url,active:true});
    return {url};
  };
  const openShortcutSettings = async () => {
    if (!shortcutSettingsAvailable) throw new Error(t('errorShortcutsSafari', undefined, 'Hãy cấu hình phím tắt trong phần cài đặt Extensions của Safari.'));
    const url='chrome://extensions/shortcuts';
    await apiCall(extensionApi.tabs,'create',{url,active:true});
    return {url};
  };
  const invocationError = async (tabId,e,text='') => show(tabId,{status:'error',text,message:e instanceof Error?e.message:String(e)});
  const installMenus = () => { if (!extensionApi.contextMenus) return; void (async()=>{ try{await apiCall(extensionApi.contextMenus,'removeAll');}catch{} try{await apiCall(extensionApi.contextMenus,'create',{id:CONTEXT_TRANSLATE_ID,title:t('contextMenuTranslateOnly',undefined,'SonFlash: Dịch “%s”'),contexts:['selection']}); await apiCall(extensionApi.contextMenus,'create',{id:CONTEXT_SAVE_ID,title:t('contextMenuTranslateSave',undefined,'SonFlash: Dịch + tạo flashcard'),contexts:['selection']});}catch{} })(); };
  extensionApi.runtime?.onInstalled?.addListener(() => { installMenus(); void sweepExpiredJobs(); void syncSelectionIconRegistration().catch(() => undefined); });
  extensionApi.runtime?.onStartup?.addListener(() => { installMenus(); void sweepExpiredJobs(); void syncSelectionIconRegistration().catch(() => undefined); });
  installMenus();
  void sweepExpiredJobs();
  // A worker restart loses active-scope proof. Clear any browser-owned badge
  // until the signed-in app confirms a current scope again.
  void withDueCountLock(() => clearDueCountActionBadge());
  void syncSelectionIconRegistration().catch(() => undefined);
  void readRecentLookups();
  extensionApi.permissions?.onRemoved?.addListener?.(permissions => { void handleSelectionIconPermissionRemoved(permissions); });
  extensionApi.contextMenus?.onClicked?.addListener((info,tab)=>{ const fn=info.menuItemId===CONTEXT_TRANSLATE_ID?translateOnly:info.menuItemId===CONTEXT_SAVE_ID?quickAdd:null; if(fn) void fn({tabId:tab?.id,suppliedText:info.selectionText??''}).catch(e=>invocationError(tab?.id,e,info.selectionText??'')); });
  extensionApi.commands?.onCommand?.addListener((cmd,tab)=>{ if(![SAVE_COMMAND_ID,TRANSLATE_COMMAND_ID].includes(cmd))return; void(async()=>{const t=tab?.id?tab:await activeTab(); try{await(cmd===TRANSLATE_COMMAND_ID?translateOnly:quickAdd)({tabId:t?.id});}catch(e){await invocationError(t?.id,e);}})(); });
  extensionApi.alarms?.onAlarm?.addListener(a=>{ if(!a?.name?.startsWith(JOB_ALARM_PREFIX))return; const id=a.name.slice(JOB_ALARM_PREFIX.length); void(async()=>{try { const pending=cleanupLocks.get(id); if(pending){if(!(await pending))createAlarm(id); return;} const j=await readJob(id); if(!j)return; if(!isExpiredJob(j)){createAlarm(id,j.createdAt); return;} if(j.resultClaimedAt||j.errorClaimedAt){if(!(await cleanup(j)))createAlarm(id,j.createdAt); return;} const message=t('errorJobIncomplete', undefined, 'LingoFlash chưa hoàn tất. Mở extension và kiểm tra đăng nhập/AI rồi thử lại.'); const errorClaim=await claimTerminalError(j); if(errorClaim===null){createAlarm(id,j.createdAt); return;} if(errorClaim){await show(j.sourceTabId,{status:'error',modeLabel:t('bubbleModeSave', undefined, 'TẠO + LƯU'),text:j.text,anchor:j.anchor,message,retryId:j.id}); notifyPopupStatus({id:j.id,status:'error',text:j.text,message,inlineShown:false});} if(!(await cleanup(j)))createAlarm(id,j.createdAt);} catch { createAlarm(id); }})(); });
  extensionApi.tabs?.onRemoved?.addListener(tabId=>{
    void (async () => {
      for (const job of await readJobs()) {
        if (job.sourceTabId !== tabId && job.workerTabId !== tabId) continue;
        if (tabRemovalLocks.has(job.id) || cleanupLocks.has(job.id)) continue;
        tabRemovalLocks.set(job.id, true);
        const sourceClosed = job.sourceTabId === tabId;
        const message = sourceClosed
          ? t('errorSourceTabClosed', undefined, 'Tab nguồn đã đóng trước khi LingoFlash hoàn tất.')
          : t('errorBackgroundTabClosed', undefined, 'Tiến trình LingoFlash ở nền đã bị đóng trước khi hoàn tất.');
        const errorClaim = await claimTerminalError(job);
        if (errorClaim === null) {
          createAlarm(job.id, job.createdAt);
          continue;
        }
        if (errorClaim) {
          if (!sourceClosed) {
            await show(job.sourceTabId,{status:'error',modeLabel:t('bubbleModeSave', undefined, 'TẠO + LƯU'),text:job.text,anchor:job.anchor,message,retryId:job.id});
          }
          notifyPopupStatus({id:job.id,status:'error',text:job.text,message,inlineShown:false});
        }
        if (!(await cleanup(job))) createAlarm(job.id, job.createdAt);
      }
      await clearRetry(tabId);
    })();
  });

  const handle = async (m,sender) => {
    const type=m&&typeof m==='object'?m.type:'';
    if(type==='GET_SELECTION'){const t=await activeTab(),c=await capture(t?.id);return{ok:true,text:c.text,pageLanguage:c.text?c.pageLanguage||'':''};}
    if(type==='TRANSLATE_SELECTION'){const t=await activeTab();return{ok:true,...await translateOnly({tabId:t?.id,suppliedText:m.text??''})};}
    if(type==='RETRY_QUICK_ADD'){
      // The in-page bubble is a content script and always has sender.tab. The
      // popup has no sender.tab (it is not injected into the page), so a
      // retry requested from the popup's own error state falls back to the
      // active tab — the same tab-resolution ADD_SELECTION/GET_SELECTION
      // already use for popup-originated calls (07.1 popup error/quota state).
      const tabId=typeof sender?.tab?.id==='number'?sender.tab.id:(await activeTab())?.id;
      if(typeof tabId!=='number') throw new Error(t('errorNoSourceTab', undefined, 'Không tìm thấy tab nguồn để thử lại.'));
      const receipt=await readRetry(tabId);
      if(!receipt || receipt.id!==m.id) throw new Error(t('errorRetryExpired', undefined, 'Lượt thử lại đã hết hạn. Hãy chọn lại từ.'));
      return {ok:true,...await quickAdd({tabId,retryReceipt:receipt})};
    }
    if(type==='INLINE_SELECTION_ADD'){
      // Sent only by the Save button of a quick translation drawn in this tab.
      // It names the one-time id issued with that translation; the word and
      // course come from the stored receipt, never from the message.
      if(typeof sender?.tab?.id!=='number') throw new Error(t('errorNoSourceTabSave', undefined, 'Không tìm thấy tab nguồn để lưu.'));
      const receipt=await takeInlineSave(sender.tab.id,m.id);
      if(!receipt) throw new Error(t('errorSaveExpired', undefined, 'Lượt lưu này đã hết hạn. Hãy chọn lại từ.'));
      const course=await confirmedCourseLocale();
      if(!course || course.targetLanguage!==receipt.courseLanguage) throw new Error(t('errorCourseChanged', undefined, 'Khóa học đang dùng đã thay đổi. Hãy chọn lại từ.'));
      return {ok:true,...await quickAdd({tabId:sender.tab.id,suppliedText:receipt.text})};
    }
    if(type==='ADD_SELECTION'){const t=await activeTab();return{ok:true,...await quickAdd({tabId:t?.id,suppliedText:m.text??'',requestedDeck:m.requestedDeck})};}
    if(type==='OPEN_APP')return{ok:true,...await openApp(typeof m.target==='string'?m.target:undefined)};
    if(type==='OPEN_SHORTCUTS')return{ok:true,...await openShortcutSettings()};
    if(type==='GET_SHORTCUTS')return{ok:true,shortcutSettingsAvailable,saveShortcut:await shortcut(SAVE_COMMAND_ID),translateShortcut:await shortcut(TRANSLATE_COMMAND_ID)};
    if(type==='GET_RECENT_LOOKUPS')return{ok:true,items:await readRecentLookups()};
    if(type==='CLEAR_RECENT_LOOKUPS')return{ok:true,items:await clearRecentLookups()};
    if(type==='GET_ACTIVE_SITE'){
      const tab=await activeTab();
      const pattern=selectionIconSitePatternFromUrl(tab?.url || '');
      const state=await getSelectionIconSites();
      return {ok:true,url:typeof tab?.url==='string'?tab.url:'',pattern,protected:isProtectedSelectionIconUrl(tab?.url || ''),enabled:pattern ? state.permittedSites.includes(pattern) : false};
    }
    if(type==='GET_SELECTION_ICON_SITES')return{ok:true,...await getSelectionIconSites()};
    if(type==='ENABLE_SELECTION_ICON_SITE')return{ok:true,...await enableSelectionIconSite(m.pattern)};
    if(type==='DISABLE_SELECTION_ICON_SITE')return{ok:true,...await disableSelectionIconSite(m.pattern)};
    if(type==='FLOATING_SELECTION_ADD'){
      if(typeof sender?.tab?.id!=='number') throw new Error(t('errorNoActiveTab', undefined, 'Không tìm thấy tab đang hoạt động.'));
      const pattern=selectionIconSitePatternFromUrl(sender.tab.url || sender.url || '');
      const settings=await readSettings();
      if(!pattern || isProtectedSelectionIconUrl(sender.tab.url || sender.url || '')
        || !normalizeSelectionIconSites(settings.selectionIconSites).includes(pattern)
        || !(await hasSelectionIconPermission(pattern))) {
        throw new Error(t('errorFloatingIconNotEnabled', undefined, 'Floating icon chưa được bật cho website này.'));
      }
      return {ok:true,...await quickAdd({tabId:sender.tab.id,suppliedText:m.text ?? ''})};
    }
    if(type==='GET_DECK_METADATA_GENERATION'){
      if (!appOriginIsValid(sender)) throw new Error('Nguồn metadata deck không hợp lệ.');
      const provider = claimProvider(m.providerId, sender);
      return withDeckMetadataLock(async () => {
        if (!providerIsCurrent(provider)) throw providerError();
        const generation = await readDeckMetadataGeneration() || createImportNonce();
        if (!await readDeckMetadataGeneration()) await apiCall(deckMetadataStorage, 'set', { [DECK_METADATA_GENERATION_STORAGE_KEY]: generation });
        return {ok:true,generation};
      });
    }
    if(type==='SYNC_DECK_METADATA')return{ok:true,...await syncDeckMetadata(m.payload,sender,m.providerId)};
    if(type==='CLEAR_DECK_METADATA')return{ok:true,...await clearDeckMetadata(m.payload,sender,m.providerId)};
    if(type==='SYNC_DUE_COUNT')return{ok:true,...await syncDueCount(m.payload,sender,m.providerId)};
    if(type==='CLEAR_DUE_COUNT')return{ok:true,...await clearDueCount(m.payload,sender,m.providerId)};
    if(type==='GET_DUE_COUNT'){
      const generation = providerIsCurrent(currentProvider) ? currentProvider.generation : 0;
      const scope = confirmedDueCountScope;
      const metadata=await readDueCountMetadata();
      const currentGeneration = providerIsCurrent(currentProvider) ? currentProvider.generation : 0;
      if (generation !== currentGeneration || scope !== confirmedDueCountScope) {
        return { ok: true, count: null, generation: currentGeneration, scope: confirmedDueCountScope };
      }
      const confirmed = metadata && metadata.scope===scope ? metadata : null;
      return { ok: true, count: confirmed?.count ?? null, generation, scope: confirmed?.scope ?? '' };
    }
    if(type==='SYNC_COURSE_LOCALE')return{ok:true,...await syncCourseLocale(m.payload,sender,m.providerId)};
    if(type==='CLEAR_COURSE_LOCALE')return{ok:true,...await clearCourseLocale(m.payload,sender,m.providerId)};
    if(type==='GET_COURSE_LOCALE'){
      const generation = providerIsCurrent(currentProvider) ? currentProvider.generation : 0;
      const scope = confirmedCourseLocaleScope;
      const metadata=await readCourseLocaleMetadata();
      const currentGeneration = providerIsCurrent(currentProvider) ? currentProvider.generation : 0;
      if (generation !== currentGeneration || scope !== confirmedCourseLocaleScope) {
        return {
          ok: true,
          nativeLanguage: null,
          targetLanguage: null,
          generation: currentGeneration,
          scope: confirmedCourseLocaleScope,
        };
      }
      const confirmed=metadata && metadata.scope===scope ? metadata : null;
      return {
        ok: true,
        nativeLanguage: confirmed?.nativeLanguage ?? null,
        targetLanguage: confirmed?.targetLanguage ?? null,
        generation,
        scope: confirmed?.scope ?? '',
      };
    }
    if(type==='GET_DECKS'){
      const generation = providerIsCurrent(currentProvider) ? currentProvider.generation : 0;
      const scope = confirmedDeckScope;
      const metadata=await readDeckMetadata();
      const currentGeneration = providerIsCurrent(currentProvider) ? currentProvider.generation : 0;
      if (generation !== currentGeneration || scope !== confirmedDeckScope) {
        return { ok: false, error: t('statusDeckNotSynced', undefined, 'Deck chưa được đồng bộ; hãy mở LingoFlash một lần.'), generation: currentGeneration, scope: confirmedDeckScope };
      }
      if(!metadata || metadata.scope !== scope)throw new Error(t('statusDeckNotSynced', undefined, 'Deck chưa được đồng bộ; hãy mở LingoFlash một lần.'));
      return{ok:true,decks:metadata.decks,generation,scope:metadata.scope};
    }
    if(type==='UPDATE_USER_SETTINGS')return{ok:true,settings:await writeUserSettings(m.changes)};
    if(type===VERIFY_IMPORT_MESSAGE)return{ok:true,...await verifyImportIntent(m.payload,sender)};
    if(type==='APP_IMPORT_RESULT'&&m.bridgeType===APP_RESULT_MESSAGE)return{ok:true,...await appResult(m.payload,sender)};
    throw new Error(t('errorUnsupportedRequest', undefined, 'Yêu cầu extension không được hỗ trợ.'));
  };
  const registerAppBridgePort = port => {
    if (port?.name !== APP_BRIDGE_PORT_NAME || !providerSenderIsValid(port.sender)) {
      try { port?.disconnect?.(); } catch {}
      return;
    }
    retireAllProviders();
    const provider = {
      id: createProviderId(),
      generation: ++providerGeneration,
      tabId: port.sender.tab.id,
      port,
      active: true,
      retired: false,
      claimed: false,
    };
    providers.set(provider.id, provider);
    try {
      port.onDisconnect?.addListener?.(() => {
        if (providers.get(provider.id) !== provider) return;
        retireProvider(provider);
      });
      port.postMessage({
        type: APP_BRIDGE_PROVIDER_MESSAGE,
        providerId: provider.id,
        generation: provider.generation,
      });
    } catch {
      retireProvider(provider);
    }
  };
  extensionApi.runtime?.onConnect?.addListener(registerAppBridgePort);
  extensionApi.runtime?.onMessage?.addListener((m,s,r)=>{const p=handle(m,s).catch(e=>({ok:false,error:e instanceof Error?e.message:String(e)}));if(usesPromiseApi)return p;p.then(r);return true;});
})();
