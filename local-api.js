import {createBrowserStore} from './local-store.js';
import {createBrowserAI} from './ai-client.js';
import {AppError,validateContext,measureMetrics,STORE_NAME} from './shared/domain.js';
import {CRITERIA,RULE_VERSION} from './shared/catalog.js';

const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
async function prepareImage(blob){
  const bitmap=await createImageBitmap(blob).catch(()=>{throw Error('사진 파일을 읽을 수 없습니다. 다른 사진을 선택해 주세요.');});
  try{
    if(bitmap.width*bitmap.height>24000000)throw Error('2,400만 화소 이하의 사진을 선택해 주세요.');
    const scale=Math.min(1,1280/bitmap.width,1280/bitmap.height),canvas=document.createElement('canvas');
    canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
    const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const preview=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));if(!preview)throw Error('사진을 처리하지 못했습니다.');
    const tiny=document.createElement('canvas');tiny.width=64;tiny.height=64;const ctx=tiny.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0,64,64);
    const pixels=ctx.getImageData(0,0,64,64).data,stats=[0,1,2].map(c=>{let sum=0,squares=0;for(let i=c;i<pixels.length;i+=4){sum+=pixels[i];squares+=pixels[i]*pixels[i];}const mean=sum/4096;return {mean,stdev:Math.sqrt(Math.max(0,squares/4096-mean*mean))};});
    return {preview,lowQuality:Math.min(bitmap.width,bitmap.height)<224||stats.every(c=>c.mean<18)||stats.every(c=>c.stdev<10)};
  }finally{bitmap.close();}
}

export function createLocalAPI({store=createBrowserStore(),ai=createBrowserAI()}={}){
  const urls=new Map();
  async function decorate(value){
    if(!value)return value;
    const diagnoses=value.records?value.records.map(r=>r.diagnosis):[value.diagnosis||value];
    for(const d of diagnoses){
      if(!d?.originalSha256)continue;
      if(!urls.has(d.id)){
        const evidence=await store.photo(d.id);
        if(evidence)urls.set(d.id,{photoUrl:URL.createObjectURL(evidence.preview),originalUrl:URL.createObjectURL(evidence.original)});
      }
      Object.assign(d,urls.get(d.id)||{photoUrl:'',originalUrl:''});
    }return value;
  }
  return async function localAPI(url,options={}){
    const path=new URL(url,location.href).pathname,method=options.method||'GET';
    const body=options.body?JSON.parse(options.body):{};
    const id=decodeURIComponent(path.split('/')[3]||'');
    const run=fn=>store.run(fn);
    if(path==='/api/health')return {ai:ai.status(),integration:'browser-demo',productionConnected:false};
    if(path==='/api/model/retry')return ai.retry();
    if(path==='/api/catalog')return run(s=>({storeName:STORE_NAME,products:s.products(),criteria:CRITERIA,criteriaVersion:RULE_VERSION}));
    if(path==='/api/stats')return run(s=>s.stats());
    if(path==='/api/deliveries'||path==='/api/deliveries/demo')return run(s=>({today:s.today(),source:'synthetic',deliveries:s.deliveries()}));
    if(path==='/api/deliveries/manual')return run(s=>s.createManualDelivery(body));
    if(/^\/api\/deliveries\/[^/]+\/quantity$/.test(path))return run(s=>s.confirmQuantity(id,body.actualQuantity));
    if(method==='GET'&&path.startsWith('/api/diagnoses/')){const d=await run(s=>s.diagnosis(id));if(!d)throw Error('진단 내역을 찾을 수 없습니다.');return decorate(d);}
    if(method==='POST'&&path==='/api/diagnoses'){
      if(body.mode!=='ai')throw Error('실제 AI 분석만 사용할 수 있습니다.');
      const match=typeof body.image==='string'&&body.image.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if(!match)throw Error('JPEG·PNG·WebP 사진을 선택해 주세요.');
      if(match[2].length>8*1024*1024+4)throw Error('사진은 6MB 이하여야 합니다.');
      const bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));
      if(bytes.length>6*1024*1024)throw Error('사진은 6MB 이하여야 합니다.');
      const starts=values=>values.every((value,index)=>bytes[index]===value);
      const mime=starts([255,216,255])?'image/jpeg':starts([137,80,78,71,13,10,26,10])?'image/png':starts([82,73,70,70])&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':null;
      if(!mime)throw Error('지원하는 사진 형식이 아닙니다. JPEG·PNG·WebP를 선택해 주세요.');
      const original=new Blob([bytes],{type:mime});
      const context=await run(s=>validateContext(body,code=>s.products().find(p=>p.code===code)));
      const encoded=new TextEncoder().encode(JSON.stringify({...context,mode:'ai'})),joined=new Uint8Array(encoded.length+bytes.length);joined.set(encoded);joined.set(bytes,encoded.length);
      const requestHash=await sha(joined);
      const prepared=await run(s=>{
        const existing=s.findRequest(context.requestId);if(existing){if(existing.requestHash!==requestHash)throw new AppError(409,'이미 사용된 요청입니다. 다시 촬영해 주세요.');return {existing};}
        return {delivery:s.validateDelivery(context),product:s.products().find(p=>p.code===context.productCode)};
      });
      if(prepared.existing)return decorate(prepared.existing);
      const {preview,lowQuality}=await prepareImage(original);
      const result=lowQuality?{verdict:'review',reason:'사진이 작거나 너무 어둡고 단조로워 외관을 확인하기 어렵습니다. 밝은 곳에서 다시 촬영해 주세요.',provider:'quality-gate',scores:[],assessments:[],inferenceMs:0}:await ai.analyze(bytes,mime,context.productType);
      const {delivery,product}=prepared;
      const d={id:crypto.randomUUID(),...context,delivery,storeName:STORE_NAME,requestHash,createdAt:new Date().toISOString(),criteriaVersion:RULE_VERSION,criteria:CRITERIA[context.productType],...result,productName:product.name,package:product.package,manualCheck:product.manualCheck,provider:result.provider||'browser-clip',mock:result.mock===true,photoSha256:await sha(await preview.arrayBuffer()),originalSha256:await sha(bytes),metrics:measureMetrics(body.metrics,0),integration:'browser-demo',processingLocation:'this-browser',limitations:'외관 참고 판정입니다. 상대 일치도는 진단 정확도나 안전 확률이 아닙니다.',photoUrl:'',originalUrl:''};
      return decorate(await store.saveDiagnosis(d,preview,original,mime));
    }
    if(method==='POST'&&path==='/api/happycalls')return decorate(await run(s=>{const d=s.diagnosis(body.diagnosisId);return s.register(body.diagnosisId,measureMetrics(body.metrics,d?Date.now()-Date.parse(d.createdAt):0),body.requestedQuantity,{manualReviewConfirmed:body.manualReviewConfirmed});}));
    if(path.endsWith('/submit')){
      const record=await decorate(await run(s=>s.submit(id,{simulateFailure:body.simulateFailure===true})));
      if(record.status==='failed'){const error=Error('접수 처리에 실패했습니다. D일 이내에 재시도해 주세요.');error.record=record;throw error;}return record;
    }
    if(path.endsWith('/simulate'))return decorate(await run(s=>s.transition(id,body.action,body.reason,body.expectedStatus)));
    if(path.endsWith('/measurement')){await run(s=>{const r=s.record(id);if(!r)throw Error('접수 내역을 찾을 수 없습니다.');s.updateMetrics(id,measureMetrics(body,r.metrics?.serverElapsedMs||0));});return {saved:true};}
    if(path==='/api/happycalls')return decorate(await run(s=>({records:s.records()})));
    if(path.startsWith('/api/happycalls/')){const r=await run(s=>s.record(id));if(!r)throw Error('접수 내역을 찾을 수 없습니다.');return decorate(r);}
    throw Error('요청한 기능을 찾을 수 없습니다.');
  };
}
export const localAPI=createLocalAPI();
