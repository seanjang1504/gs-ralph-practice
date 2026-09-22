export function matchesInspection(delivery, filter, today) {
  if(filter==='attention')return !!followupForDelivery(delivery,today);
  if(filter==='manual')return delivery.source==='manual';
  if(filter==='expired')return delivery.deadlineExpired;
  if(delivery.arrivalDate!==today)return false;
  if(filter==='today')return true;
  if(filter==='total')return delivery.inspectionStatus!=='uninspected';
  if(filter==='unregistered')return delivery.unregistered;
  return ['pass','fail','review','uninspected'].includes(filter)&&delivery.inspectionStatus===filter;
}

// Follow-up work is independent of the AI verdict and never changes claim eligibility.
export function followupForDelivery(delivery,today) {
  const status=delivery.claimStatus;
  if(status==='rejected')return {priority:3,label:'업체 반려',next:'반려 사유 확인 · 필요 시 MD 검토 요청'};
  if(status==='approved')return {priority:4,label:'업체 승인',next:'승인 내역 · 매입차감 처리 확인'};
  if(delivery.claimId&&!['pending','failed'].includes(status))return null;
  const unsent=['pending','failed'].includes(status);
  const unresolved=['fail','review'].includes(delivery.inspectionStatus);
  if(!unsent&&!unresolved)return null;
  if(delivery.arrivalDate!==today)return {priority:5,label:'접수 기한 경과',next:'신규 접수 제한 · 담당자에게 확인'};
  if(unsent)return {priority:0,label:status==='failed'?'전송 실패':'전송 대기',next:'오늘까지 접수 재시도'};
  if(delivery.inspectionStatus==='fail')return {priority:1,label:'부적합 · 미접수',next:'오늘까지 수량 확인 후 해피콜 등록'};
  return {priority:2,label:'추가 확인 필요',next:'재촬영 또는 사용자 확인 후 접수 선택'};
}

export function attentionDeliveries(deliveries,today) {
  return deliveries.filter(d=>followupForDelivery(d,today)).sort((a,b)=>
    followupForDelivery(a,today).priority-followupForDelivery(b,today).priority||
    b.arrivalDate.localeCompare(a.arrivalDate)||a.id.localeCompare(b.id));
}

export function matchesClaim(item,{status='all',query=''}={}) {
  if(status==='unsent'&&!['pending','failed'].includes(item.status))return false;
  if(!['all','unsent'].includes(status)&&item.status!==status)return false;
  const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/g,'');
  const needle=normalize(query);
  return !needle||[item.diagnosis?.productName,item.diagnosis?.productCode,item.id,item.acknowledgment,item.delivery?.arrivalReference]
    .some(value=>normalize(value).includes(needle));
}

// Relative image/text match; not a calibrated accuracy or food-safety probability.
export function confidencePercent(diagnosis) {
  if(diagnosis.mock||diagnosis.provider==='quality-gate'||diagnosis.identity?.matched===false)return null;
  if(diagnosis.confidence?.basis==='visibility'){
    const score=diagnosis.confidence.score;
    return Number.isFinite(score)&&score>=0&&score<=1?Math.round(score*1000)/10:null;
  }
  const scores=diagnosis.scores?.map(s=>s.score);
  if(!scores?.length||scores.some(s=>!Number.isFinite(s)||s<0||s>1))return null;
  return Math.round(Math.max(...scores)*1000)/10;
}

export async function captureCountdown({tick,isCurrent,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  for(const count of [3,2,1]) {
    if(!isCurrent())return false;
    tick(count);
    await wait(1000);
  }
  return isCurrent();
}
