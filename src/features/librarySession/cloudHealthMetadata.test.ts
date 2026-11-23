import { expect, it, vi } from 'vitest';
import { createCloudLibraryPageController, EMPTY_LIBRARY_STATS, isCloudPageAwaitingServer } from './cloudLibraryPageController';
import { getShellSyncStatus } from '../../components/shell/shellSyncStatus';
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
      awaitingCloudConfirmation: isCloudPageAwaitingServer(snapshot),
    });
  };

  await deliver({ items: [card], hasNext: false, cursor: null, changeTypes: ['added'], fromCache: true, hasPendingWrites: false });
  expect(statusOf().kind).toBe('awaiting-cloud');

  await deliver({ items: [card], hasNext: false, cursor: null, changeTypes: [], fromCache: false, hasPendingWrites: false });
  expect(statusOf().kind).toBe('synced');
});

it('does not report Synced while an empty device cache is waiting for the server and no saved page exists', async () => {
  let deliver!: (page: any) => Promise<void>;
  const controller = createCloudLibraryPageController({ adapter: { available: true, subscribePage: (_request, onPage) => { deliver = onPage as any; return () => {}; }, countCards: async () => 0, loadStats: async () => ({ ...EMPTY_LIBRARY_STATS, dueAsOfDate: '2026-10-15' }), loadDueStats: async () => ({ due: 0, dueAsOfDate: '2026-10-15' }), loadProgressEvidence: async () => ({}), subscribeFacets: () => () => {} }, cache: { readPage: async () => null, writePage: vi.fn(), readCount: () => null, readStats: () => null, writeStats: vi.fn(), readFacets: () => null, writeFacets: vi.fn(), isBackoffActive: () => false, markBackoff: vi.fn() } });
  controller.activate({ ownerId: 'audit-owner', query: { category: null, customDeck: { kind: 'all' }, difficulty: null, partOfSpeech: null, bookmarkedOnly: false, createdDate: null, wordPrefix: '' }, queryKey: 'all', page: 1 });
  const statusOf = () => getShellSyncStatus({ isOnline: true, error: null, cloudUnavailable: controller.getSnapshot().cloudUnavailable, awaitingCloudConfirmation: isCloudPageAwaitingServer(controller.getSnapshot()) });

  // Before the first snapshot the page is simply loading.
  expect(isCloudPageAwaitingServer(controller.getSnapshot())).toBe(false);

  await deliver({ items: [], hasNext: false, cursor: null, changeTypes: [], fromCache: true, hasPendingWrites: false });
  expect(controller.getSnapshot()).toMatchObject({ isLoading: true, cloudUnavailable: false });
  expect(statusOf().kind).toBe('awaiting-cloud');

  await deliver({ items: [], hasNext: false, cursor: null, changeTypes: [], fromCache: false, hasPendingWrites: false });
  expect(controller.getSnapshot().isLoading).toBe(false);
  expect(statusOf().kind).toBe('synced');
});

it('waits for the cloud only while the page is not confirmed by the server and is not simply loading', () => {
  const base = { serverConfirmed: false, isLoading: false, cacheOnly: false };
  expect(isCloudPageAwaitingServer(base)).toBe(true);
  expect(isCloudPageAwaitingServer({ ...base, serverConfirmed: true })).toBe(false);
  expect(isCloudPageAwaitingServer({ ...base, isLoading: true })).toBe(false);
  expect(isCloudPageAwaitingServer({ ...base, isLoading: true, cacheOnly: true })).toBe(true);
});
