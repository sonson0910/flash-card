'use strict';

(() => {
  const {
    APP_ORIGIN, DEFAULT_APP_URL, IMPORT_PROTOCOL_VERSION, extensionApi, transientStorage, usesPromiseApi,
    apiCall, buildImportUrl, createIntentId, selectionValidation, normalizeSilentImportIntent,
  } = globalThis.LingoFlashExtension;
  const { captureSelectionFromPage, renderInlineBubble } = globalThis.LingoFlashV132Ui;
  const VERSION = '1.3.3';
  const CONTEXT_TRANSLATE_ID = 'lingoflash-translate-only';
  const CONTEXT_SAVE_ID = 'lingoflash-translate-save';
  const SAVE_COMMAND_ID = 'translate-selection';
  const TRANSLATE_COMMAND_ID = 'translate-only-selection';
  const JOB_KEY_PREFIX = 'lingoflash_quick_add_job_';
  const JOB_ALARM_PREFIX = 'lingoflash_quick_add_timeout_';
  const JOB_TIMEOUT_MINUTES = 0.75;
  const JOB_TIMEOUT_MS = JOB_TIMEOUT_MINUTES * 60 * 1000;
  const MAX_ACTIVE_JOBS = 3;
  const GOOGLE_TRANSLATE_TIMEOUT_MS = 9_000;
  const APP_RESULT_MESSAGE = 'LINGOFLASH_EXTENSION_RESULT';
  const QUICK_ADD_STATUS_MESSAGE = 'QUICK_ADD_STATUS';
  const VERIFY_IMPORT_MESSAGE = 'VERIFY_IMPORT_INTENT';
  const verifyLocks = new Map();
  const resultLocks = new Map();
  const cleanupLocks = new Map();
  const quickAddSourceLocks = new Set();
  let quickAddCapacityTail = Promise.resolve();
  const bounded = (v,n) => typeof v === 'string' ? v.trim().slice(0,n) : '';
  const key = id => `${JOB_KEY_PREFIX}${id}`;
  const alarmName = id => `${JOB_ALARM_PREFIX}${id}`;
  const saveJob = job => apiCall(transientStorage,'set',{[key(job.id)]:job});
  const readJob = async id => (await apiCall(transientStorage,'get',key(id)))?.[key(id)] ?? null;
  const removeJob = async id => { try { await apiCall(transientStorage,'remove',key(id)); } catch {} };
  const readJobs = async () => { try { return Object.entries(await apiCall(transientStorage,'get',null) ?? {}).filter(([k,v])=>k.startsWith(JOB_KEY_PREFIX)&&v&&typeof v==='object').map(([,v])=>v); } catch { return []; } };
  const clearAlarm = async id => { try { await apiCall(extensionApi.alarms,'clear',alarmName(id)); } catch {} };
  const closeTab = async id => { if (typeof id==='number') try { await apiCall(extensionApi.tabs,'remove',id); } catch {} };
  const cleanup = job => {
    if (!job || typeof job.id !== 'string') return Promise.resolve();
    const existing = cleanupLocks.get(job.id);
    if (existing) return existing;
    const pending = Promise.allSettled([removeJob(job.id), clearAlarm(job.id), closeTab(job.workerTabId)]);
    const tracked = pending.finally(() => cleanupLocks.delete(job.id));
    cleanupLocks.set(job.id, tracked);
    return tracked;
  };
  const createAlarm = id => { try { extensionApi.alarms?.create(alarmName(id),{delayInMinutes:JOB_TIMEOUT_MINUTES}); } catch {} };
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
    const message = error instanceof Error ? error.message : 'Không thể khởi động LingoFlash.';
    await cleanup(job);
    const displayed = await show(job.sourceTabId,{status:'error',modeLabel:'TẠO + LƯU',text:job.text,anchor:job.anchor,message});
    notifyPopupStatus({id:job.id,status:'error',text:job.text,message,inlineShown:displayed.ok});
  };
  const sweepExpiredJobs = async () => {
    const now = Date.now();
    for (const job of await readJobs()) {
      if (!isExpiredJob(job, now)) continue;
      const message = 'Tác vụ LingoFlash đã hết hạn. Hãy thử lại.';
      const displayed = await show(job.sourceTabId,{status:'error',modeLabel:'TẠO + LƯU',text:job.text,anchor:job.anchor,message});
      notifyPopupStatus({id:job.id,status:'error',text:job.text,message,inlineShown:displayed.ok});
      await cleanup(job);
    }
  };

  const show = async (tabId,payload) => {
    if (typeof tabId!=='number') return {ok:false,error:'Không tìm thấy tab để hiển thị kết quả.'};
    try {
      const result = await apiCall(extensionApi.scripting,'executeScript',{target:{tabId},func:renderInlineBubble,args:[{version:VERSION,...payload}]});
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
  const activeTab = async () => { const tabs=await apiCall(extensionApi.tabs,'query',{active:true,currentWindow:true}); return Array.isArray(tabs)?tabs[0]??null:null; };
  const capture = async (tabId,supplied='') => {
    const direct=selectionValidation(supplied); if (direct.ok) return {text:direct.text,anchor:null};
    if (typeof tabId!=='number') return {text:'',anchor:null};
    const r=await apiCall(extensionApi.scripting,'executeScript',{target:{tabId},func:captureSelectionFromPage});
    return {text:Array.isArray(r)?r[0]?.result?.text??'':'',anchor:Array.isArray(r)?r[0]?.result?.anchor??null:null};
  };
  const selection = async ({tabId,suppliedText=''}={}) => {
    const tab=typeof tabId==='number'?{id:tabId}:await activeTab();
    if (typeof tab?.id!=='number') throw new Error('Không tìm thấy tab đang hoạt động.');
    const c=await capture(tab.id,suppliedText), v=selectionValidation(c.text); if (!v.ok) throw new Error(v.error);
    return {sourceTabId:tab.id,text:v.text,anchor:c.anchor};
  };

  const googleTranslate = async text => {
    const u=new URL('https://translate.googleapis.com/translate_a/single');
    u.search=new URLSearchParams({client:'gtx',sl:'en',tl:'vi',dt:'t',q:text}).toString();
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
        return t;
      })();
      return await Promise.race([request, timeout]);
    } finally {
      if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
    }
  };
  const translateOnly = async input => {
    const s=await selection(input); await show(s.sourceTabId,{status:'loading-translate',modeLabel:'DỊCH NHANH • FREE',text:s.text,anchor:s.anchor});
    try {
      const t=await googleTranslate(s.text);
      const inline=await show(s.sourceTabId,{status:'translated',modeLabel:'DỊCH NHANH • GOOGLE',text:s.text,anchor:s.anchor,translation:bounded(t,1024)});
      return {text:s.text,translation:t,inlineShown:inline.ok};
    }
    catch(e){ await show(s.sourceTabId,{status:'error',modeLabel:'DỊCH NHANH • FREE',text:s.text,anchor:s.anchor,message:e instanceof Error?e.message:'Không thể dịch đoạn này.'}); throw e; }
  };

  const quickAdd = async input => {
    const s=await selection(input), id=createIntentId();
    const job={v:IMPORT_PROTOCOL_VERSION,id,text:s.text,mode:'silent',sourceTabId:s.sourceTabId,workerTabId:null,anchor:s.anchor,createdAt:Date.now()};
    if (quickAddSourceLocks.has(job.sourceTabId)) throw new Error('Đã có một tác vụ quick-add đang chạy trên tab này.');
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
          throw new Error('Đã có một tác vụ quick-add đang chạy trên tab này.');
        }
        if (activeJobs.length >= MAX_ACTIVE_JOBS) {
          throw new Error('Extension đang có quá nhiều tác vụ quick-add. Hãy chờ một tác vụ hoàn tất rồi thử lại.');
        }
        await show(job.sourceTabId,{status:'loading-save',modeLabel:'TẠO + LƯU • 1 AI REQUEST',text:job.text,anchor:job.anchor});
        // Critical ordering: persist job first, then create about:blank, persist tab id,
        // and only then navigate. Fast app responses can no longer beat job storage.
        await saveJob(job);
        const importUrl=buildImportUrl(DEFAULT_APP_URL,job.text,{id,mode:'silent',createdAt:job.createdAt});
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
    if (!p||typeof p!=='object'||Array.isArray(p)||typeof p.id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(p.id)||!['created','existing','auth-required','error'].includes(p.status)) return null;
    return {id:p.id,status:p.status,word:bounded(p.word,80),translation:bounded(p.translation,256),phonetic:bounded(p.phonetic,256),explanation:bounded(p.explanation,1024),exampleSentence:bounded(p.exampleSentence,1024),exampleTranslation:bounded(p.exampleTranslation,1024),message:bounded(p.message,512)};
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
      const job=await readJob(r.id); if (!job) return {ignored:true};
      if (typeof sender?.tab?.id!=='number'||sender.tab.id!==job.workerTabId) throw new Error('Tab trả kết quả không khớp với tác vụ LingoFlash.');
      if (job.resultClaimedAt) return {ignored:true};

      // Claim before any rendering or fallback work. The in-memory lock closes
      // the read/claim race, while this persisted marker survives worker restarts.
      job.resultClaimedAt = Date.now();
      await saveJob(job);

      let inlineShown = true;
      if (r.status==='created'||r.status==='existing') {
        let t=r.translation; if (!t) try { t=bounded(await googleTranslate(job.text),256); } catch {}
        const displayed = await show(job.sourceTabId,{status:r.status,modeLabel:'TẠO + LƯU • 1 AI REQUEST',text:job.text,anchor:job.anchor,translation:t,phonetic:r.phonetic,explanation:r.explanation,exampleSentence:r.exampleSentence,exampleTranslation:r.exampleTranslation});
        inlineShown = displayed.ok;
        notifyPopupStatus({id:job.id,status:r.status,text:job.text,translation:t,inlineShown});
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
    })();
    resultLocks.set(r.id, processing);
    try { return await processing; } finally { resultLocks.delete(r.id); }
  };

  const verifyImportIntent = async (payload,sender) => {
    const intent = normalizeSilentImportIntent(payload);
    if (!intent) return {verified:false};
    const existingLock = verifyLocks.get(intent.id);
    if (existingLock) {
      await existingLock;
      return {verified:false};
    }

    const verification = (async () => {
      let origin = '';
      try { origin = new URL(sender?.url || '').origin; } catch {}
      if (origin !== APP_ORIGIN || typeof sender?.tab?.id !== 'number') return {verified:false};

      const job = await readJob(intent.id);
      if (!job || job.importClaimedAt) return {verified:false};
      const now = Date.now();
      const expired = !Number.isSafeInteger(job.createdAt)
        || job.createdAt > now
        || now - job.createdAt >= JOB_TIMEOUT_MS;
      if (expired) {
        await cleanup(job);
        return {verified:false};
      }
      if (
        job.v !== intent.v
        || job.mode !== intent.mode
        || job.text !== intent.text
        || job.createdAt !== intent.createdAt
        || job.workerTabId !== sender.tab.id
      ) return {verified:false};

      job.importClaimedAt = Date.now();
      await saveJob(job);
      return {verified:true,intent};
    })();
    verifyLocks.set(intent.id, verification);
    try { return await verification; } finally { verifyLocks.delete(intent.id); }
  };

  const shortcut = async name => { try { const c=await apiCall(extensionApi.commands,'getAll'); return (Array.isArray(c)?c.find(x=>x.name===name):null)?.shortcut||''; } catch { return ''; } };
  const openApp = async () => { await apiCall(extensionApi.tabs,'create',{url:DEFAULT_APP_URL,active:true}); return {url:DEFAULT_APP_URL}; };
  const invocationError = async (tabId,e,text='') => show(tabId,{status:'error',text,message:e instanceof Error?e.message:String(e)});
  const installMenus = () => { if (!extensionApi.contextMenus) return; void (async()=>{ try{await apiCall(extensionApi.contextMenus,'removeAll');}catch{} try{await apiCall(extensionApi.contextMenus,'create',{id:CONTEXT_TRANSLATE_ID,title:'Dịch nhanh “%s” — không lưu',contexts:['selection']}); await apiCall(extensionApi.contextMenus,'create',{id:CONTEXT_SAVE_ID,title:'Dịch + thêm “%s” vào LingoFlash',contexts:['selection']});}catch{} })(); };
  extensionApi.runtime?.onInstalled?.addListener(() => { installMenus(); void sweepExpiredJobs(); });
  extensionApi.runtime?.onStartup?.addListener(() => { installMenus(); void sweepExpiredJobs(); });
  installMenus();
  void sweepExpiredJobs();
  extensionApi.contextMenus?.onClicked?.addListener((info,tab)=>{ const fn=info.menuItemId===CONTEXT_TRANSLATE_ID?translateOnly:info.menuItemId===CONTEXT_SAVE_ID?quickAdd:null; if(fn) void fn({tabId:tab?.id,suppliedText:info.selectionText??''}).catch(e=>invocationError(tab?.id,e,info.selectionText??'')); });
  extensionApi.commands?.onCommand?.addListener((cmd,tab)=>{ if(![SAVE_COMMAND_ID,TRANSLATE_COMMAND_ID].includes(cmd))return; void(async()=>{const t=tab?.id?tab:await activeTab(); try{await(cmd===TRANSLATE_COMMAND_ID?translateOnly:quickAdd)({tabId:t?.id});}catch(e){await invocationError(t?.id,e);}})(); });
  extensionApi.alarms?.onAlarm?.addListener(a=>{ if(!a?.name?.startsWith(JOB_ALARM_PREFIX))return; const id=a.name.slice(JOB_ALARM_PREFIX.length); void(async()=>{const j=await readJob(id); if(!j)return; const message='LingoFlash chưa hoàn tất. Mở extension và kiểm tra đăng nhập/AI rồi thử lại.'; await show(j.sourceTabId,{status:'error',modeLabel:'TẠO + LƯU',text:j.text,anchor:j.anchor,message}); notifyPopupStatus({id:j.id,status:'error',text:j.text,message,inlineShown:false}); await cleanup(j);})(); });
  extensionApi.tabs?.onRemoved?.addListener(tabId=>{ void(async()=>{for(const j of await readJobs()){if(j.sourceTabId===tabId){const message='Tab nguồn đã đóng trước khi LingoFlash hoàn tất.'; notifyPopupStatus({id:j.id,status:'error',text:j.text,message,inlineShown:false}); await cleanup(j);}else if(j.workerTabId===tabId){const message='Tiến trình LingoFlash ở nền đã bị đóng trước khi hoàn tất.'; await show(j.sourceTabId,{status:'error',modeLabel:'TẠO + LƯU',text:j.text,anchor:j.anchor,message}); notifyPopupStatus({id:j.id,status:'error',text:j.text,message,inlineShown:false}); await cleanup(j);}}})(); });

  const handle = async (m,sender) => {
    const type=m&&typeof m==='object'?m.type:'';
    if(type==='GET_SELECTION'){const t=await activeTab(),c=await capture(t?.id);return{ok:true,text:c.text};}
    if(type==='TRANSLATE_SELECTION'){const t=await activeTab();return{ok:true,...await translateOnly({tabId:t?.id,suppliedText:m.text??''})};}
    if(type==='ADD_SELECTION'){const t=await activeTab();return{ok:true,...await quickAdd({tabId:t?.id,suppliedText:m.text??''})};}
    if(type==='OPEN_APP')return{ok:true,...await openApp()};
    if(type==='GET_SHORTCUT')return{ok:true,shortcut:await shortcut(SAVE_COMMAND_ID)};
    if(type==='GET_SHORTCUTS')return{ok:true,saveShortcut:await shortcut(SAVE_COMMAND_ID),translateShortcut:await shortcut(TRANSLATE_COMMAND_ID)};
    if(type===VERIFY_IMPORT_MESSAGE)return{ok:true,...await verifyImportIntent(m.payload,sender)};
    if(type==='APP_IMPORT_RESULT'&&m.bridgeType===APP_RESULT_MESSAGE)return{ok:true,...await appResult(m.payload,sender)};
    throw new Error('Yêu cầu extension không được hỗ trợ.');
  };
  extensionApi.runtime?.onMessage?.addListener((m,s,r)=>{const p=handle(m,s).catch(e=>({ok:false,error:e instanceof Error?e.message:String(e)}));if(usesPromiseApi)return p;p.then(r);return true;});
})();
