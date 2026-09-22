import {findProduct} from './catalog.js';
export const STORE_NAME='GS25타워점';
export const PRODUCT_TYPES = {banana:'바나나',peach:'복숭아',watermelon:'수박'};
export class AppError extends Error { constructor(status, message) { super(message); this.status=status; } }
export function validateContext(body,resolveProduct=findProduct) {
  const result = {};
  if(typeof body.deliveryId!=='string'||body.deliveryId.length>100)throw new AppError(400,'입고 건을 선택해 주세요.');
  result.deliveryId=body.deliveryId;
  for (const [key,max,label] of [['storeCode',30,'점포코드'],['productCode',40,'상품코드']]) {
    if(typeof body[key]!=='string'||!body[key].trim()) throw new AppError(400,`${label}를 입력해 주세요.`);
    const value=body[key].trim();
    if(value.length>max||! /^[A-Za-z0-9_-]+$/.test(value)) throw new AppError(400,`${label}는 영문·숫자·하이픈·밑줄로 입력해 주세요.`);
    result[key]=value;
  }
  const product=resolveProduct(result.productCode);
  if(!product)throw new AppError(400,'상품정보를 먼저 확인하거나 수기로 등록해 주세요.');
  if(body.productType&&body.productType!==product.type)throw new AppError(400,'상품코드와 상품 종류가 일치하지 않습니다. 상품을 다시 선택해 주세요.');
  result.productType=product.type;
  if(!['camera','upload','sample'].includes(body.source)) throw new AppError(400,'사진 입력 경로가 올바르지 않습니다.');
  result.source=body.source;
  const time=Date.parse(body.capturedAt);
  if(!Number.isFinite(time)||Math.abs(Date.now()-time)>24*60*60*1000) throw new AppError(400,'촬영·입력 시각을 확인하고 다시 촬영해 주세요.');
  result.capturedAt=new Date(time).toISOString();
  if(typeof body.requestId!=='string'||! /^[0-9a-f-]{36}$/i.test(body.requestId)) throw new AppError(400,'진단 요청 식별자가 올바르지 않습니다.');
  result.requestId=body.requestId;
  return result;
}
export function selectDecision(scores) {
  const ranked=[...scores].sort((a,b)=>b.score-a.score);
  const top=ranked[0], second=ranked[1];
  if(!top||!second||!ranked.every(x=>Number.isFinite(x.score)&&x.score>=0&&x.score<=1)) throw new Error('Invalid inference output');
  if(top.kind==='review'||top.score<0.60||top.score-second.score<0.15) return {verdict:'review',reason:'사진과 외관 설명의 일치도가 충분하지 않습니다. 밝은 곳에서 다시 촬영하거나 담당자에게 확인해 주세요.'};
  return {verdict:top.kind,reason:top.reason};
}
export function measureMetrics(input, elapsedMs) {
  const majorActions=Number.isInteger(input?.majorActions)&&input.majorActions>0&&input.majorActions<100?input.majorActions:null;
  const auxiliaryActions=Number.isInteger(input?.auxiliaryActions)&&input.auxiliaryActions>=0&&input.auxiliaryActions<100?input.auxiliaryActions:null;
  const clientElapsedMs=Number.isFinite(input?.elapsedMs)&&input.elapsedMs>=0&&input.elapsedMs<86400000?Math.round(input.elapsedMs):null;
  return {majorActions,auxiliaryActions,elapsedMs:clientElapsedMs,serverElapsedMs:elapsedMs,targetMet:majorActions!==null&&clientElapsedMs!==null&&majorActions<=2&&clientElapsedMs<=30000,scope:'앱 주요 조작 기준; 사전 설정·모델 준비·최초 권한 허용 제외',measurement:'client-observed'};
}
