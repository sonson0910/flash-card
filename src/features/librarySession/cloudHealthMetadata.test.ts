import { expect, it, vi } from 'vitest';
import { createCloudLibraryPageController, EMPTY_LIBRARY_STATS } from './cloudLibraryPageController';
import { getShellSyncStatus } from '../../components/shell/shellSyncStatus';
it('does not report Synced after only a Firestore cache snapshot, before any server response', async () => {
  let deliver!: (page:any)=>Promise<void>;
  const controller=createCloudLibraryPageController({adapter:{available:true,subscribePage:(_request,onPage)=>{deliver=onPage as any;return()=>{};},countCards:async()=>0,loadStats:async()=>EMPTY_LIBRARY_STATS,subscribeFacets:()=>()=>{}},cache:{readPage:async()=>null,writePage:vi.fn(),readCount:()=>({total:1,cachedAt:Date.now()}),readStats:()=>null,writeStats:vi.fn(),readFacets:()=>null,writeFacets:vi.fn(),isBackoffActive:()=>false,markBackoff:vi.fn()}});
  controller.activate({ownerId:'audit-owner',query:{category:null,customDeck:{kind:'all'},difficulty:null,partOfSpeech:null,bookmarkedOnly:false,createdDate:null,wordPrefix:''},queryKey:'all',page:1});
  await deliver({items:[],hasNext:false,cursor:null,changeTypes:[],fromCache:true,hasPendingWrites:false});
  const snapshot=controller.getSnapshot();
  const status=getShellSyncStatus({isOnline:true,isSyncing:false,pendingCount:0,error:null,cloudUnavailable:snapshot.cloudUnavailable,isCheckingCloud:!snapshot.serverConfirmed});
  expect(status.kind).not.toBe('synced');
});
