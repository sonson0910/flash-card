import { expect, it, vi } from 'vitest';
import { createCloudLibraryPageController, EMPTY_LIBRARY_STATS } from './cloudLibraryPageController';
import { getShellSyncStatus, isAwaitingCloudConfirmation } from '../../components/shell/shellSyncStatus';
it('does not report Synced after only a Firestore cache snapshot, before any server response', async () => {
  let deliver!: (page:any)=>Promise<void>;
  const controller=createCloudLibraryPageController({adapter:{available:true,subscribePage:(_request,onPage)=>{deliver=onPage as any;return()=>{};},countCards:async()=>0,loadStats:async()=>({...EMPTY_LIBRARY_STATS,dueAsOfDate:'2026-10-15'}),loadDueStats:async()=>({due:0,dueAsOfDate:'2026-10-15'}),loadProgressEvidence:async()=>({}),subscribeFacets:()=>()=>{}},cache:{readPage:async()=>null,writePage:vi.fn(),readCount:()=>({total:1,cachedAt:Date.now()}),readStats:()=>null,writeStats:vi.fn(),readFacets:()=>null,writeFacets:vi.fn(),isBackoffActive:()=>false,markBackoff:vi.fn()}});
  controller.activate({ownerId:'audit-owner',query:{category:null,customDeck:{kind:'all'},difficulty:null,partOfSpeech:null,bookmarkedOnly:false,createdDate:null,wordPrefix:''},queryKey:'all',page:1});
  await deliver({items:[],hasNext:false,cursor:null,changeTypes:[],fromCache:true,hasPendingWrites:false});
  const snapshot=controller.getSnapshot();
  const status=getShellSyncStatus({isOnline:true,error:null,cloudUnavailable:snapshot.cloudUnavailable,isCheckingCloud:!snapshot.serverConfirmed});
  expect(status.kind).not.toBe('synced');
});

it('does not report Synced for a non-empty page that only came from the Firestore cache', async () => {
  let deliver!: (page: any) => Promise<void>;
  const controller = createCloudLibraryPageController({ adapter: { available: true, subscribePage: (_request, onPage) => { deliver = onPage as any; return () => {}; }, countCards: async () => 1, loadStats: async () => ({ ...EMPTY_LIBRARY_STATS, dueAsOfDate: '2026-10-15' }), loadDueStats: async () => ({ due: 0, dueAsOfDate: '2026-10-15' }), loadProgressEvidence: async () => ({}), subscribeFacets: () => () => {} }, cache: { readPage: async () => null, writePage: vi.fn(), readCount: () => ({ total: 1, cachedAt: Date.now() }), readStats: () => null, writeStats: vi.fn(), readFacets: () => null, writeFacets: vi.fn(), isBackoffActive: () => false, markBackoff: vi.fn() } });
  controller.activate({ ownerId: 'audit-owner', query: { category: null, customDeck: { kind: 'all' }, difficulty: null, partOfSpeech: null, bookmarkedOnly: false, createdDate: null, wordPrefix: '' }, queryKey: 'all', page: 1 });
  const card = { id: 'a', word: 'a', translation: 'a', explanation: '', phonetic: '', emoji: '', category: 'General', audioUrl: null, imageUrl: null };
  const statusOf = () => {
    const snapshot = controller.getSnapshot();
    return getShellSyncStatus({
      isOnline: true,
      error: null,
      cloudUnavailable: snapshot.cloudUnavailable,
      awaitingCloudConfirmation: isAwaitingCloudConfirmation({ signedIn: true, serverConfirmed: Boolean(snapshot.serverConfirmed), isLoading: snapshot.isLoading }),
    });
  };

  await deliver({ items: [card], hasNext: false, cursor: null, changeTypes: ['added'], fromCache: true, hasPendingWrites: false });
  expect(statusOf().kind).toBe('awaiting-cloud');

  await deliver({ items: [card], hasNext: false, cursor: null, changeTypes: [], fromCache: false, hasPendingWrites: false });
  expect(statusOf().kind).toBe('synced');
});
