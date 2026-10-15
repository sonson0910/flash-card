import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {writeGamificationSnapshot,readGamificationSnapshot,type GamificationStorage} from './gamificationStorage';
import {useGamificationState} from './useGamification';
class MemoryStorage implements GamificationStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    defaultView: globalThis,
  };
  const container = {
    nodeType: 1,
    ownerDocument: documentLike,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
  };
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return container as unknown as Element;
};


it('retries pending XP after connectivity recovers without requiring another reward or reload',async()=>{
 vi.useFakeTimers();
 const bus=new EventTarget();vi.stubGlobal('addEventListener',bus.addEventListener.bind(bus));vi.stubGlobal('removeEventListener',bus.removeEventListener.bind(bus));
 const storage=new MemoryStorage();
 const initial={streak:1,xp:5,lastActive:'Sun Aug 09 2026',history:{'Aug 9, 2026':5},pendingOperations:[{id:'xp2:audit-client:1',clientId:'audit-client',sequence:1,delta:5,day:'Aug 9, 2026'}]};
 writeGamificationSnapshot(storage,'audit-owner',initial);
 let online=false;
 const save=vi.fn(async()=>{if(!online)throw new Error('unavailable');return{snapshot:{...initial,pendingOperations:[]},appliedOperationIds:['xp2:audit-client:1']};});
 const store={load:async(_owner:string,fallback:any)=>({source:'local-fallback' as const,snapshot:fallback}),save};
 function Harness(){useGamificationState({ownerId:'audit-owner',cloudBackoffActive:false,store,storage,now:()=>new Date('2026-08-09T08:00:00+07:00'),saveDelayMs:10});return null;}
 const root=createRoot(installMinimalReactDom());
 await act(async()=>{root.render(<Harness/>);});
 await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
 expect(save).toHaveBeenCalledTimes(3);
 online=true;
 await act(async()=>{bus.dispatchEvent(new Event('online'));bus.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(120_000);});
 const pending=readGamificationSnapshot(storage,'audit-owner').pendingOperations ?? [];
 expect(save.mock.calls.length).toBeGreaterThan(3);
 await act(async()=>root.unmount());
 expect(pending).toHaveLength(0);
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
