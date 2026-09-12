'use strict';

(() => {
  const {
    APP_ORIGIN, DEFAULT_APP_URL, IMPORT_PROTOCOL_VERSION, MAX_CONTEXT_LENGTH, DECK_METADATA_STORAGE_KEY, extensionApi, transientStorage, deckMetadataStorage, usesPromiseApi,
    apiCall, buildImportUrl, createImportNonce, createIntentId, isValidImportNonce, selectionValidation, normalizeSilentImportIntent,
    readSettings, writeUserSettings, updateSelectionIconSites, readRecentLookups, recordRecentLookup, clearRecentLookups, normalizeDeckScope, normalizeDeckMetadata,
    normalizeSelectionIconSites, selectionIconSitePatternFromUrl, isProtectedSelectionIconUrl,
  } = globalThis.LingoFlashExtension;
  const { captureSelectionFromPage, renderInlineBubble } = globalThis.LingoFlashExtensionUi;
  const VERSION = extensionApi.runtime.getManifest().version;
  const CONTEXT_TRANSLATE_ID = 'lingoflash-translate-only';
  const CONTEXT_SAVE_ID = 'lingoflash-translate-save';
  const SAVE_COMMAND_ID = 'translate-selection';
  const TRANSLATE_COMMAND_ID = 'translate-only-selection';
  const JOB_KEY_PREFIX = 'lingoflash_quick_add_job_';
  const JOB_ALARM_PREFIX = 'lingoflash_quick_add_timeout_';
const JOB_TIMEOUT_MINUTES = 2.5;
  const JOB_TIMEOUT_MS = JOB_TIMEOUT_MINUTES * 60 * 1000;
  const MAX_ACTIVE_JOBS = 3;
  const GOOGLE_TRANSLATE_TIMEOUT_MS = 9_000;
  const APP_RESULT_MESSAGE = 'LINGOFLASH_EXTENSION_RESULT';
  const QUICK_ADD_STATUS_MESSAGE = 'QUICK_ADD_STATUS';
  const SELECTION_ICON_SCRIPT_ID = 'lingoflash-selection-icon';
  const SELECTION_ICON_DISABLED_MESSAGE = 'FLOATING_SELECTION_DISABLED';
  const VERIFY_IMPORT_MESSAGE = 'VERIFY_IMPORT_INTENT';
  const jobLocks = new Map();
  const withJobLock = async (id, work) => {
    const previous = jobLocks.get(id) ?? Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    jobLocks.set(id, current);
    await previous.catch(() => undefined);
    try { return await work(); }
    finally {
      release();
      if (jobLocks.get(id) === current) jobLocks.delete(id);
    }
  };
  const cleanupLocks = new Map();
  const tabRemovalLocks = new Map();
  const quickAddSourceLocks = new Set();
  let quickAddCapacityTail = Promise.resolve();
  let deckMetadataTail = Promise.resolve();
  let selectionIconRegistrationTail = Promise.resolve();
  const bounded = (v,n) => typeof v === 'string' ? v.trim().slice(0,n) : '';
  const key = id => `${JOB_KEY_PREFIX}${id}`;
  const alarmName = id => `${JOB_ALARM_PREFIX}${id}`;
  const saveJob = job => apiCall(transientStorage,'set',{[key(job.id)]:job});
  const readJob = async id => (await apiCall(transientStorage,'get',key(id)))?.[key(id)] ?? null;
  const removeJob = async id => {
    try {
      await apiCall(transientStorage, 'remove', key(id));
      return true;
    } catch {
      return false;
    }
  };
  const readJobs = async () => Object.entries(await apiCall(transientStorage,'get',null) ?? {}).filter(([k,v])=>k.startsWith(JOB_KEY_PREFIX)&&v&&typeof v==='object').map(([,v])=>v);
  const DECK_GENERATION_KEY = `${DECK_METADATA_STORAGE_KEY}_generation`;
  const readDeckGeneration = async () => {
    const stored = (await apiCall(deckMetadataStorage, 'get', DECK_GENERATION_KEY))?.[DECK_GENERATION_KEY];
    if (normalizeDeckScope(stored)) return stored;
    const generation = createImportNonce();
    await apiCall(deckMetadataStorage, 'set', { [DECK_GENERATION_KEY]: generation });
    return generation;
  };
  const readDeckMetadata = async () => {
    const stored = (await apiCall(deckMetadataStorage, 'get', DECK_METADATA_STORAGE_KEY))?.[DECK_METADATA_STORAGE_KEY];
    if (!stored || stored.generation !== await readDeckGeneration()) return null;
    return normalizeDeckMetadata(stored);
  };
  const withDeckMetadataLock = async work => {
    const previous = deckMetadataTail;
    let release;
    deckMetadataTail = new Promise(resolve => { release = resolve; });
    await previous.catch(() => undefined);
    try { return await work(); } finally { release(); }
  };
  const clearAlarm = async id => { try { await apiCall(extensionApi.alarms,'clear',alarmName(id)); } catch {} };
  const closeTab = async id => { if (typeof id==='number') try { await apiCall(extensionApi.tabs,'remove',id); } catch {} };
  const cleanup = (job, workerClosed = false) => {
    if (!job || typeof job.id !== 'string') return Promise.resolve(false);
    const existing = cleanupLocks.get(job.id);
    if (existing) return existing;
    const pending = (async () => {
      // Remove the persisted job before closing its worker tab. Chrome can
      // deliver tabs.onRemoved synchronously; leaving the job visible while
      // closing the tab makes a successful result look like a worker failure.
      const removed = await removeJob(job.id);
      if (!removed) return false;
      await Promise.allSettled([clearAlarm(job.id), workerClosed ? null : closeTab(job.workerTabId)]);
      return true;
    })();
    const tracked = pending.finally(() => {
      cleanupLocks.delete(job.id);
      tabRemovalLocks.delete(job.id);
    });
    cleanupLocks.set(job.id, tracked);
    return tracked;
  };
  const createAlarm = id => { try { extensionApi.alarms?.create(alarmName(id),{delayInMinutes:JOB_TIMEOUT_MINUTES}); } catch {} };
  const isExpiredJob = (job, now = Date.now()) => !Number.isSafeInteger(job?.createdAt)
    || job.createdAt > now
    || now - job.createdAt >= JOB_TIMEOUT_MS;
  const expireJob = (snapshot, message, removedTabId = null) => withJobLock(snapshot.id, async () => {
    const job = await readJob(snapshot.id);
    if (!job) return;
    if (job.resultClaimedAt || job.errorClaimedAt) {
      if (!(await cleanup(job))) createAlarm(job.id);
      return;
    }
    tabRemovalLocks.set(job.id, true);
    try {
      // Retire the surface before announcing failure: it may still hold a
      // verified handoff. Keep the durable job if closure cannot be confirmed.
      if (typeof job.workerTabId === 'number' && job.workerTabId !== removedTabId) {
        let closed = false;
        try { await apiCall(extensionApi.tabs, 'remove', job.workerTabId); closed = true; }
        catch {
          try {
            const tabs = await apiCall(extensionApi.tabs, 'query', {});
            closed = Array.isArray(tabs) && !tabs.some(tab => tab.id === job.workerTabId);
          } catch { /* An unreadable tab list cannot confirm retirement. */ }
        }
        if (!closed) { createAlarm(job.id); return; }
      }
      job.errorClaimedAt = Date.now();
      try { await saveJob(job); }
      catch { createAlarm(job.id); return; } // Never announce an uncommitted result.
      const displayed = removedTabId === job.sourceTabId ? { ok: false } : await show(job.sourceTabId,
        { status: 'error', modeLabel: 'TẠO + LƯU', text: job.text, anchor: job.anchor, message });
      notifyPopupStatus({ id: job.id, status: 'error', text: job.text, message, inlineShown: displayed.ok });
      if (!(await cleanup(job, true))) createAlarm(job.id);
    } finally { tabRemovalLocks.delete(job.id); }
  });
  const withQuickAddCapacityLock = async work => {
    const previous = quickAddCapacityTail;
    let release;
    quickAddCapacityTail = new Promise(resolve => { release = resolve; });
    await previous.catch(() => undefined);
    try { return await work(); } finally { release(); }
  };
  const reportQuickAddFailure = async (job, error) => {
    const message = error instanceof Error ? error.message : 'Không thể khởi động LingoFlash.';
    if (typeof job.workerTabId === 'number' || await readJob(job.id)) {
      await expireJob(job, message);
      return;
    }
    const displayed = await show(job.sourceTabId,{status:'error',modeLabel:'TẠO + LƯU',text:job.text,anchor:job.anchor,message});
    notifyPopupStatus({id:job.id,status:'error',text:job.text,message,inlineShown:displayed.ok});
  };
  const sweepExpiredJobs = async () => {
    const now = Date.now();
    for (const job of await readJobs()) {
      if (!isExpiredJob(job, now)) continue;
      await expireJob(job, 'Tác vụ LingoFlash đã hết hạn. Hãy thử lại.');
    }
  };

  const show = async (tabId,payload) => {
    if (typeof tabId!=='number') return {ok:false,error:'Không tìm thấy tab để hiển thị kết quả.'};
    try {
      const settings = await readSettings();
      const result = await apiCall(extensionApi.scripting,'executeScript',{target:{tabId},func:renderInlineBubble,args:[{version:VERSION,...payload,bubbleDurationMs:settings.bubbleDurationMs,autoSpeak:settings.autoSpeak}]});
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
    if (typeof tabId !== 'number') return {text:direct.ok?direct.text:'',anchor:null,context:''};
    try {
      const r=await apiCall(extensionApi.scripting,'executeScript',{target:{tabId},func:captureSelectionFromPage});
      const capturedText=Array.isArray(r)?r[0]?.result?.text??'':'';
      const captured=selectionValidation(capturedText);
      if (!direct.ok) {
        return {text:captured.ok?captured.text:'',anchor:Array.isArray(r)?r[0]?.result?.anchor??null:null,context:Array.isArray(r)?r[0]?.result?.context??'':''};
      }
      const sameSelection=captured.ok && captured.text===direct.text;
      return {text:direct.text,anchor:sameSelection&&Array.isArray(r)?r[0]?.result?.anchor??null:null,context:sameSelection&&Array.isArray(r)?r[0]?.result?.context??'':''};
    } catch {
      return {text:direct.ok?direct.text:'',anchor:null,context:''};
    }
  };
  const selection = async ({tabId,suppliedText=''}={}) => {
    const tab=typeof tabId==='number'?{id:tabId}:await activeTab();
    if (typeof tab?.id!=='number') throw new Error('Không tìm thấy tab đang hoạt động.');
    const c=await capture(tab.id,suppliedText), v=selectionValidation(c.text); if (!v.ok) throw new Error(v.error);
    return {sourceTabId:tab.id,text:v.text,anchor:c.anchor,context:c.context || ''};
  };

  const appOriginIsValid = sender => {
    try { return new URL(sender?.url || '').origin === APP_ORIGIN; } catch { return false; }
  };
  const syncDeckMetadata = async (payload, sender) => {
    if (!appOriginIsValid(sender)) throw new Error('Nguồn metadata deck không hợp lệ.');
    const metadata = normalizeDeckMetadata(payload);
    if (!metadata) throw new Error('Metadata deck không hợp lệ.');
    return withDeckMetadataLock(async () => {
      const generation = await readDeckGeneration();
      if (payload.generation !== generation) throw new Error('Scope metadata deck đã hết hiệu lực.');
      await apiCall(deckMetadataStorage, 'set', { [DECK_METADATA_STORAGE_KEY]: { ...metadata, generation } });
      return { count: metadata.decks.length };
    });
  };
  const clearDeckMetadata = async (payload, sender) => {
    if (!appOriginIsValid(sender)) throw new Error('Nguồn metadata deck không hợp lệ.');
    const scope = normalizeDeckScope(payload?.scope);
    if (!scope) throw new Error('Scope metadata deck không hợp lệ.');
    return withDeckMetadataLock(async () => {
      if (payload.generation !== await readDeckGeneration()) return { cleared: false };
      // One atomic invalidation clears all publishers from this authenticated session.
      await apiCall(deckMetadataStorage, 'set', {
        [DECK_METADATA_STORAGE_KEY]: null,
        [DECK_GENERATION_KEY]: createImportNonce(),
      });
      return { cleared: true };
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
    if (!site || isProtectedSelectionIconUrl(site)) throw new Error('Website này không thể bật floating icon.');
    if (!(await hasSelectionIconPermission(site))) throw new Error('Website chưa được cấp quyền cho floating icon.');
    const mutation = await updateSelectionIconSites(sites => [...sites, site]);
    if (!mutation.settings.selectionIconSites.includes(site)) {
      // The bounded allowlist rejected this new site. Do not leave the
      // optional host permission behind or report a misleading success.
      try { await apiCall(extensionApi.permissions, 'remove', { origins: [site] }); } catch {}
      throw new Error('Đã đạt giới hạn 100 website cho floating icon.');
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
    if (!site) throw new Error('Website floating icon không hợp lệ.');
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
    u.search=new URLSearchParams({client:'gtx',sl:settings.quickTranslateSource,tl:settings.quickTranslateTarget,dt:'t',q:text}).toString();
    const controller = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
    let timeoutId = null;
    const timeout = new Promise((_, reject) => {
      timeoutId = globalThis.setTimeout(() => {
        controller?.abort();
        reject(new Error('Google Translate hết thời gian sau 9 giây.'));
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
        const t=chunks.map(x=>Array.isArray(x)&&typeof x[0]==='string'?x[0]:'').join('').trim();
        if (!t) throw new Error('Google Translate trả về kết quả trống.');
        return { text: t, sourceLanguage: normalizeDetectedLanguage(p?.[2]) || settings.quickTranslateSource || 'auto' };
      })();
      return await Promise.race([request, timeout]);
    } finally {
      if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
    }
  };
  const translateOnly = async input => {
    const s=await selection(input); await show(s.sourceTabId,{status:'loading-translate',modeLabel:'DỊCH NHANH • FREE',text:s.text,anchor:s.anchor});
    try {
      const translated=await googleTranslate(s.text);
      const settings=await readSettings();
      await recordRecentLookup({text:s.text,translation:translated.text,sourceLanguage:translated.sourceLanguage,targetLanguage:settings.quickTranslateTarget,kind:'translate',status:'translated',timestamp:Date.now()});
      const inline=await show(s.sourceTabId,{status:'translated',modeLabel:'DỊCH NHANH • GOOGLE',text:s.text,anchor:s.anchor,translation:bounded(translated.text,1024),speechLocale:speechLocaleForLanguage(translated.sourceLanguage)});
      return {text:s.text,translation:translated.text,sourceLanguage:translated.sourceLanguage,inlineShown:inline.ok};
    }
    catch(e){ await show(s.sourceTabId,{status:'error',modeLabel:'DỊCH NHANH • FREE',text:s.text,anchor:s.anchor,message:e instanceof Error?e.message:'Không thể dịch đoạn này.'}); throw e; }
  };

  const quickAdd = async input => {
    const s=await selection(input), id=createIntentId(), nonce=createImportNonce();
    const requestedDeck = typeof input?.requestedDeck === 'string' ? input.requestedDeck.trim().slice(0, 128) : '';
    const job={v:IMPORT_PROTOCOL_VERSION,id,nonce,text:s.text,context:bounded(s.context,MAX_CONTEXT_LENGTH),sourceLanguage:'en',mode:'silent',sourceTabId:s.sourceTabId,workerTabId:null,anchor:s.anchor,createdAt:Date.now(),...(requestedDeck ? { requestedDeck } : {})};
    if (quickAddSourceLocks.has(job.sourceTabId)) throw new Error('Đã có một tác vụ quick-add đang chạy trên tab này.');
    quickAddSourceLocks.add(job.sourceTabId);
    try {
      return await withQuickAddCapacityLock(async () => {
        const now = Date.now();
        const activeJobs = [];
        for (const existing of await readJobs()) {
          if (isExpiredJob(existing, now)) {
            await expireJob(existing, 'Tác vụ LingoFlash đã hết hạn. Hãy thử lại.');
            if (await readJob(existing.id)) activeJobs.push(existing);
          } else activeJobs.push(existing);
        }
        if (activeJobs.some(existing => existing.sourceTabId === job.sourceTabId)) {
          throw new Error('Đã có một tác vụ quick-add đang chạy trên tab này.');
        }
        if (activeJobs.length >= MAX_ACTIVE_JOBS) {
          throw new Error('Extension đang có quá nhiều tác vụ quick-add. Hãy chờ một tác vụ hoàn tất rồi thử lại.');
        }
        await show(job.sourceTabId,{status:'loading-save',modeLabel:'TẠO + LƯU • 1 AI REQUEST',text:job.text,anchor:job.anchor});
        // Critical ordering: persist job first, then create about:blank, persist tab id,
        // and only then navigate. Fast app responses can no longer beat job storage.
        await saveJob(job);
        const importUrl=buildImportUrl(DEFAULT_APP_URL,job.text,{id,nonce:job.nonce,mode:'silent',createdAt:job.createdAt});
        const tab=await apiCall(extensionApi.tabs,'create',{url:'about:blank',active:false});
        if (typeof tab?.id!=='number') throw new Error('Không thể tạo tiến trình LingoFlash ở nền.');
        job.workerTabId=tab.id; await saveJob(job); createAlarm(id);
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

  const normalizeResult = p => {
    if (!p||typeof p!=='object'||Array.isArray(p)||typeof p.id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(p.id)||!isValidImportNonce(p.nonce)||!['created','existing','auth-required','error'].includes(p.status)) return null;
    return {id:p.id,nonce:p.nonce,status:p.status,word:bounded(p.word,80),translation:bounded(p.translation,256),phonetic:bounded(p.phonetic,256),explanation:bounded(p.explanation,1024),exampleSentence:bounded(p.exampleSentence,1024),exampleTranslation:bounded(p.exampleTranslation,1024),message:bounded(p.message,512)};
  };
  const appResult = async (payload,sender) => {
    const r=normalizeResult(payload); if (!r) throw new Error('Kết quả LingoFlash không hợp lệ.');
    let origin=''; try { origin=new URL(sender?.url||'').origin; } catch {} if (origin!==APP_ORIGIN) throw new Error('Nguồn kết quả LingoFlash không hợp lệ.');
    return withJobLock(r.id, async () => {
      const job=await readJob(r.id); if (!job) return {ignored:true};
      if (typeof sender?.tab?.id!=='number'||sender.tab.id!==job.workerTabId||sender.frameId!==0) throw new Error('Tab/frame trả kết quả không khớp với tác vụ LingoFlash.');
      if (r.nonce !== job.nonce) throw new Error('Nonce kết quả LingoFlash không khớp với tác vụ.');
      if (job.resultClaimedAt || job.errorClaimedAt) return {ignored:true};

      // Claim before any rendering or fallback work. The in-memory lock closes
      // the read/claim race, while this persisted marker survives worker restarts.
      job.resultClaimedAt = Date.now();
      await saveJob(job);

      let inlineShown = true;
      if (r.status==='created'||r.status==='existing') {
        let translated = { text: r.translation, sourceLanguage: job.sourceLanguage || 'en' };
        if (!translated.text) try { translated = await googleTranslate(job.text); } catch {}
        const t=bounded(translated.text,256);
        await recordRecentLookup({text:job.text,translation:t,sourceLanguage:translated.sourceLanguage,targetLanguage:'vi',kind:'create',status:r.status,timestamp:Date.now()});
        const displayed = await show(job.sourceTabId,{status:r.status,modeLabel:'TẠO + LƯU • 1 AI REQUEST',text:job.text,anchor:job.anchor,translation:t,speechLocale:speechLocaleForLanguage(translated.sourceLanguage),phonetic:r.phonetic,explanation:r.explanation,exampleSentence:r.exampleSentence,exampleTranslation:r.exampleTranslation});
        inlineShown = displayed.ok;
        notifyPopupStatus({
          id: job.id,
          status: r.status,
          text: job.text,
          translation: t,
          sourceLanguage: translated.sourceLanguage,
          speechLocale: speechLocaleForLanguage(translated.sourceLanguage),
          phonetic: r.phonetic,
          explanation: r.explanation,
          exampleSentence: r.exampleSentence,
          exampleTranslation: r.exampleTranslation,
          inlineShown,
        });
      } else if (r.status==='auth-required') {
        const displayed = await show(job.sourceTabId,{status:'auth-required',modeLabel:'TẠO + LƯU',text:job.text,anchor:job.anchor,loginUrl:DEFAULT_APP_URL});
        inlineShown = displayed.ok;
        notifyPopupStatus({id:job.id,status:'auth-required',text:job.text,inlineShown});
      } else {
        const displayed = await show(job.sourceTabId,{status:'error',modeLabel:'TẠO + LƯU',text:job.text,anchor:job.anchor,message:r.message||'Không thể tạo hoặc lưu flashcard này.'});
        inlineShown = displayed.ok;
        notifyPopupStatus({id:job.id,status:'error',text:job.text,message:r.message||'Không thể tạo hoặc lưu flashcard này.',inlineShown});
      }
      await cleanup(job); return {ignored:false};
    });
  };

  const verifyImportIntent = async (payload,sender) => {
    const intent = normalizeSilentImportIntent(payload);
    if (!intent) return {verified:false};
    return withJobLock(intent.id, async () => {
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

      job.importClaimedAt = Date.now();
      await saveJob(job);
      return {
        verified:true,
        intent: { v: IMPORT_PROTOCOL_VERSION, id: job.id, nonce: job.nonce, text: job.text, context: bounded(job.context,MAX_CONTEXT_LENGTH), createdAt: job.createdAt, mode: 'silent', ...(typeof job.requestedDeck === 'string' && job.requestedDeck ? { requestedDeck: job.requestedDeck.slice(0, 128) } : {}) },
      };
    });
  };

  const shortcut = async name => { try { const c=await apiCall(extensionApi.commands,'getAll'); return (Array.isArray(c)?c.find(x=>x.name===name):null)?.shortcut||''; } catch { return ''; } };
  const shortcutSettingsAvailable = !(/Safari\//.test(globalThis.navigator?.userAgent || '') && !/(?:Chrome|Chromium|CriOS|Edg)\//.test(globalThis.navigator?.userAgent || ''));
  const openApp = async () => { await apiCall(extensionApi.tabs,'create',{url:DEFAULT_APP_URL,active:true}); return {url:DEFAULT_APP_URL}; };
  const openShortcutSettings = async () => {
    if (!shortcutSettingsAvailable) throw new Error('Hãy cấu hình phím tắt trong phần cài đặt Extensions của Safari.');
    const url='chrome://extensions/shortcuts';
    await apiCall(extensionApi.tabs,'create',{url,active:true});
    return {url};
  };
  const invocationError = async (tabId,e,text='') => show(tabId,{status:'error',text,message:e instanceof Error?e.message:String(e)});
  const installMenus = () => { if (!extensionApi.contextMenus) return; void (async()=>{ try{await apiCall(extensionApi.contextMenus,'removeAll');}catch{} try{await apiCall(extensionApi.contextMenus,'create',{id:CONTEXT_TRANSLATE_ID,title:'Dịch nhanh “%s” — không lưu',contexts:['selection']}); await apiCall(extensionApi.contextMenus,'create',{id:CONTEXT_SAVE_ID,title:'Dịch + thêm “%s” vào LingoFlash',contexts:['selection']});}catch{} })(); };
  extensionApi.runtime?.onInstalled?.addListener(() => { installMenus(); void sweepExpiredJobs().catch(() => console.warn('Job cleanup could not read storage; pending jobs were retained.')); void syncSelectionIconRegistration().catch(() => undefined); });
  extensionApi.runtime?.onStartup?.addListener(() => { installMenus(); void sweepExpiredJobs().catch(() => console.warn('Job cleanup could not read storage; pending jobs were retained.')); void syncSelectionIconRegistration().catch(() => undefined); });
  installMenus();
  void sweepExpiredJobs().catch(() => console.warn('Job cleanup could not read storage; pending jobs were retained.'));
  void syncSelectionIconRegistration().catch(() => undefined);
  void readRecentLookups();
  extensionApi.permissions?.onRemoved?.addListener?.(permissions => { void handleSelectionIconPermissionRemoved(permissions); });
  extensionApi.contextMenus?.onClicked?.addListener((info,tab)=>{ const fn=info.menuItemId===CONTEXT_TRANSLATE_ID?translateOnly:info.menuItemId===CONTEXT_SAVE_ID?quickAdd:null; if(fn) void fn({tabId:tab?.id,suppliedText:info.selectionText??''}).catch(e=>invocationError(tab?.id,e,info.selectionText??'')); });
  extensionApi.commands?.onCommand?.addListener((cmd,tab)=>{ if(![SAVE_COMMAND_ID,TRANSLATE_COMMAND_ID].includes(cmd))return; void(async()=>{const t=tab?.id?tab:await activeTab(); try{await(cmd===TRANSLATE_COMMAND_ID?translateOnly:quickAdd)({tabId:t?.id});}catch(e){await invocationError(t?.id,e);}})(); });
  extensionApi.alarms?.onAlarm?.addListener(alarm => {
    if (!alarm?.name?.startsWith(JOB_ALARM_PREFIX)) return;
    const id = alarm.name.slice(JOB_ALARM_PREFIX.length);
    void expireJob({ id }, 'LingoFlash chưa hoàn tất. Mở extension và kiểm tra đăng nhập/AI rồi thử lại.')
      .catch(() => createAlarm(id));
  });
  extensionApi.tabs?.onRemoved?.addListener(tabId => {
    void (async () => {
      for (const job of await readJobs()) {
        if (job.sourceTabId !== tabId && job.workerTabId !== tabId) continue;
        if (tabRemovalLocks.has(job.id)) continue;
        await expireJob(job, job.sourceTabId === tabId
          ? 'Tab nguồn đã đóng trước khi LingoFlash hoàn tất.'
          : 'Tiến trình LingoFlash ở nền đã bị đóng trước khi hoàn tất.', tabId);
      }
    })().catch(() => console.warn('Tab cleanup could not read storage; pending jobs were retained.'));
  });

  const handle = async (m,sender) => {
    const type=m&&typeof m==='object'?m.type:'';
    if(type==='GET_SELECTION'){const t=await activeTab(),c=await capture(t?.id);return{ok:true,text:c.text};}
    if(type==='TRANSLATE_SELECTION'){const t=await activeTab();return{ok:true,...await translateOnly({tabId:t?.id,suppliedText:m.text??''})};}
    if(type==='ADD_SELECTION'){const t=await activeTab();return{ok:true,...await quickAdd({tabId:t?.id,suppliedText:m.text??'',requestedDeck:m.requestedDeck})};}
    if(type==='OPEN_APP')return{ok:true,...await openApp()};
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
      if(typeof sender?.tab?.id!=='number') throw new Error('Không tìm thấy tab nguồn cho floating icon.');
      const pattern=selectionIconSitePatternFromUrl(sender.tab.url || sender.url || '');
      const settings=await readSettings();
      if(!pattern || isProtectedSelectionIconUrl(sender.tab.url || sender.url || '')
        || !normalizeSelectionIconSites(settings.selectionIconSites).includes(pattern)
        || !(await hasSelectionIconPermission(pattern))) {
        throw new Error('Floating icon chưa được bật cho website này.');
      }
      return {ok:true,...await quickAdd({tabId:sender.tab.id,suppliedText:m.text ?? ''})};
    }
    if(type==='GET_DECK_METADATA_GENERATION'){
      if(!appOriginIsValid(sender))throw new Error('Nguồn metadata deck không hợp lệ.');
      return withDeckMetadataLock(async()=>({ok:true,generation:await readDeckGeneration()}));
    }
    if(type==='SYNC_DECK_METADATA')return{ok:true,...await syncDeckMetadata(m.payload,sender)};
    if(type==='CLEAR_DECK_METADATA')return{ok:true,...await clearDeckMetadata(m.payload,sender)};
    if(type==='GET_DECKS'){
      const metadata=await readDeckMetadata();
      if(!metadata)throw new Error('Deck chưa được đồng bộ; hãy mở LingoFlash một lần.');
      return{ok:true,decks:metadata.decks};
    }
    if(type==='UPDATE_USER_SETTINGS')return{ok:true,settings:await writeUserSettings(m.changes)};
    if(type===VERIFY_IMPORT_MESSAGE)return{ok:true,...await verifyImportIntent(m.payload,sender)};
    if(type==='APP_IMPORT_RESULT'&&m.bridgeType===APP_RESULT_MESSAGE)return{ok:true,...await appResult(m.payload,sender)};
    throw new Error('Yêu cầu extension không được hỗ trợ.');
  };
  extensionApi.runtime?.onMessage?.addListener((m,s,r)=>{const p=handle(m,s).catch(e=>({ok:false,error:e instanceof Error?e.message:String(e)}));if(usesPromiseApi)return p;p.then(r);return true;});
})();
