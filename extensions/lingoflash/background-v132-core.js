'use strict';

(() => {
  const {
    APP_ORIGIN, DEFAULT_APP_URL, extensionApi, transientStorage, usesPromiseApi,
    apiCall, buildImportUrl, createIntentId, selectionValidation, normalizeSilentImportIntent,
  } = globalThis.LingoFlashExtension;
  const { captureSelectionFromPage, renderInlineBubble } = globalThis.LingoFlashV132Ui;
  const VERSION = '1.3.2';
  const CONTEXT_TRANSLATE_ID = 'lingoflash-translate-only';
  const CONTEXT_SAVE_ID = 'lingoflash-translate-save';
  const SAVE_COMMAND_ID = 'translate-selection';
  const TRANSLATE_COMMAND_ID = 'translate-only-selection';
  const JOB_KEY_PREFIX = 'lingoflash_quick_add_job_';
  const JOB_ALARM_PREFIX = 'lingoflash_quick_add_timeout_';
  const JOB_TIMEOUT_MINUTES = 0.75;
  const APP_RESULT_MESSAGE = 'LINGOFLASH_EXTENSION_RESULT';
  const VERIFY_IMPORT_MESSAGE = 'VERIFY_IMPORT_INTENT';
  const verifyLocks = new Map();
  const bounded = (v,n) => typeof v === 'string' ? v.trim().slice(0,n) : '';
  const key = id => `${JOB_KEY_PREFIX}${id}`;
  const alarmName = id => `${JOB_ALARM_PREFIX}${id}`;
  const saveJob = job => apiCall(transientStorage,'set',{[key(job.id)]:job});
  const readJob = async id => (await apiCall(transientStorage,'get',key(id)))?.[key(id)] ?? null;
  const removeJob = async id => { try { await apiCall(transientStorage,'remove',key(id)); } catch {} };
  const readJobs = async () => { try { return Object.entries(await apiCall(transientStorage,'get',null) ?? {}).filter(([k,v])=>k.startsWith(JOB_KEY_PREFIX)&&v&&typeof v==='object').map(([,v])=>v); } catch { return []; } };
  const clearAlarm = async id => { try { await apiCall(extensionApi.alarms,'clear',alarmName(id)); } catch {} };
  const closeTab = async id => { if (typeof id==='number') try { await apiCall(extensionApi.tabs,'remove',id); } catch {} };
  const cleanup = async job => { await removeJob(job.id); await clearAlarm(job.id); await closeTab(job.workerTabId); };
  const createAlarm = id => { try { extensionApi.alarms?.create(alarmName(id),{delayInMinutes:JOB_TIMEOUT_MINUTES}); } catch {} };

  const show = async (tabId,payload) => {
    if (typeof tabId!=='number') return;
    try { await apiCall(extensionApi.scripting,'executeScript',{target:{tabId},func:renderInlineBubble,args:[{version:VERSION,...payload}]}); } catch {}
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
    const r=await fetch(u.toString(),{cache:'no-store',credentials:'omit'}); if (!r.ok) throw new Error(`Google Translate HTTP ${r.status}`);
    const p=await r.json(), chunks=Array.isArray(p?.[0])?p[0]:[];
    const t=chunks.map(x=>Array.isArray(x)&&typeof x[0]==='string'?x[0]:'').join('').trim(); if (!t) throw new Error('Google Translate trả về kết quả trống.'); return t;
  };
  const translateOnly = async input => {
    const s=await selection(input); await show(s.sourceTabId,{status:'loading-translate',modeLabel:'DỊCH NHANH • FREE',text:s.text,anchor:s.anchor});
    try { const t=await googleTranslate(s.text); await show(s.sourceTabId,{status:'translated',modeLabel:'DỊCH NHANH • GOOGLE',text:s.text,anchor:s.anchor,translation:bounded(t,1024)}); return {text:s.text,translation:t}; }
    catch(e){ await show(s.sourceTabId,{status:'error',modeLabel:'DỊCH NHANH • FREE',text:s.text,anchor:s.anchor,message:e instanceof Error?e.message:'Không thể dịch đoạn này.'}); throw e; }
  };

  const quickAdd = async input => {
    const s=await selection(input), id=createIntentId();
    const job={v:1,id,text:s.text,mode:'silent',sourceTabId:s.sourceTabId,workerTabId:null,anchor:s.anchor,createdAt:Date.now()};
    await show(job.sourceTabId,{status:'loading-save',modeLabel:'TẠO + LƯU • 1 AI REQUEST',text:job.text,anchor:job.anchor});
    // Critical ordering: persist job first, then create about:blank, persist tab id,
    // and only then navigate. Fast app responses can no longer beat job storage.
    await saveJob(job);
    try {
      const importUrl=buildImportUrl(DEFAULT_APP_URL,job.text,{id,mode:'silent',createdAt:job.createdAt});
      const tab=await apiCall(extensionApi.tabs,'create',{url:'about:blank',active:false});
      if (typeof tab?.id!=='number') throw new Error('Không thể tạo tiến trình LingoFlash ở nền.');
      job.workerTabId=tab.id; await saveJob(job); createAlarm(id);
      await apiCall(extensionApi.tabs,'update',tab.id,{url:importUrl,active:false});
      return {id,text:job.text};
    } catch(e){ await cleanup(job); await show(job.sourceTabId,{status:'error',modeLabel:'TẠO + LƯU',text:job.text,anchor:job.anchor,message:e instanceof Error?e.message:'Không thể khởi động LingoFlash.'}); throw e; }
  };

  const normalizeResult = p => {
    if (!p||typeof p!=='object'||Array.isArray(p)||typeof p.id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(p.id)||!['created','existing','auth-required','error'].includes(p.status)) return null;
    return {id:p.id,status:p.status,word:bounded(p.word,80),translation:bounded(p.translation,256),phonetic:bounded(p.phonetic,256),explanation:bounded(p.explanation,1024),message:bounded(p.message,512)};
  };
  const appResult = async (payload,sender) => {
    const r=normalizeResult(payload); if (!r) throw new Error('Kết quả LingoFlash không hợp lệ.');
    let origin=''; try { origin=new URL(sender?.url||'').origin; } catch {} if (origin!==APP_ORIGIN) throw new Error('Nguồn kết quả LingoFlash không hợp lệ.');
    const job=await readJob(r.id); if (!job) return {ignored:true};
    if (typeof sender?.tab?.id!=='number'||sender.tab.id!==job.workerTabId) throw new Error('Tab trả kết quả không khớp với tác vụ LingoFlash.');
    if (r.status==='created'||r.status==='existing') {
      let t=r.translation; if (!t) try { t=bounded(await googleTranslate(job.text),256); } catch {}
      await show(job.sourceTabId,{status:r.status,modeLabel:'TẠO + LƯU • 1 AI REQUEST',text:job.text,anchor:job.anchor,translation:t,phonetic:r.phonetic,explanation:r.explanation});
    } else if (r.status==='auth-required') await show(job.sourceTabId,{status:'auth-required',modeLabel:'TẠO + LƯU',text:job.text,anchor:job.anchor});
    else await show(job.sourceTabId,{status:'error',modeLabel:'TẠO + LƯU',text:job.text,anchor:job.anchor,message:r.message||'Không thể tạo hoặc lưu flashcard này.'});
    await cleanup(job); return {ignored:false};
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
  extensionApi.runtime?.onInstalled?.addListener(installMenus); extensionApi.runtime?.onStartup?.addListener(installMenus); installMenus();
  extensionApi.contextMenus?.onClicked?.addListener((info,tab)=>{ const fn=info.menuItemId===CONTEXT_TRANSLATE_ID?translateOnly:info.menuItemId===CONTEXT_SAVE_ID?quickAdd:null; if(fn) void fn({tabId:tab?.id,suppliedText:info.selectionText??''}).catch(e=>invocationError(tab?.id,e,info.selectionText??'')); });
  extensionApi.commands?.onCommand?.addListener((cmd,tab)=>{ if(![SAVE_COMMAND_ID,TRANSLATE_COMMAND_ID].includes(cmd))return; void(async()=>{const t=tab?.id?tab:await activeTab(); try{await(cmd===TRANSLATE_COMMAND_ID?translateOnly:quickAdd)({tabId:t?.id});}catch(e){await invocationError(t?.id,e);}})(); });
  extensionApi.alarms?.onAlarm?.addListener(a=>{ if(!a?.name?.startsWith(JOB_ALARM_PREFIX))return; const id=a.name.slice(JOB_ALARM_PREFIX.length); void(async()=>{const j=await readJob(id); if(!j)return; await show(j.sourceTabId,{status:'error',modeLabel:'TẠO + LƯU',text:j.text,anchor:j.anchor,message:'LingoFlash chưa hoàn tất. Mở extension và kiểm tra đăng nhập/AI rồi thử lại.'}); await cleanup(j);})(); });
  extensionApi.tabs?.onRemoved?.addListener(tabId=>{ void(async()=>{for(const j of await readJobs()){if(j.sourceTabId===tabId)await cleanup(j);else if(j.workerTabId===tabId){await show(j.sourceTabId,{status:'error',modeLabel:'TẠO + LƯU',text:j.text,anchor:j.anchor,message:'Tiến trình LingoFlash ở nền đã bị đóng trước khi hoàn tất.'});await removeJob(j.id);await clearAlarm(j.id);}}})(); });

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
