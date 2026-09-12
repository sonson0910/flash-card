import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
const observed=vi.hoisted(()=>({pending:0,refresh:vi.fn(),flush:vi.fn(),publishPending:null as null|((n:number)=>void)}));
vi.mock('../../lib/firebase',()=>({db:{},isFirebaseConfigured:true}));
vi.mock('./libraryReplica',()=>({createLibraryReplica:(options:any)=>{
 observed.publishPending=options.onPendingCount;
 return {refreshPending:async()=>{observed.refresh();options.onPendingCount(observed.pending);return observed.pending;},flush:observed.flush,refreshMirror:async()=>0};
},publishVerifiedEpochIfOwnerCurrent:vi.fn()}));
import {useLibraryDeviceSync} from './useLibraryDeviceSync';
function minimalDom(){
 const doc:any={nodeType:9,activeElement:null,addEventListener:vi.fn(),removeEventListener:vi.fn(),defaultView:globalThis};
 const el:any={nodeType:1,ownerDocument:doc,addEventListener:vi.fn(),removeEventListener:vi.fn(),nodeName:'DIV',tagName:'DIV',namespaceURI:'http://www.w3.org/1999/xhtml'};
 doc.documentElement=el;
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('window',globalThis);vi.stubGlobal('document',doc);
 vi.stubGlobal('HTMLIFrameElement',class{});vi.stubGlobal('HTMLElement',class{});vi.stubGlobal('Node',class{});
 const bus=new EventTarget();vi.stubGlobal('addEventListener',bus.addEventListener.bind(bus));vi.stubGlobal('removeEventListener',bus.removeEventListener.bind(bus));vi.stubGlobal('dispatchEvent',bus.dispatchEvent.bind(bus));
 return el;
}
it('discovers pending operations queued by account migration or another tab after the initial read',async()=>{
 const element=minimalDom();vi.useFakeTimers();
 const root=createRoot(element);
 const events={advanceCard:vi.fn(),removeCard:vi.fn(),findPracticeCard:vi.fn(),advancePracticeCard:vi.fn(),removePracticeCard:vi.fn(),resetPage:vi.fn(),refreshCloud:vi.fn(),setCloudAvailable:vi.fn(),setCloudTotal:vi.fn(),reportError:vi.fn(),notify:vi.fn(),verifyEpoch:vi.fn(),publishDeviceCards:vi.fn(),publishDevicePage:vi.fn(),previousPage:vi.fn()};
 function Harness(){useLibraryDeviceSync({owner:{uid:'audit-owner'},epoch:{userId:'audit-owner',value:1},cards:[],knownLibraryTotal:0,cloudTotal:0,cloudStatsTotal:0,cardsPerPage:9,isBrowserOnline:true,cloudReadUnavailable:false,query:{category:null,customDeck:{kind:'all'},difficulty:null,partOfSpeech:null,bookmarkedOnly:false,createdDate:null,wordPrefix:''},queryKey:'all',currentPage:1,getPromotedCards:()=>[],events});return null;}
 await act(async()=>{root.render(<Harness/>);});
 expect(observed.refresh).toHaveBeenCalledTimes(1);expect(observed.flush).not.toHaveBeenCalled();
 observed.pending=1;
 await act(async()=>{globalThis.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(120_000);});
 const flushCalls=observed.flush.mock.calls.length;
 await act(async()=>root.unmount());
 expect(flushCalls,'An active tab should discover writes made outside its own staging callback').toBeGreaterThan(0);
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
