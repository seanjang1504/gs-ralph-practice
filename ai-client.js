export function createBrowserAI(){
  let worker,state='idle',message='AI 모델을 준비하고 있습니다. 최초 다운로드 약 180MB가 필요합니다.',pending,initTimer;
  const status=()=>({state:state==='idle'?'loading':state,message,busy:!!pending,mock:false,provider:'browser-clip'});
  function fail(text){
    state='error';message=text;clearTimeout(initTimer);worker?.terminate();worker=null;
    if(pending){clearTimeout(pending.timer);pending.reject(Error(text));pending=null;}
  }
  function start(){
    if(worker)return status();
    state='loading';message='AI 모델 준비 중 · 처음에는 약 180MB를 다운로드합니다.';
    try{
      worker=new Worker(new URL('./ai-worker.js',import.meta.url),{type:'module'});
      worker.onmessage=({data})=>{
        if(data.type==='progress')message=data.message;
        if(data.type==='ready'){clearTimeout(initTimer);state='ready';message='기기 AI 준비 완료';}
        if(data.type==='init-error'){console.error('Browser AI initialization:',data.detail);fail('AI 모델을 불러오지 못했습니다. 외부 모델 다운로드 허용 여부와 인터넷 연결을 확인하고 다시 연결해 주세요.');}
        if(pending&&data.id===pending.id){const item=pending;clearTimeout(item.timer);pending=null;if(data.type==='result')item.resolve(data.result);else item.reject(Error('AI 분석에 실패했습니다. 다시 촬영해 주세요.'));}
      };
      worker.onerror=()=>fail('이 브라우저에서 AI를 실행하지 못했습니다. 최신 Chrome·Edge에서 다시 시도하거나 외부 다운로드 허용 여부를 확인해 주세요.');
      initTimer=setTimeout(()=>fail('AI 모델 준비 시간이 초과되었습니다. 인터넷 연결을 확인하고 다시 연결해 주세요.'),180000);
      worker.postMessage({type:'init'});
    }catch{fail('브라우저 AI 실행을 지원하지 않습니다. 최신 Chrome·Edge에서 HTTPS 주소로 접속해 주세요.');}
    return status();
  }
  return {status:()=>{if(state==='idle')start();return status();},retry:()=>{if(state==='error')start();return status();},
    analyze(bytes,mime,productType){
      if(state!=='ready')return Promise.reject(Error(message));
      if(pending)return Promise.reject(Error('다른 사진을 분석 중입니다. 잠시 후 다시 시도해 주세요.'));
      return new Promise((resolve,reject)=>{
        const id=crypto.randomUUID(),timer=setTimeout(()=>fail('AI 분석 시간이 초과되었습니다. 다시 연결한 뒤 재시도해 주세요.'),120000);
        pending={id,timer,resolve,reject};worker.postMessage({type:'analyze',id,bytes,mime,productType});
      });
    },close(){clearTimeout(initTimer);worker?.terminate();worker=null;state='idle';if(pending){clearTimeout(pending.timer);pending.reject(Error('AI 연결을 종료했습니다.'));pending=null;}}
  };
}
