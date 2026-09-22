import {classify} from './shared/inference.js';
const MODEL_ID='Xenova/clip-vit-base-patch32',revision='d15189d7028b43f1d3e65039190477f6af591c2a';
let classifier,RawImage,loading;
async function initialize(){
  try{
    const library=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
    RawImage=library.RawImage;
    library.env.allowLocalModels=false;
    library.env.useBrowserCache=true;
    library.env.backends.onnx.wasm.numThreads=1;
    library.env.backends.onnx.wasm.proxy=false;
    classifier=await library.pipeline('zero-shot-image-classification',MODEL_ID,{device:'wasm',dtype:'q8',revision,
      progress_callback:event=>{if(event.status==='progress'&&event.file?.endsWith('.onnx'))self.postMessage({type:'progress',message:'AI 모델 다운로드 '+Math.round(event.progress||0)+'% · 사진은 기기에서 분석됩니다.'});}
    });
    self.postMessage({type:'ready'});
  }catch(error){console.error('Browser model initialization failed:',error.message);self.postMessage({type:'init-error',detail:String(error.message).slice(0,500)});}
}
self.onmessage=async({data})=>{
  if(data.type==='init'){loading??=initialize();return;}
  if(data.type!=='analyze')return;
  try{
    await loading;if(!classifier)throw Error('Model unavailable');
    const image=await RawImage.fromBlob(new Blob([data.bytes],{type:data.mime}));
    const result=await classify(classifier,image,data.productType,MODEL_ID,revision);
    self.postMessage({type:'result',id:data.id,result:{...result,provider:'browser-clip',mock:false}});
  }catch(error){console.error('Browser inference failed:',error.message);self.postMessage({type:'error',id:data.id});}
};
