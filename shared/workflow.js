import {AppError} from './domain.js';

export const koreaDay = (date = new Date()) => date.toLocaleDateString('en-CA', {timeZone:'Asia/Seoul'});
export const CLAIM_LABELS = {
  pending:'미접수 · 전송 대기', failed:'미접수 · 전송 실패', vendor_review:'업체 검토 중',
  approved:'업체 승인', rejected:'업체 반려', md_review:'분쟁 · MD 검토 중',
  deducted:'매입차감 완료', legacy:'이전 로컬 저장 · 업체 미접수'
};
export function quantity(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > 1000000)
    throw new AppError(400, `${label}은 ${minimum} 이상의 정수로 입력해 주세요.`);
  return value;
}
export function requireDDay(delivery, today) {
  if (delivery.arrivalDate !== today)
    throw new AppError(409, '입고 당일(D일)에만 등록할 수 있습니다. 기한이 지난 건은 담당자에게 확인해 주세요.');
}
export function transition(claim, action, reason, time) {
  const rules = {
    approve: {from:['vendor_review'], to:'approved', actor:'모의 업체'},
    reject: {from:['vendor_review'], to:'rejected', actor:'모의 업체', reason:true},
    dispute: {from:['rejected'], to:'md_review', actor:'점포', reason:true},
    md_return: {from:['md_review'], to:'vendor_review', actor:'모의 MD', reason:true},
    deduct: {from:['approved'], to:'deducted', actor:'모의 차감 시스템'}
  };
  const rule = rules[action];
  if (!rule || !rule.from.includes(claim.status))
    throw new AppError(409, '현재 상태에서 진행할 수 없습니다. 매입차감 완료에는 업체 승인이 필요합니다.');
  if (action === 'deduct' && !claim.approvedAt)
    throw new AppError(409, '업체 승인 기록이 없어 매입차감을 완료할 수 없습니다.');
  const note = typeof reason === 'string' ? reason.trim() : '';
  if ((rule.reason && !note) || note.length > 1000)
    throw new AppError(400, '처리 사유를 1~1,000자로 입력해 주세요.');
  return {...claim, status:rule.to, updatedAt:time,
    ...(action === 'approve' ? {approvedAt:time, approvedQuantity:claim.requestedQuantity} : {}),
    ...(action === 'reject' ? {rejectionReason:note} : {}),
    ...(action === 'dispute' ? {disputeReason:note} : {}),
    ...(action === 'md_return' ? {mdReason:note} : {}),
    ...(action === 'deduct' ? {deductedAt:time} : {}),
    events:[...claim.events, {status:rule.to, actor:rule.actor, reason:note, at:time, simulated:true}]
  };
}
