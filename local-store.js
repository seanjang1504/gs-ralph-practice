import {createStateStore} from './shared/state-store.js';

export function createBrowserStore({name='gs25-st-html-v1',clock=()=>new Date()}={}){
  let opening;
  function open(){
    return opening??=new Promise((resolve,reject)=>{
      const request=indexedDB.open(name,1);
      request.onupgradeneeded=()=>{request.result.createObjectStore('state');request.result.createObjectStore('photos',{keyPath:'id'});};
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>{opening=null;reject(Error('기기 저장소를 열 수 없습니다. 일반 브라우저에서 다시 접속해 주세요.'));};
      request.onblocked=()=>{opening=null;reject(Error('다른 탭을 닫고 다시 시도해 주세요.'));};
    });
  }
  const read=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const completed=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('기기에 저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인해 주세요.'));tx.onerror=()=>{};});
  async function run(fn,attachment){
    const db=await open(),tx=db.transaction(['state','photos'],'readwrite'),done=completed(tx);
    try{
      const meta=tx.objectStore('state'),photos=tx.objectStore('photos');
      const [saved,ids]=await Promise.all([read(meta.get('main')),read(photos.getAllKeys())]);
      const state=saved||{deliveries:{},diagnoses:{},claims:{}};
      state.photos=Object.fromEntries(ids.map(id=>[id,{preview:true,original:true}]));
      const engine=createStateStore(state,{clock});engine.seedDeliveries();
      const result=fn(engine);
      if(result instanceof Promise)throw Error('비동기 분석은 저장 트랜잭션 밖에서 실행해야 합니다.');
      if(attachment&&attachment.id===result.id&&!ids.includes(attachment.id))photos.add(attachment);
      delete state.photos;meta.put(state,'main');await done;return result;
    }catch(error){try{tx.abort();}catch{}await done.catch(()=>{});throw error;}
  }
  return {run,
    saveDiagnosis:(d,preview,original,mime)=>run(s=>s.saveDiagnosis(d,preview,original,mime),{id:d.id,preview,original,mime}),
    async photo(id){const db=await open(),tx=db.transaction('photos');return read(tx.objectStore('photos').get(id));},
    async close(){if(opening)(await opening).close();opening=null;}
  };
}
