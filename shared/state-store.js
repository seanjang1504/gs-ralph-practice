const randomUUID=()=>crypto.randomUUID();
import { AppError } from './domain.js';
import { CATALOG } from './catalog.js';
import { koreaDay, quantity, requireDDay, transition, CLAIM_LABELS } from './workflow.js';

// Transaction-scoped state. PostgreSQL owns durability, row locks and photo bytes.
export function createStateStore(state, {clock=()=>new Date()}={}) {
  const transaction=fn=>fn();
  const putDelivery=d=>{state.deliveries[d.id]=d;};
  const putClaim=c=>{state.claims[c.id]=c;};
  const now=()=>clock().toISOString();
  return {
    close:()=>{},
    today:()=>koreaDay(clock()),
    seedDeliveries() {
      const today=this.today(), yesterday=koreaDay(new Date(clock().getTime()-86400000));
      const rows=[...CATALOG.map((p,i)=>({p,day:today,index:i})),{p:CATALOG[0],day:yesterday,index:0}];
      for(const {p,day,index} of rows) {
        const id='IN-'+day+'-'+p.code;
        const delivery={id,storeCode:'GS2501',storeName:'GS25타워점',productCode:p.code,productName:p.name,productType:p.type,
          arrivalDate:day,arrivalReference:'입고예시-'+day+'-'+(index+1),supplierName:'예시 신선업체',
          expectedQuantity:10,actualQuantity:null,quantityConfirmedAt:null,latestDiagnosisId:null,revision:0,source:'synthetic',unit:'판매단위'};
        state.deliveries[id]??=delivery;
      }
    },
    delivery:id=>state.deliveries[id]||null,
    products() {
      const products=new Map(CATALOG.map(p=>[p.code,p]));
      for(const row of Object.values(state.deliveries)) {
        if(row.source==='manual'&&!products.has(row.productCode))products.set(row.productCode,{code:row.productCode,name:row.productName,type:row.productType,package:'수기 등록 상품',manualCheck:'상품명·품목·포장 단위는 수기로 입력한 정보입니다. 실물과 함께 확인해 주세요.',source:'manual'});
      }
      return [...products.values()];
    },
    createManualDelivery(input) {
      return transaction(()=>{
        if(!input||typeof input!=='object')throw new AppError(400,'상품정보와 실제 입고일을 입력해 주세요.');
        const productCode=typeof input.productCode==='string'?input.productCode.trim():'';
        if(!/^\d{8,14}$/.test(productCode))throw new AppError(400,'바코드 숫자 8~14자리를 입력해 주세요.');
        const arrivalDate=input.arrivalDate;
        if(typeof arrivalDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(arrivalDate)||!Number.isFinite(Date.parse(arrivalDate))||new Date(arrivalDate).toISOString().slice(0,10)!==arrivalDate||arrivalDate>this.today())
          throw new AppError(400,'실제 입고일을 오늘 또는 이전 날짜로 입력해 주세요.');
        const known=this.products().find(p=>p.code===productCode);
        const productName=known?.name||(typeof input.productName==='string'?input.productName.trim():'');
        const productType=known?.type||input.productType;
        if(!productName||productName.length>120)throw new AppError(400,'상품명을 1~120자로 입력해 주세요.');
        if(!['banana','peach','watermelon'].includes(productType))throw new AppError(400,'현재 선도 진단 가능한 품목은 바나나·복숭아·수박입니다.');
        const matches=this.deliveries().filter(d=>d.storeCode==='GS2501'&&d.productCode===productCode&&d.arrivalDate===arrivalDate);
        const existingManual=matches.find(d=>d.source==='manual');
        if(existingManual)return existingManual;
        if(matches.length>1)throw new AppError(409,'같은 날짜의 입고 건이 여러 개입니다. 입고목록에서 선택해 주세요.');
        if(matches.length===1&&arrivalDate===this.today())return matches[0];
        const previous=matches[0];
        const delivery={id:'MAN-'+arrivalDate+'-'+productCode,storeCode:'GS2501',storeName:'GS25타워점',productCode,productName,productType,arrivalDate,
          arrivalReference:'수기-'+arrivalDate+'-'+productCode,supplierName:previous?.supplierName||'미확인',expectedQuantity:previous?.expectedQuantity??null,actualQuantity:null,quantityConfirmedAt:null,latestDiagnosisId:null,revision:0,source:'manual',unit:'판매단위',createdAt:now(),recordedDate:this.today(),catalogMatched:!!known,linkedDeliveryId:previous?.id||null};
        putDelivery(delivery);
        return this.deliveries().find(d=>d.id===delivery.id);
      });
    },
    claimForDelivery:id=>Object.values(state.claims).find(c=>c.deliveryId===id)||null,
    deliveries() {
      return Object.values(state.deliveries).map(d=>{
        const diagnosis=d.latestDiagnosisId?this.diagnosis(d.latestDiagnosisId):null, claim=this.claimForDelivery(d.id);
        return {...d,shortageQuantity:d.actualQuantity===null||d.expectedQuantity===null?null:Math.max(0,d.expectedQuantity-d.actualQuantity),
          inspectionStatus:diagnosis?.verdict||'uninspected', diagnosisId:diagnosis?.id||null,
          claimId:claim?.id||null,claimStatus:claim?.status||null,claimLabel:claim?CLAIM_LABELS[claim.status]:null,
          requestedQuantity:claim?.requestedQuantity||0,
          unregistered:(diagnosis?.verdict==='fail'&&!claim)||!!claim&&['pending','failed'].includes(claim.status),
          deadlineExpired:d.arrivalDate!==this.today()};
      }).sort((a,b)=>b.arrivalDate.localeCompare(a.arrivalDate)||a.id.localeCompare(b.id));
    },
    confirmQuantity(id,value) {
      return transaction(()=>{
        const d=this.delivery(id);if(!d)throw new AppError(404,'입고 건을 찾을 수 없습니다.');
        if(d.source!=='manual')requireDDay(d,this.today());quantity(value,'실입고 수량');
        if(this.claimForDelivery(id))throw new AppError(409,'접수 요청에 연결된 입고 수량은 변경할 수 없습니다.');
        const changed=d.actualQuantity!==value;
        const saved={...d,actualQuantity:value,quantityConfirmedAt:now(),revision:d.revision+1,
          latestDiagnosisId:changed?null:d.latestDiagnosisId};
        putDelivery(saved);return saved;
      });
    },
    validateDelivery(context) {
      const d=this.delivery(context.deliveryId);
      if(!d)throw new AppError(400,'당일 입고 건을 선택해 주세요.');
      if(d.source!=='manual')requireDDay(d,this.today());
      if(d.storeCode!==context.storeCode||d.productCode!==context.productCode)throw new AppError(409,'선택한 입고 건과 점포·상품 정보가 다릅니다.');
      if(d.actualQuantity===null||!d.quantityConfirmedAt)throw new AppError(400,'실입고 수량을 먼저 확인하고 저장해 주세요.');
      if(d.actualQuantity===0)throw new AppError(409,'실입고 수량이 0인 상품은 촬영 검수할 수 없습니다.');
      if(this.claimForDelivery(d.id))throw new AppError(409,'이미 접수 요청이 있습니다. 접수 내역에서 재시도하거나 상태를 확인해 주세요.');
      return d;
    },
    findRequest:id=>Object.values(state.diagnoses).find(d=>d.requestId===id)||null,
    diagnosis:id=>state.diagnoses[id]||null,
    photo:id=>state.photos[id]?.preview,
    original:id=>state.photos[id]?.original,
    saveDiagnosis(diagnosis,photo,original,mime) {
      return transaction(()=>{
        const d=this.validateDelivery(diagnosis);
        if(d.revision!==diagnosis.delivery.revision)throw new AppError(409,'분석 중 입고 수량이 변경되었습니다. 다시 촬영해 주세요.');
        if(!original?.size)throw new AppError(400,'증빙사진 원본이 필요합니다.');
        const existing=this.findRequest(diagnosis.requestId);
        if(existing){if(existing.requestHash!==diagnosis.requestHash)throw new AppError(409,'이미 사용된 요청입니다. 새로 촬영해 주세요.');return existing;}
        state.diagnoses[diagnosis.id]=diagnosis;
        state.photos[diagnosis.id]={preview:true,original:true};
        putDelivery({...d,latestDiagnosisId:diagnosis.id});return diagnosis;
      });
    },
    register(id,metrics,requestedQuantity,{manualReviewConfirmed=false}={}) {
      return transaction(()=>{
        const diagnosis=this.diagnosis(id);
        if(!diagnosis)throw new AppError(404,'진단 내역을 찾을 수 없습니다. 다시 진단해 주세요.');
        const existing=Object.values(state.claims).find(c=>c.diagnosisId===id);
        if(existing){
          if(requestedQuantity!==existing.requestedQuantity)throw new AppError(409,'이미 저장한 요청 수량과 다릅니다. 기존 접수 내역을 확인해 주세요.');
          return this.record(existing.id);
        }
        const d=this.validateDelivery(diagnosis);
        if(d.latestDiagnosisId!==id)throw new AppError(409,'가장 최근의 검수 결과로 접수해 주세요.');
        requireDDay(d,this.today());
        const manualReview=diagnosis.verdict==='review'&&manualReviewConfirmed===true;
        if(diagnosis.verdict!=='fail'&&!manualReview)throw new AppError(409,'부적합 상품 또는 추가 확인 결과에서 사용자가 접수를 선택한 상품만 등록할 수 있습니다.');
        quantity(requestedQuantity,'선도 부적합 수량',1);
        if(requestedQuantity>d.actualQuantity)throw new AppError(400,'선도 부적합 수량은 실입고 수량을 초과할 수 없습니다.');
        if(!this.original(id)||!this.photo(id))throw new AppError(400,'증빙사진이 누락되었습니다. 다시 촬영해 주세요.');
        const time=now(),claim={id:'HC-'+randomUUID(),deliveryId:d.id,diagnosisId:id,delivery:{...d},
          createdAt:time,updatedAt:time,status:'pending',requestedQuantity,approvedQuantity:0,approvedAt:null,
          manualReviewConfirmed:manualReview,registrationBasis:manualReview?'operator-review':'ai-fail',
          metrics,integration:'local-mock',simulated:true,events:[{status:'pending',actor:'점포',reason:manualReview?'AI 추가 확인 필요 · 사용자가 해피콜 등록 선택, 사진·수량 저장, 아직 미접수':'사진·입고정보 저장, 아직 미접수',at:time,simulated:true}]};
        putClaim(claim);
        return this.record(claim.id);
      });
    },
    submit(id,{simulateFailure=false}={}) {
      return transaction(()=>{
        const claim=state.claims[id]||null;
        if(!claim)throw new AppError(404,'접수 요청을 찾을 수 없습니다.');
        if(!['pending','failed'].includes(claim.status))return this.record(id);
        requireDDay(claim.delivery,this.today());
        if(!this.original(claim.diagnosisId))throw new AppError(400,'증빙사진 원본이 누락되어 전송할 수 없습니다.');
        const time=now(),status=simulateFailure?'failed':'vendor_review';
        putClaim({...claim,status,updatedAt:time,...(!simulateFailure?{submittedAt:time,acknowledgment:'SIM-'+randomUUID()}:{}),
          events:[...claim.events,{status,actor:'모의 접수 서버',reason:simulateFailure?'전송 실패 재현 · 미접수':'모의 접수 응답 확인 · 실제 업체 전송 없음',at:time,simulated:true}]});
        return this.record(id);
      });
    },
    transition(id,action,reason,expectedStatus) {
      return transaction(()=>{
        const claim=state.claims[id]||null;
        if(!claim)throw new AppError(404,'접수 요청을 찾을 수 없습니다.');
        if(claim.status!==expectedStatus)throw new AppError(409,'처리 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요.');
        putClaim(transition(claim,action,reason,now()));return this.record(id);
      });
    },
    record(id) {
      const claim=state.claims[id]||null;
      if(claim)return {...claim,statusLabel:CLAIM_LABELS[claim.status],diagnosis:this.diagnosis(claim.diagnosisId)};
      return null;
    },
    records() {
      const ids=Object.values(state.claims);
      return ids.map(row=>this.record(row.id)).filter(r=>!r.diagnosis.mock).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100);
    },
    updateMetrics(id,metrics){
      const claim=state.claims[id]||null;
      if(claim)putClaim({...claim,metrics});

    },
    stats(){
      const day=this.today(),today=this.deliveries().filter(d=>d.arrivalDate===day);
      return {day,total:today.filter(d=>d.inspectionStatus!=='uninspected').length,
        pass:today.filter(d=>d.inspectionStatus==='pass').length,fail:today.filter(d=>d.inspectionStatus==='fail').length,
        review:today.filter(d=>d.inspectionStatus==='review').length,
        uninspected:today.filter(d=>d.inspectionStatus==='uninspected').length,unregistered:today.filter(d=>d.unregistered).length};
    }
  };
}

