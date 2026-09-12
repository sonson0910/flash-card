import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
const cloud = vi.hoisted(() => ({ cards: [] as any[], stream: vi.fn(), epoch: vi.fn(async () => 1) }));
vi.mock('../../lib/firebase', () => ({db: {}, isFirebaseConfigured: true}));
vi.mock('../../lib/deviceSync', async () => {
  const actual = await vi.importActual<any>('../../lib/deviceSync');
  return {...actual, loadDevicePending: async () => []};
});
vi.mock('../../lib/cardRepository', async () => {
  const actual = await vi.importActual<any>('../../lib/cardRepository');
  return {...actual, getLibraryEpoch: cloud.epoch, streamAllCardsInBatches: cloud.stream};
});
import { createLibraryReplica } from './libraryReplica';
import { beginCardMirrorSync, closeCardMirrorForTests, findMirroredCardByWord, finishCardMirrorSync, upsertMirroredCardBatch } from '../../lib/cardMirror';
const card = (id: string, revision=1) => ({ id, word:id, normalizedWord:id, translation:'old', explanation:'', phonetic:'', emoji:'', category:'Test', audioUrl:null, imageUrl:null, createdAt:'2026-09-10T00:00:00.000Z', revision, libraryEpoch:1 });
afterEach(() => { closeCardMirrorForTests(); });
it('does not downgrade a card when a stale cloud cache page arrives after an authoritative update', async () => {
  const generation = await beginCardMirrorSync('audit-mirror-owner',1,1);
  await upsertMirroredCardBatch('audit-mirror-owner',[{...card('same',2),translation:'new'}],generation);
  await finishCardMirrorSync('audit-mirror-owner',generation,1);
  await upsertMirroredCardBatch('audit-mirror-owner',[card('same',1)]);
  expect(await findMirroredCardByWord('audit-mirror-owner','same')).toMatchObject({revision:2,translation:'new'});
});
it('a user-requested forced sync does not leave remotely deleted cards in the offline mirror', async () => {
  cloud.cards=[card('keep'),card('deleted-remotely')];
  cloud.stream.mockImplementation(async (_db,_owner,onPage) => { await onPage(cloud.cards); return cloud.cards.length; });
  const events={advanceCard:vi.fn(),removeCard:vi.fn(),findPracticeCard:vi.fn(),advancePracticeCard:vi.fn(),removePracticeCard:vi.fn(),resetPage:vi.fn(),refreshCloud:vi.fn(),setCloudAvailable:vi.fn(),setCloudTotal:vi.fn(),reportError:vi.fn(),notify:vi.fn(),verifyEpoch:vi.fn()};
  const replica=createLibraryReplica({ownerId:'audit-ttl-owner',getEpoch:()=>({userId:'audit-ttl-owner',value:1}),getCards:()=>cloud.cards,getEvents:()=>events,getMirrorTotals:()=>({cloudTotal:cloud.cards.length,cloudStatsTotal:cloud.cards.length}),isOwnerCurrent:()=>true,onError:vi.fn(),onPendingCount:vi.fn(),onSyncing:vi.fn()});
  await replica.refreshMirror(false);
  expect(await findMirroredCardByWord('audit-ttl-owner','deleted-remotely')).not.toBeNull();
  cloud.cards=[card('keep')];
  const reportedCount=await replica.refreshMirror(true);
  expect({reportedCount,deletedCard:await findMirroredCardByWord('audit-ttl-owner','deleted-remotely')}).toEqual({reportedCount:1,deletedCard:null});
});
