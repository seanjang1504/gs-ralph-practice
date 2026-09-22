import {localAPI as api} from './local-api.js';
import {SAMPLES} from './samples.js';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
import {matchesInspection,confidencePercent,captureCountdown,followupForDelivery,attentionDeliveries,matchesClaim} from './inspection-ui.js';
import {findBarcodeDelivery,createBarcodeReader,validateDefectQuantity} from './barcode.js';
import {getFreshnessProfile} from './freshness-data.js';
let cameraMode='photo',barcodeReader=null,barcodeTimer=null,barcodeMatching=false,defectQuantity=null;
let manualReviewConfirmed=false,lastBarcode='',lastBarcodeAt=0;
const names={banana:'바나나',peach:'복숭아',watermelon:'수박'};
const DEMO_SCAN_PRODUCT={code:'8809153476197',name:'델몬트)클래식바나나2입'};
let products=[],criteria={},catalogReady=false,cameraReadyContext=null;
let deliveries=[],selectedDelivery=null,today='';
let inspectionPage='home';
let historyRecords=[],historyRequest=0;
const listTitles={total:'총 검수 내역',pass:'적합 상품',fail:'부적합 상품',review:'확인 필요 상품',today:'오늘 입고 전체',uninspected:'미검수 상품',unregistered:'미접수 상품',expired:'기한 경과 입고',manual:'목록 외 수기 검수',attention:'조치가 필요한 상품'};
const verdicts={pass:'적합',fail:'부적합',review:'추가 확인 필요',uninspected:'미검수'};
let busy=false,aiReady=false,current=null,record=null,pending=null,workflow=null,stream=null,cameraToken=0,view='scan';
const formatTime=value=>new Date(value).toLocaleString('ko-KR',{hour12:false,timeZone:'Asia/Seoul'});
function metrics(){return {majorActions:workflow?.major||0,auxiliaryActions:workflow?.aux||0,elapsedMs:workflow?Math.round(performance.now()-workflow.start):0};}
function begin(){workflow={start:performance.now(),major:1,aux:0};current=null;record=null;pending=null;clearAlert();$('item-setup').hidden=true;$('result').hidden=true;$('capture-guide').hidden=false;updateFooter();}
function action(){if(workflow)workflow.major++;}
const post=(url,body,timeout)=>api(url,{method:'POST',body:JSON.stringify(body),timeout});
function clearAlert(){for(const id of ['alert','history-alert']){const box=$(id);if(box){box.hidden=true;box.replaceChildren();}}}
function showAlert(message,buttons=[]){
  const box=$(view==='history'?'history-alert':'alert');box.replaceChildren();const text=document.createElement('div');text.textContent=message;box.append(text);
  for(const [label,fn] of buttons){const button=document.createElement('button');button.className='button';button.textContent=label;button.onclick=fn;box.append(button);}
  box.hidden=false;box.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function setBusy(value){busy=value;for(const id of ['home-button','scan-button','upload-button','sample-fresh','sample-rotten','sample-peach','sample-peach-moldy','sample-watermelon','reset-button','product-select','save-quantity','actual-quantity','refresh-deliveries','scan-tab','history-tab','summary-total','summary-pass','summary-fail','summary-review','open-uninspected','open-unregistered','open-attention','back-overview','back-details','delivery-filter','history-query','history-status','history-clear','refresh-history','history-back'])$(id).disabled=value;document.querySelectorAll('.delivery-button,.record-card').forEach(b=>b.disabled=value);updateFooter();}
function getContext(){
  const storeCode=$('store-code').value.trim(),productCode=$('product-code').value.trim();
  if(!storeCode||!productCode){$('store-details').open=true;(!storeCode?$('store-code'):$('product-code')).focus();throw Error('점포코드와 상품코드를 모두 입력해 주세요.');}
  if(!/^[A-Za-z0-9_-]+$/.test(storeCode)||!/^[A-Za-z0-9_-]+$/.test(productCode))throw Error('점포·상품코드는 영문, 숫자, 하이픈, 밑줄로 입력해 주세요.');
  if(!selectedDelivery)throw Error('당일 입고 건을 선택해 주세요.');
  if(selectedDelivery.deadlineExpired&&selectedDelivery.source!=='manual')throw Error('입고 당일(D일)이 지나 등록할 수 없습니다. 목록 외 수기 검수에서는 선도 진단만 진행할 수 있습니다.');
  if(selectedDelivery.actualQuantity===null||!selectedDelivery.quantityConfirmedAt)throw Error('실입고 수량을 먼저 확인하고 저장해 주세요.');
  if(Number($('actual-quantity').value)!==selectedDelivery.actualQuantity)throw Error('변경한 실입고 수량을 먼저 저장해 주세요.');
  if(selectedDelivery.actualQuantity===0)throw Error('실입고 수량이 0인 상품은 촬영 검수할 수 없습니다.');
  if(selectedDelivery.claimId)throw Error('이미 접수 요청이 있습니다. 접수 내역에서 재시도하거나 상태를 확인해 주세요.');
  return {storeCode,productCode,productType:$('product-type').value,deliveryId:selectedDelivery.id};
}
function ensureReady(){getContext();if(!catalogReady||!aiReady)throw Error('상품 기준과 AI 모델을 준비하고 있습니다. 준비 완료 후 다시 시도하거나 다시 연결을 눌러 주세요.');}
function updateContext(){
  const productCount=products.length||4;
  $('context-summary').textContent=[$('store-code').value||'점포 미입력','등록 상품 '+productCount+'종'].join(' · ');
  $('stats-scope').textContent='등록 상품 '+productCount+'종';
  document.querySelector('.home-store-badge').textContent='등록 '+productCount+'종';document.querySelector('.product-picker label span').textContent='등록 '+productCount+'종';
  $('status-store').textContent=inspectionPage==='home'?($('store-code').value||'점포 미입력'):'ST';
  try{localStorage.setItem('freshcheck-context',JSON.stringify({storeCode:$('store-code').value,productCode:$('product-code').value,productType:$('product-type').value}));}catch{}
}
function updateFooter(){
  const button=$('scan-button');button.classList.toggle('register',!!current&&current.verdict==='fail'&&!record&&view==='scan'&&inspectionPage==='item');
  button.disabled=busy;
  if(busy){button.innerHTML='<span class="spinner"></span><span><strong>처리 중입니다</strong><small>화면을 닫지 말아 주세요</small></span>';return;}
  if(view==='history'||inspectionPage==='home'||inspectionPage==='list'){button.innerHTML='<span class="button-icon">⌗</span><span><strong>검수하기</strong><small>카메라로 상품 바코드 스캔</small></span><span class="touch-label">›</span>';return;}
  if(record){const unsent=['pending','failed'].includes(record.status);if(unsent&&record.delivery?.arrivalDate!==today){button.disabled=true;button.innerHTML='<span class="button-icon">!</span><span><strong>접수 기한 경과</strong><small>입고 D일이 지났습니다 · 담당자에게 확인해 주세요</small></span>';return;}button.innerHTML='<span class="button-icon">'+(unsent?'↻':'✓')+'</span><span><strong>'+(unsent?'접수 재시도':'다른 입고 검수')+'</strong><small>'+(unsent?'아직 미접수 · D일 이내 재시도':'접수 내역에서 업체 처리 상태 확인')+'</small></span>';return;}
  if(current?.verdict==='fail'){button.innerHTML='<span class="button-icon">▤</span><span><strong>해피콜 등록</strong><small>사진 · 점포 · 상품 정보 자동 연결</small></span><span class="touch-label">›</span>';return;}
  if(current){button.innerHTML='<span class="button-icon">⌗</span><span><strong>'+(current.verdict==='review'?'다시 촬영 / 해피콜 등록':'다음 상품 스캔')+'</strong><small>'+(current.verdict==='pass'?'적합 상품 · 이번 검수 완료':'추가 확인 결과의 처리 방법을 선택하세요')+'</small></span>';return;}
  button.innerHTML='<span class="button-icon">⌗</span><span><strong>AI 선도 진단하기</strong><small>수량 확인 후 선도 촬영으로 이동</small></span><span class="touch-label">›</span>';
}
async function checkHealth(){
  try{const health=await api('/api/health',{timeout:5000});aiReady=health.ai.state==='ready';$('model-notice').hidden=aiReady;$('model-status').textContent=aiReady?'':health.ai.message;$('model-retry').hidden=health.ai.state!=='error';}
  catch{aiReady=false;$('model-notice').hidden=false;$('model-status').textContent='기기 저장소와 AI 다운로드 연결을 확인해 주세요.';$('model-retry').hidden=false;}
}
async function loadStats(){
  try{const stats=await api('/api/stats');for(const key of ['total','pass','fail','review'])$('stat-'+key).textContent=stats[key];$('stats-scope').textContent='등록 상품 '+(products.length||4)+'종';}catch{$('stats-scope').textContent='현황 불러오기 실패';}
}
async function loadCatalog(){try{const data=await api('/api/catalog');products=data.products;criteria=data.criteria;catalogReady=true;const previous=$('product-code').value;$('product-select').replaceChildren(...products.map(p=>new Option(p.name,p.code)));selectProduct(products.some(p=>p.code===previous)?previous:products[0].code);await loadDeliveries();}catch{catalogReady=false;showAlert('상품 기준을 불러오지 못했습니다.',[['다시 시도',loadCatalog]]);}}
function selectProduct(code){const product=products.find(p=>p.code===code);if(!product)return;$('product-select').value=product.code;$('product-code').value=product.code;$('product-type').value=product.type;$('product-barcode').textContent=product.code;const rule=criteria[product.type];$('criteria-view').innerHTML='<p><strong>적합 외관</strong><br>'+esc(rule.normal)+'</p><p><strong>확인 항목</strong><br>'+rule.rules.map(r=>esc(r.name)).join(' · ')+'</p>'+(rule.ripenessGuide?'<p><strong>숙도 참고</strong><br>'+esc(rule.ripenessGuide)+'</p>':'')+'<p>'+esc(rule.caution)+'</p><p><strong>사진으로 측정 불가</strong><br>'+esc(rule.unobservable)+'</p><p>'+esc(product.manualCheck)+'</p>'+referenceHTML(product.type)+(rule.sources||[{url:rule.source,title:'기준 참고 자료 · UC Davis'}]).map(s=>'<p><a href="'+esc(s.url)+'" target="_blank" rel="noreferrer">'+esc(s.title)+'</a></p>').join('');updateContext();}
function referenceHTML(type){const p=getFreshnessProfile(type);return p?'<p><strong>현장 확인 참고</strong><br>'+p.field.map(esc).join('<br>')+'</p><p><a href="./freshness.html#'+esc(p.id)+'" target="_blank" rel="noreferrer">품목별 검수 기준과 예외 보기</a></p>':'';}
function assessmentsHTML(d){if(!d.assessments?.length)return '';return '<section class="assessments"><h3>항목별 AI 측정</h3><p class="details-note">외관 설명과의 일치도입니다. 실제 불량 면적이나 안전 확률이 아닙니다.</p>'+d.assessments.map(a=>'<div class="assessment '+a.status+'"><div><strong>'+esc(a.name)+'</strong><span>'+({normal:'정상 외관',defect:'손상 의심',uncertain:'확인 필요'}[a.status])+'</span></div><progress max="1" value="'+a.topScore+'"></progress><small>가장 가까운 설명과 '+(a.topScore*100).toFixed(1)+'% 일치</small></div>').join('')+'<p class="details-note">'+esc(d.manualCheck)+'<br>'+esc(d.criteria?.caution)+'<br>사진으로 측정 불가: '+esc(d.criteria?.unobservable)+'</p></section>';}
const toDataURL=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('사진을 읽지 못했습니다. 다시 선택해 주세요.'));reader.readAsDataURL(blob);});
function photoMeta(d){return '<dl class="product-result-meta"><div><dt>상품명</dt><dd>'+esc(d.productName)+'</dd></div><div><dt>상품바코드</dt><dd class="barcode-value">'+esc(d.productCode)+'</dd></div></dl>';}
function confidenceHTML(d){
  const confidence=confidencePercent(d);
  return '<div class="confidence-card"><div><span>AI 신뢰도</span><strong>'+(confidence===null?'산출 불가':confidence.toFixed(1)+'<small>%</small>')+'</strong></div><p>'+(confidence===null?'분석 근거가 부족해 재촬영이 필요합니다.':d.confidence?.basis==='visibility'?'촬영 상태 설명과의 상대 일치도 · 선도 정확도는 아닙니다.':'외관 설명과의 상대 일치도 · 정확도 확률은 아닙니다.')+'</p></div>';
}
function recognitionHTML(d){
  if(d.productType!=='banana'||!d.identity)return '';
  const inspection=d.bananaInspection;
  return '<section class="banana-recognition"><h3>바나나 확인 결과</h3><p><strong>품목 인식</strong><span>'+ (d.identity.matched?'바나나 확인':'바나나 확인 어려움')+'</span></p>'+
    (inspection?.ripeness?'<p><strong>숙도 참고</strong><span>'+esc(inspection.ripeness.label)+(inspection.ripeness.estimated?' (추정)':'')+'</span></p>':'')+
    (inspection?.visibility&&['obstructed','blurred'].includes(inspection.visibility.status)?'<p><strong>촬영 상태</strong><span>'+ (inspection.visibility.status==='obstructed'?'포장 반사·가림 확인 필요':'밝기·초점 확인 필요')+'</span></p>':'')+
    '<small>품목 인식과 선도 판정은 별개입니다. 작은 갈색 반점만으로 부적합 처리하지 않습니다.</small></section>';
}
function renderDiagnosis(d,m){
  $('item-setup').hidden=true;$('capture-guide').hidden=true;const box=$('result');box.hidden=false;
  box.innerHTML='<div class="result-banner '+d.verdict+'"><span>AI 외관 판정</span><h2>'+verdicts[d.verdict]+'</h2><p>'+(d.verdict==='pass'?'이번 검수를 완료했습니다.':d.verdict==='fail'?'부적합 수량을 확인한 뒤 해피콜을 등록하세요.':'재촬영하거나 담당자에게 확인해 주세요.')+'</p></div><img class="result-photo" src="'+esc(d.photoUrl)+'" alt="진단에 사용한 상품 사진">'+photoMeta(d)+confidenceHTML(d)+'<section class="decision-reason"><h3>판정 이유</h3><p>'+esc(d.reason)+'</p></section>';
  box.querySelector('.confidence-card').insertAdjacentHTML('beforebegin',recognitionHTML(d));
  const next=document.createElement('div');next.className='result-actions';
  if(d.verdict==='fail'){
    const quantities=document.createElement('div');quantities.className='claim-quantity';
    quantities.innerHTML='<strong>실입고 '+d.delivery.actualQuantity+'개</strong><p class="helper">해피콜 등록 시 선도 불량 수량을 입력합니다.<br>입력한 수량만 요청되며 실입고 수량은 유지됩니다.</p><button id="open-defect-quantity" class="button">부적합 수량 입력</button>';
    box.append(quantities);$('open-defect-quantity').onclick=openDefectQuantity;
  }
  if(d.verdict==='review'){const button=document.createElement('button');button.className='button';button.textContent='처리 방법 선택';button.onclick=openReviewChoice;next.append(button);const upload=document.createElement('button');upload.className='text-button';upload.textContent='사진 파일 다시 선택';upload.onclick=()=>startUpload(false);next.append(upload);}
  if(d.verdict==='fail'){const button=document.createElement('button');button.className='text-button';button.textContent='등록 전 다시 촬영';button.onclick=()=>startScan(false);next.append(button);}
  const detail=document.createElement('details');detail.className='diagnosis-details';detail.innerHTML='<summary>항목별 판정 근거</summary>'+assessmentsHTML(d)+'<p class="details-note">'+esc(d.limitations)+'</p>';box.append(detail,next);updateFooter();box.scrollIntoView({block:'start',behavior:'smooth'});
}
async function diagnose(image,source,context){
  defectQuantity=null;manualReviewConfirmed=false;pending={...context,image,source,capturedAt:new Date().toISOString(),requestId:crypto.randomUUID(),mode:'ai'};
  return runDiagnosis();
}
async function runDiagnosis(){
  setBusy(true);clearAlert();$('capture-guide').hidden=true;$('result').hidden=false;
  $('result').innerHTML='<div class="loading-view"><span class="spinner"></span><h2>AI 외관 분석 중</h2><p class="helper">사진과 상품 정보를 연결하고 있습니다.</p></div>';
  try{
    current=await post('/api/diagnoses',{...pending,metrics:metrics()});renderDiagnosis(current,metrics());await loadStats();await loadDeliveries();
  }catch(error){$('result').hidden=true;showAlert(error.message,[['같은 사진으로 재시도',()=>{action();runDiagnosis();}],['새로 촬영',()=>startScan(false)]]);await checkHealth();}
  finally{setBusy(false);if(current?.verdict==='review')openReviewChoice();}
}
async function loadSample(kind,fresh=true){
  if(busy)return;
  try{const sample={fresh:['banana-normal','8809153478085'],rotten:['banana-overripe','8809153478085'],peach:['peach-normal','2345001827927'],'peach-moldy':['peach-moldy','2345001827927'],watermelon:['watermelon-whole','2800024017590']}[kind];const row=deliveries.find(d=>d.arrivalDate===today&&d.productCode===sample[1]);if(row&&row.id!==selectedDelivery?.id)await chooseDelivery(row.id);ensureReady();const context=getContext();if(fresh||!workflow)begin();else action();setBusy(true);const response=await fetch(SAMPLES[sample[0]]);if(!response.ok)throw Error('시연 사진을 불러오지 못했습니다. 사진 파일을 선택해 주세요.');await diagnose(await toDataURL(await response.blob()),'sample',context);}
  catch(error){setBusy(false);showAlert(error.message);}
}
function stopCamera(){
  clearTimeout(barcodeTimer);barcodeTimer=null;barcodeReader?.reset();barcodeReader=null;barcodeMatching=false;
  $('camera-dialog').classList.remove('counting-down');$('camera-sample').disabled=false;
  cameraToken++;cameraReadyContext=null;$('take-photo').disabled=true;stream?.getTracks().forEach(t=>t.stop());stream=null;$('camera-video').srcObject=null;if($('camera-dialog').open)$('camera-dialog').close();
}
async function openCamera(context,mode='photo'){
  clearTimeout(barcodeTimer);barcodeReader?.reset();barcodeReader=null;cameraMode=mode;barcodeMatching=false;lastBarcode='';lastBarcodeAt=0;
  const scanning=mode==='barcode';
  $('camera-dialog').classList.remove('camera-live');
  $('camera-dialog').classList.toggle('barcode-camera',scanning);
  $('barcode-controls').hidden=!scanning;$('photo-controls').hidden=scanning;$('barcode-error').hidden=true;
  $('barcode-action').hidden=!scanning;$('scan-barcode').disabled=false;
  if(scanning)$('barcode-controls').querySelector('p').textContent='바코드 인식 없이도 스캔하기를 누르면 '+DEMO_SCAN_PRODUCT.name+'으로 진행합니다.';
  $('camera-heading').textContent=scanning?'바코드 스캔':'상품 선도 촬영';
  $('camera-mode-label').textContent=scanning?'상품 인식':'선도 촬영';
  $('camera-steps').innerHTML=scanning?'<strong>① 바코드</strong><i></i><span>② 수량 확인</span><i></i><span>③ 선도 촬영</span>':'<span>① 바코드 · 수량 확인</span><i></i><strong>② 선도 촬영</strong>';
  const token=++cameraToken;stream?.getTracks().forEach(t=>t.stop());stream=null;
  cameraReadyContext=null;$('take-photo').disabled=true;
  $('camera-symbol').textContent='◎';$('camera-message').textContent='카메라 연결 중…';$('camera-help').textContent='카메라 권한을 허용해 주세요.';$('retry-camera').hidden=true;$('camera-upload').hidden=true;
  $('camera-product').textContent=scanning?'상품 포장의 바코드를 화면 중앙에 맞춰 주세요':context.productType==='banana'?'바나나 전체와 꼭지를 크게 맞추고 비닐 반사·라벨 가림을 피해 주세요':context.productCode+' · '+names[context.productType]+' · 상품 전체를 화면에 맞춰 주세요';
  if(!$('camera-dialog').open)$('camera-dialog').showModal();
  try{
    if(!window.isSecureContext)throw Error('HTTPS 또는 localhost 주소에서 카메라를 사용할 수 있습니다.');
    if(!navigator.mediaDevices?.getUserMedia)throw Error('이 브라우저는 카메라를 지원하지 않습니다. 사진 파일을 선택해 주세요.');
    let expired=false;
    const request=navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}},audio:false});
    request.then(s=>{if(expired||token!==cameraToken)s.getTracks().forEach(t=>t.stop());},()=>{});
    let timeout;const capture=await Promise.race([request,new Promise((_,reject)=>{timeout=setTimeout(()=>{expired=true;reject(Error('카메라 권한 응답이 없습니다. 브라우저의 카메라 권한을 확인해 주세요.'));},12000);})]).finally(()=>clearTimeout(timeout));
    if(token!==cameraToken){capture.getTracks().forEach(t=>t.stop());return;}
    stream=capture;const video=$('camera-video');video.srcObject=capture;await video.play();
    const readyAt=performance.now();while(!video.videoWidth){if(token!==cameraToken)return;if(performance.now()-readyAt>5000)throw Error('카메라 영상을 불러오지 못했습니다. 다시 시도해 주세요.');await new Promise(r=>setTimeout(r,100));}
    if(token!==cameraToken)return;
    if(scanning){$('camera-dialog').classList.add('camera-live');$('camera-symbol').textContent='⌗';$('camera-message').textContent='준비되면 스캔하기를 눌러 주세요';$('camera-help').textContent='예시 상품을 인식한 것으로 처리해 수량 확인으로 이동합니다.';return;}
    cameraReadyContext=context;$('take-photo').disabled=false;$('camera-symbol').textContent='⌗';$('camera-message').textContent='준비되면 사진을 촬영하세요';$('camera-help').textContent='촬영 버튼을 누르면 3·2·1 후 촬영합니다.'+(context.productType==='banana'?' 라벨이 없는 면을 카메라 쪽으로 돌리고 꼭지까지 보여 주세요.':'');
  }catch(error){
    if(token!==cameraToken)return;stream?.getTracks().forEach(t=>t.stop());stream=null;
    const denied=error.name==='NotAllowedError',missing=error.name==='NotFoundError';
    $('camera-symbol').textContent='ⓘ';$('camera-message').textContent=denied?'카메라 권한이 필요합니다':missing?'카메라를 찾을 수 없습니다':'카메라 연결을 확인해 주세요';
    $('camera-help').textContent=denied?'브라우저 설정에서 카메라를 허용한 뒤 다시 시도하세요.':missing?'카메라가 연결된 기기에서 열거나 사진 파일을 선택하세요.':error.message;
    if(scanning)$('camera-help').textContent+=' 하단 스캔하기로 예시 상품 검수를 계속할 수 있습니다.';
    $('retry-camera').hidden=false;$('camera-upload').hidden=scanning;setBusy(false);
  }
}
function startScan(fresh=true){
  if(busy)return;
  try{ensureReady();const context=getContext();if(fresh||!workflow)begin();else{action();current=null;record=null;updateFooter();}setBusy(true);openCamera(context);}
  catch(error){showAlert(error.message);}
}
let uploadContext=null;
function startUpload(fresh=true){
  if(busy)return;
  try{ensureReady();uploadContext=getContext();if(fresh||!workflow)begin();else action();$('file-input').value='';$('file-input').click();}
  catch(error){showAlert(error.message);}
}
$('file-input').onchange=async event=>{
  const file=event.target.files?.[0];if(!file)return;
  workflow.aux++;
  if(file.size>6*1024*1024)return showAlert('사진은 6MB 이하여야 합니다. 더 작은 사진을 선택해 주세요.',[['사진 다시 선택',()=>startUpload(false)]]);
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))return showAlert('JPEG·PNG·WebP 사진을 선택해 주세요.',[['사진 다시 선택',()=>startUpload(false)]]);
  try{setBusy(true);await diagnose(await toDataURL(file),'upload',uploadContext);}
  catch(error){showAlert(error.message);setBusy(false);}
};
async function register(){
  if(busy||!current||!['fail','review'].includes(current.verdict))return;
  if(current.verdict==='review'&&!manualReviewConfirmed)return openReviewChoice();
  let requestedQuantity;
  try{requestedQuantity=validateDefectQuantity(defectQuantity,current.delivery.actualQuantity);}catch{openDefectQuantity();return;}
  const simulateFailure=false;action();setBusy(true);clearAlert();
  try {
    record=await post('/api/happycalls',{diagnosisId:current.id,requestedQuantity,manualReviewConfirmed,metrics:metrics()});
    renderRecord(record,$('result'));
    record=await post('/api/happycalls/'+record.id+'/submit',{simulateFailure});
    const m=metrics();record.metrics={...record.metrics,...m};
    await post('/api/happycalls/'+record.id+'/measurement',m).catch(()=>{});
    renderRecord(record,$('result'),true);
    presentRegistrationComplete(record);
  }catch(error){
    if(error.record)record=error.record;
    if(record)renderRecord(record,$('result'));
    showAlert(error.message,[['접수 내역 확인',showHistory]]);
  }finally{setBusy(false);await loadDeliveries();await loadStats();}
}
async function submitRecord(item,target,simulateFailure=false) {
  if(busy)return;setBusy(true);clearAlert();
  try {
    const updated=await post('/api/happycalls/'+item.id+'/submit',{simulateFailure});
    if(record?.id===item.id)record=updated;renderRecord(updated,target);
    presentRegistrationComplete(updated);
  }catch(error){
    if(error.record){if(record?.id===item.id)record=error.record;renderRecord(error.record,target);}
    showAlert(error.message);
  }finally{setBusy(false);await loadDeliveries();await loadStats();}
}
function renderRecord(item,target,justRegistered=false){
  if(target===$('result'))$('item-setup').hidden=true;
  if(target===$('record-detail')){
    historyRecords=historyRecords.map(saved=>saved.id===item.id?item:saved);
    $('history-results').hidden=true;$('history-back').hidden=false;
  }
  const d=item.diagnosis,unsent=['pending','failed'].includes(item.status),delivery=item.delivery;
  target.hidden=false;target.className='result-card';
  target.innerHTML='<div class="result-banner '+(unsent?'review':'success')+'"><span>해피콜 접수</span><h2>'+esc(item.statusLabel)+'</h2><p>'+(unsent?'접수가 완료되지 않았습니다. 다시 시도해 주세요.':item.status==='legacy'?'이전 접수 기록입니다.':'사진과 상품 정보가 접수 내역에 연결되었습니다.')+'</p></div>'+
    (d.mock?'<div class="mock-label">모의 AI 판정 · 실제 분석 결과 아님</div>':'')+
    '<img class="result-photo" src="'+esc(d.photoUrl)+'" alt="해피콜 증빙 상품 사진">'+photoMeta(d)+
    (delivery?'<dl class="meta-grid"><div><dt>입고일 (한국 시간)</dt><dd>'+esc(delivery.arrivalDate)+'</dd></div><div><dt>입고번호</dt><dd>'+esc(delivery.arrivalReference)+'</dd></div><div><dt>전산 수량</dt><dd>'+(delivery.expectedQuantity??'미확인')+'</dd></div><div><dt>실입고 수량</dt><dd>'+delivery.actualQuantity+'</dd></div><div><dt>수량 부족</dt><dd>'+(delivery.expectedQuantity===null?'미확인':Math.max(0,delivery.expectedQuantity-delivery.actualQuantity))+'</dd></div><div><dt>선도 차감 요청 수량</dt><dd>'+item.requestedQuantity+'</dd></div><div><dt>업체 승인 수량</dt><dd>'+item.approvedQuantity+'</dd></div></dl>':'')+
    '<dl class="meta-grid"><div><dt>진단 결과</dt><dd>'+verdicts[d.verdict]+'</dd></div><div><dt>접수 구분</dt><dd>'+(item.manualReviewConfirmed?'추가 확인 · 사용자 선택':'AI 부적합')+'</dd></div><div><dt>등록 상태</dt><dd>'+esc(item.statusLabel)+'</dd></div><div class="wide"><dt>요청 번호</dt><dd>'+esc(item.id)+'</dd></div><div class="wide"><dt>접수 응답 번호</dt><dd>'+esc(item.acknowledgment||'없음 · 업체 미접수')+'</dd></div></dl>'+
    recognitionHTML(d)+confidenceHTML(d)+'<section class="decision-reason"><h3>판정 이유</h3><p>'+esc(d.reason)+'</p></section><details class="diagnosis-details"><summary>항목별 판정 근거</summary>'+assessmentsHTML(d)+'</details>'+
    (d.originalUrl?'<a class="evidence-link" href="'+esc(d.originalUrl)+'" target="_blank" rel="noreferrer">증빙사진 원본 보기</a>':'<p class="helper">이전 기록: 원본 없음 · 분석용 사본만 보존됨</p>')+
    '<details><summary>증빙 연결 정보</summary><p class="details-note">원본 SHA-256<br>'+esc(d.originalSha256)+'<br>기준 버전 '+esc(d.criteriaVersion||'이전 기준')+'<br>원본은 변경 없이 보존하며 분석·미리보기 사본만 크기를 조정합니다.</p></details>'+
    '<h3>처리 이력</h3><ol class="claim-events">'+(item.events||[]).map(e=>'<li><strong>'+esc(statusName(e.status))+'</strong> · '+esc(e.actor.replaceAll('모의 ',''))+'<small>'+formatTime(e.at)+'</small>'+esc(e.reason.replaceAll('모의 ','').replace(' · 실제 업체 전송 없음',''))+'</li>').join('')+'</ol>';
  if(item.status!=='legacy'&&item.status!=='deducted'){
    const controls=document.createElement('section');controls.className='claim-controls';
    controls.innerHTML='';
    const add=(label,fn)=>{const b=document.createElement('button');b.className='button';b.textContent=label;b.onclick=fn;controls.append(b);};
    if(unsent) {
      const expired=delivery.arrivalDate!==today;
      if(expired)controls.innerHTML+='<p class="reason">입고 D일이 지나 등록할 수 없습니다. 담당자에게 확인해 주세요.</p>';
      else {add('접수 재시도',()=>submitRecord(item,target));}
    } else {
      const label=document.createElement('label');label.textContent='처리 사유 (반려·분쟁·MD 회신 필수)';
      const input=document.createElement('input');input.maxLength=1000;input.placeholder='확인한 사유를 입력해 주세요';label.append(input);controls.append(label);
      const perform=async action=>{
        if(busy)return;setBusy(true);clearAlert();
        try{const updated=await post('/api/happycalls/'+item.id+'/simulate',{action,reason:input.value,expectedStatus:item.status});if(record?.id===item.id)record=updated;renderRecord(updated,target);}
        catch(error){showAlert(error.message);}
        finally{setBusy(false);await loadDeliveries();}
      };
      if(item.status==='vendor_review'){add('업체 승인',()=>perform('approve'));add('업체 반려',()=>perform('reject'));}
      if(item.status==='rejected')add('분쟁 등록 · MD 검토 요청',()=>perform('dispute'));
      if(item.status==='md_review')add('MD 회신 · 업체 재검토',()=>perform('md_return'));
      if(item.status==='approved')add('매입차감 완료',()=>perform('deduct'));
    }
    target.append(controls);
  }
  if(justRegistered){const b=document.createElement('button');b.className='button';b.textContent='접수 내역 확인';b.onclick=showHistory;target.append(b);}
  target.scrollIntoView({block:'start',behavior:'smooth'});updateFooter();
}
function statusName(status){return {pending:'미접수 · 전송 대기',failed:'미접수 · 전송 실패',vendor_review:'업체 검토 중',approved:'업체 승인',rejected:'업체 반려',md_review:'분쟁 · MD 검토 중',deducted:'매입차감 완료'}[status]||status;}
function presentRegistrationComplete(item){
  if(item.status!=='vendor_review'||!item.acknowledgment)return;
  $('registration-summary').textContent=item.diagnosis.productName+' · '+item.requestedQuantity+'개 접수가 완료되었습니다.';
  if(!$('registration-dialog').open)$('registration-dialog').showModal();
}


function showScan(){view='scan';$('scan-view').hidden=false;$('history-view').hidden=true;$('scan-tab').classList.add('active');$('history-tab').classList.remove('active');updateFooter();}
function showInspectionPage(page){
  inspectionPage=page;
  $('status-store').textContent=page==='home'?($('store-code').value||'점포 미입력'):'ST';
  $('home-summary').hidden=page!=='home';$('inspection-details').hidden=page!=='list';$('inspection-workspace').hidden=page!=='item';
  for(const key of ['total','pass','fail','review'])$('summary-'+key).setAttribute('aria-pressed',String(page!=='home'&&$('delivery-filter').value===key));
  $('reset-button').textContent=page==='home'?'↻ 현황 새로고침':'‹ 검수 현황';
  updateFooter();
}
function showOverview(){if(busy)return;clearAlert();showScan();showInspectionPage('home');$('app-scroll').scrollTo({top:0,behavior:'instant'});}
function openInspectionList(filter){
  if(busy)return;clearAlert();showScan();$('delivery-filter').value=filter;showInspectionPage('list');renderDeliveries();
  $('app-scroll').scrollTo({top:0,behavior:'instant'});$('detail-heading').focus({preventScroll:true});
}
async function showHistory(){
  if(busy)return;clearAlert();
  view='history';$('scan-view').hidden=true;$('history-view').hidden=false;$('history-tab').classList.add('active');$('scan-tab').classList.remove('active');$('record-detail').hidden=true;updateFooter();
  $('history-results').hidden=false;$('history-back').hidden=true;
  const request=++historyRequest;historyRecords=[];$('history-count').textContent='';
  const list=$('history-list');list.innerHTML='<p class="helper">접수 내역을 불러오는 중…</p>';
  $('history-results').setAttribute('aria-busy','true');
  try{const {records}=await api('/api/happycalls');if(request!==historyRequest)return;historyRecords=records;renderHistoryList();}
  catch(error){if(request!==historyRequest)return;list.replaceChildren();if(view==='history')showAlert(error.message,[['내역 다시 불러오기',showHistory]]);}
  finally{if(request===historyRequest)$('history-results').setAttribute('aria-busy','false');}
}
function renderHistoryList(){
  const rows=historyRecords.filter(item=>matchesClaim(item,{query:$('history-query').value,status:$('history-status').value}));
  $('record-detail').hidden=true;$('history-back').hidden=true;$('history-results').hidden=false;
  $('history-count').textContent='최근 '+historyRecords.length+'건 중 '+rows.length+'건';
  const list=$('history-list');list.replaceChildren();
  if(!rows.length)list.innerHTML='<div class="empty-state">'+(historyRecords.length?'검색 조건에 맞는 접수 내역이 없습니다.<br>검색어나 처리 상태를 바꿔 주세요.':'아직 접수 내역이 없습니다.<br>상품을 진단한 뒤 해피콜을 등록해 주세요.')+'</div>';
  for(const item of rows){
    const d=item.diagnosis,button=document.createElement('button');button.className='record-card';button.disabled=busy;
    button.innerHTML='<img src="'+esc(d.photoUrl)+'" alt=""><span><strong>'+esc(d.productName)+'</strong><small>'+esc(d.productCode)+'<br>'+formatTime(item.createdAt)+(Number.isSafeInteger(item.requestedQuantity)?' · 요청 '+item.requestedQuantity+'개':'')+'</small><b>'+esc(item.statusLabel)+'</b></span><span aria-hidden="true">›</span>';
    button.onclick=()=>openHistoryRecord(item.id);list.append(button);
  }
}
async function openHistoryRecord(id){
  if(busy)return;setBusy(true);clearAlert();
  try{renderRecord(await api('/api/happycalls/'+encodeURIComponent(id)),$('record-detail'));}
  catch(error){showAlert(error.message,[['상세 다시 불러오기',()=>openHistoryRecord(id)]]);}
  finally{setBusy(false);}
}
function reset(){if(busy)return;stopCamera();current=null;record=null;pending=null;workflow=null;clearAlert();$('result').hidden=true;$('capture-guide').hidden=false;showOverview();}
$('scan-button').onclick=()=>{if(view==='history'||inspectionPage!=='item'){startBarcodeScan();return;}if(record){if(['pending','failed'].includes(record.status))submitRecord(record,$('result'));else startBarcodeScan();return;}if(current?.verdict==='pass'){startBarcodeScan();return;}if(current?.verdict==='review'){openReviewChoice();return;}if(current?.verdict==='fail')openDefectQuantity();else startScan();};
$('home-button').onclick=showOverview;
$('scan-tab').onclick=showOverview;$('history-tab').onclick=showHistory;$('refresh-history').onclick=showHistory;$('reset-button').onclick=()=>{if(inspectionPage==='home'&&view==='scan'){loadDeliveries();loadStats();}else showOverview();};
$('upload-button').onclick=()=>startUpload(true);$('sample-fresh').onclick=()=>loadSample('fresh');$('sample-rotten').onclick=()=>loadSample('rotten');
$('cancel-camera').onclick=()=>{if(workflow)workflow.aux++;stopCamera();setBusy(false);};
$('camera-dialog').addEventListener('cancel',()=>{if(workflow)workflow.aux++;stopCamera();setBusy(false);});
$('retry-camera').onclick=()=>{action();try{setBusy(true);openCamera(cameraMode==='barcode'?null:getContext(),cameraMode);}catch(error){setBusy(false);showAlert(error.message);}};
$('camera-upload').onclick=()=>{stopCamera();setBusy(false);startUpload(false);};
$('take-photo').onclick=async()=>{
  if(!cameraReadyContext||!stream||$('take-photo').disabled)return;
  const context=cameraReadyContext,video=$('camera-video'),token=cameraToken;
  $('take-photo').disabled=true;$('camera-sample').disabled=true;workflow.aux++;
  try{
    $('camera-dialog').classList.add('counting-down');$('camera-message').textContent='잠시만 움직이지 마세요';$('camera-help').textContent='카운트다운 후 촬영합니다.';
    const ready=await captureCountdown({tick:n=>$('camera-symbol').textContent=String(n),isCurrent:()=>token===cameraToken&&!!stream&&$('camera-dialog').open});
    if(!ready)return;
    if(!video.videoWidth||!video.videoHeight||!stream.getVideoTracks().some(t=>t.readyState==='live'))throw Error('카메라 연결이 끊겼습니다. 다시 촬영해 주세요.');
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    const image=canvas.toDataURL('image/jpeg',.9);stopCamera();await diagnose(image,'camera',context);
  }catch(error){if(token!==cameraToken)return;stopCamera();setBusy(false);showAlert(error.message,[['다시 촬영',()=>startScan(false)]]);}
};
$('camera-sample').onclick=()=>{stopCamera();setBusy(false);loadSample('rotten',false);};
$('model-retry').onclick=async()=>{try{await post('/api/model/retry',{});await checkHealth();}catch(error){showAlert(error.message);}};
$('context-form').onsubmit=e=>e.preventDefault();
$('product-select').onchange=()=>{const d=deliveries.find(d=>d.arrivalDate===today&&d.productCode===$('product-select').value);if(d)chooseDelivery(d.id);else{selectProduct(selectedDelivery.productCode);showAlert('해당 상품은 목록 외 수기 검수 내역에서 입고일을 선택해 주세요.');}};
$('sample-peach').onclick=()=>loadSample('peach');$('sample-peach-moldy').onclick=()=>loadSample('peach-moldy');$('sample-watermelon').onclick=()=>loadSample('watermelon');
for(const id of ['store-code','product-code','product-type'])$(id).addEventListener('change',updateContext);
try{const previous=JSON.parse(localStorage.getItem('freshcheck-context'));if(previous&&typeof previous.storeCode==='string'&&typeof previous.productCode==='string'&&Object.hasOwn(names,previous.productType)){ $('store-code').value=previous.storeCode;$('product-code').value=previous.productCode;$('product-type').value=previous.productType;}}catch{}
function clockTick(){$('clock').textContent=new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:true});}
if($('store-code').value==='TEST001')$('store-code').value='GS2501';
$('refresh-deliveries').onclick=()=>{loadDeliveries();loadStats();};$('delivery-filter').onchange=()=>openInspectionList($('delivery-filter').value);$('save-quantity').onclick=confirmQuantity;
for(const key of ['total','pass','fail','review'])$('summary-'+key).onclick=()=>openInspectionList(key);
$('open-uninspected').onclick=()=>openInspectionList('uninspected');$('open-unregistered').onclick=()=>openInspectionList('unregistered');
$('open-attention').onclick=()=>openInspectionList('attention');
$('history-query').oninput=()=>{if(!busy)renderHistoryList();};$('history-status').onchange=()=>{if(!busy)renderHistoryList();};
$('history-clear').onclick=()=>{if(busy)return;$('history-query').value='';$('history-status').value='all';clearAlert();renderHistoryList();};
$('history-back').onclick=()=>{if(busy)return;clearAlert();renderHistoryList();$('app-scroll').scrollTo({top:0,behavior:'instant'});};
$('back-overview').onclick=showOverview;$('back-details').onclick=()=>openInspectionList($('delivery-filter').value);
$('registration-home').onclick=()=>{if(busy)return;$('registration-dialog').close();reset();};
$('registration-continue').onclick=()=>{if(busy)return;$('registration-dialog').close();reset();startBarcodeScan();};
showInspectionPage('home');
updateContext();clockTick();checkHealth();loadCatalog();loadStats();setInterval(clockTick,60000);setInterval(checkHealth,10000);
window.addEventListener('pagehide',stopCamera);
if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();
  try{Promise.resolve(document.modelContext.registerTool({name:'show_happycall_history',title:'해피콜 내역 보기',description:'이 기기의 접수 내역 화면을 엽니다. 새로운 접수를 만들지 않습니다.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},async execute(input){if(!input||typeof input!=='object'||Object.keys(input).length)throw Error('빈 객체를 입력해 주세요.');await showHistory();return {view:'history',integration:'local-mock'};}},{signal:lifecycle.signal})).catch(()=>{});}catch{}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}



async function loadDeliveries() {
  try {
    const data=await api('/api/deliveries');deliveries=data.deliveries;today=data.today;
    const updated=deliveries.find(d=>d.id===selectedDelivery?.id);
    if(updated)selectedDelivery=updated;
    else selectedDelivery=deliveries.find(d=>d.arrivalDate===today&&d.productCode===$('product-code').value)||deliveries.find(d=>d.arrivalDate===today);
    renderDeliveries();if(selectedDelivery)renderDeliveryDetail();
  }catch(error){showAlert(error.message,[['입고 다시 불러오기',loadDeliveries]]);}
}
function renderDeliveries() {
  const day=deliveries.filter(d=>d.arrivalDate===today),filter=$('delivery-filter').value;
  $('home-date').textContent=today+' · 입고 검수';
  $('home-uninspected').textContent=day.filter(d=>d.inspectionStatus==='uninspected').length;
  $('home-unregistered').textContent=day.filter(d=>d.unregistered).length;
  const attention=attentionDeliveries(deliveries,today);
  $('home-attention').textContent=attention.length+'건';
  $('home-attention-note').textContent=attention.length?'전송 실패 · 추가 확인 · 반려 등 후속 업무':'현재 이어서 조치할 건이 없습니다.';
  $('open-attention').classList.toggle('has-attention',attention.length>0);
  for(const key of ['total','pass','fail','review'])$('stat-'+key).textContent=day.filter(d=>key==='total'?d.inspectionStatus!=='uninspected':d.inspectionStatus===key).length;
  const rows=filter==='attention'?attention:deliveries.filter(d=>matchesInspection(d,filter,today));
  $('detail-heading').textContent=listTitles[filter];
  $('arrival-summary').textContent=(filter==='attention'?'오늘 접수할 건 우선 · 이전 입고 후속 업무 포함':filter==='expired'?'입고 당일이 지난 건':filter==='manual'?'실제 입고일 기준 · 수기 등록':today)+' · '+rows.length+'건'+(rows.length?' · 상품을 눌러 상세 확인':'');
  const list=$('delivery-list');list.replaceChildren();
  if(!rows.length)list.innerHTML='<div class="list-empty"><span aria-hidden="true">✓</span><p>'+esc(listTitles[filter])+'이 없습니다.</p><small>다른 현황을 선택하거나 새 검수를 시작하세요.</small></div>';
  for(const d of rows) {
    const button=document.createElement('button');button.className='delivery-button'+(d.id===selectedDelivery?.id?' selected':'');button.disabled=busy;
    button.innerHTML='<strong>'+esc(d.productName)+'</strong><small>전산 '+(d.expectedQuantity??'미확인')+' · 실입고 '+(d.actualQuantity??'미확인')+' · '+esc(verdicts[d.inspectionStatus])+'<br>'+esc(d.claimLabel||(d.unregistered?'부적합 · 미접수':d.arrivalDate))+(d.source==='manual'?' · 수기 검수':'')+(d.deadlineExpired?' · D일 경과':'')+'</small>';
    if(filter==='attention'){const task=followupForDelivery(d,today);button.innerHTML+='<span class="followup-label">'+esc(task.label)+'</span><small class="followup-next">'+esc(task.next)+'</small>';}
    button.onclick=()=>chooseDelivery(d.id);list.append(button);
  }
}
function renderDeliveryDetail() {
  const d=selectedDelivery;if(!d)return;
  $('selected-product-heading').textContent=d.productName;
  selectProduct(d.productCode);$('store-code').value=d.storeCode;$('store-code').readOnly=true;updateContext();
  $('delivery-reference').textContent=d.arrivalDate+' · '+(d.source==='manual'?'목록 외 수기 검수 · '+(d.linkedDeliveryId?'기존 입고정보 참조':'전산 입고내역 없음'):d.arrivalReference+' · '+d.supplierName+' (예시)');
  $('expected-quantity').value=d.expectedQuantity??'';$('expected-quantity').placeholder='미확인';$('actual-quantity').value=d.actualQuantity??'';
  $('actual-quantity').disabled=busy||!!d.claimId||(d.deadlineExpired&&d.source!=='manual');
  $('save-quantity').disabled=$('actual-quantity').disabled;
  $('quantity-status').textContent=(d.deadlineExpired?'D일 경과 · 선도 진단 가능 / 해피콜 등록 제한. ':'')+(d.actualQuantity===null?'실입고 수량을 직접 확인해 주세요.':'실입고 '+d.actualQuantity+' · 수량 부족 '+(d.shortageQuantity??'미확인')+' · 선도 차감 요청 '+d.requestedQuantity);
}
async function chooseDelivery(id,{fresh=false}={}) {
  if(busy)return;selectedDelivery=deliveries.find(d=>d.id===id);current=null;record=null;pending=null;workflow=null;defectQuantity=null;manualReviewConfirmed=false;
  $('item-setup').hidden=false;
  showInspectionPage('item');$('app-scroll').scrollTo({top:0,behavior:'instant'});$('selected-product-heading').focus({preventScroll:true});
  $('result').hidden=true;$('capture-guide').hidden=false;clearAlert();renderDeliveries();renderDeliveryDetail();updateFooter();
  const chosen=selectedDelivery;
  setBusy(true);
  try{
    if(chosen.claimId){const saved=await api('/api/happycalls/'+chosen.claimId);if(selectedDelivery.id!==id)return;record=saved;current=saved.diagnosis;$('capture-guide').hidden=true;renderRecord(saved,$('result'));}
    else if(chosen.diagnosisId&&!fresh){const saved=await api('/api/diagnoses/'+chosen.diagnosisId);if(selectedDelivery.id!==id)return;current=saved;renderDiagnosis(saved,null);}
  }catch(error){showAlert(error.message);}finally{setBusy(false);renderDeliveryDetail();}
}
async function confirmQuantity() {
  if(busy||!selectedDelivery)return;
  if($('actual-quantity').value==='')return showAlert('실입고 수량을 입력해 주세요.');
  setBusy(true);
  try {await post('/api/deliveries/'+encodeURIComponent(selectedDelivery.id)+'/quantity',{actualQuantity:Number($('actual-quantity').value)});
    current=null;record=null;$('result').hidden=true;$('capture-guide').hidden=false;clearAlert();await loadDeliveries();await loadStats();
  }catch(error){showAlert(error.message,[['수량 저장 재시도',confirmQuantity]]);}
  finally{setBusy(false);renderDeliveryDetail();}
}



function startBarcodeScan(){
  if(busy)return;
  clearAlert();$('barcode-value').value='';showScan();setBusy(true);openCamera(null,'barcode');
}
function barcodeError(message){$('barcode-error').textContent=message;$('barcode-error').hidden=false;}
async function acceptBarcode(code,token=cameraToken,{manual=false,demo=false}={}){
  if(barcodeMatching||token!==cameraToken||!$('camera-dialog').open)return;
  barcodeMatching=true;
  try{
    const data=demo?await post('/api/deliveries/demo',{}):await api('/api/deliveries');
    if(token!==cameraToken||!$('camera-dialog').open)return;
    if(demo)code=DEMO_SCAN_PRODUCT.code;
    const delivery=findBarcodeDelivery(code,data.deliveries,data.today,{allowMissing:manual});
    if(!delivery){today=data.today;stopCamera();setBusy(false);openManualEntry(String(code).trim());return;}
    deliveries=data.deliveries;today=data.today;stopCamera();setBusy(false);
    $('delivery-filter').value='today';await chooseDelivery(delivery.id,{fresh:true});
    if(!delivery.claimId)$('actual-quantity').focus({preventScroll:true});
  }catch(error){if(token===cameraToken)barcodeError(error.message);}
  finally{if(token===cameraToken)barcodeMatching=false;}
}
$('barcode-form').onsubmit=e=>{e.preventDefault();acceptBarcode($('barcode-value').value,cameraToken,{manual:true});};
$('barcode-upload').onclick=()=>{$('barcode-file').value='';$('barcode-file').click();};
$('barcode-file').onchange=async e=>{
  const file=e.target.files?.[0],token=cameraToken;if(!file)return;
  if(file.size>6*1024*1024)return barcodeError('바코드 사진은 6MB 이하로 선택해 주세요.');
  let url;
  try{const reader=createBarcodeReader();url=URL.createObjectURL(file);const image=new Image();image.src=url;await image.decode();if(token!==cameraToken)return;const result=reader.decode(image);await acceptBarcode(result.getText(),token);reader.reset();}
  catch{if(token===cameraToken)barcodeError('사진에서 바코드를 읽지 못했습니다. 바코드 전체가 선명하게 보이는 사진을 선택하거나 직접 입력해 주세요.');}
  finally{if(url)URL.revokeObjectURL(url);}
};
function openDefectQuantity(){
  if(busy||!['fail','review'].includes(current?.verdict)||record)return;
  if(current.delivery.arrivalDate!==today)return showAlert('입고 당일(D일)이 지나 해피콜은 등록할 수 없습니다. 선도 진단 결과는 저장되어 있습니다.');
  if(current.verdict==='review'&&!manualReviewConfirmed)return openReviewChoice();
  $('defect-product').textContent=current.productName+' · '+current.productCode;
  $('defect-actual').textContent=current.delivery.actualQuantity+'개';
  $('defect-quantity').max=current.delivery.actualQuantity;$('defect-quantity').value=defectQuantity??'';
  $('defect-error').hidden=true;$('defect-dialog').showModal();$('defect-quantity').focus();
}
$('defect-cancel').onclick=()=>$('defect-dialog').close();
for(const [id,step] of [['defect-minus',-1],['defect-plus',1]])$(id).onclick=()=>{
  const field=$('defect-quantity');field.value=Math.max(1,Math.min(Number(field.max),(Number(field.value)||0)+step));
};
$('defect-form').onsubmit=e=>{
  e.preventDefault();if(busy)return;
  try{defectQuantity=validateDefectQuantity($('defect-quantity').value,current.delivery.actualQuantity);$('defect-dialog').close();register();}
  catch(error){$('defect-error').textContent=error.message;$('defect-error').hidden=false;}
};
function openReviewChoice(){
  if(busy||current?.verdict!=='review'||record)return;
  $('review-choice-product').textContent=current.productName;
  $('review-choice-product').nextElementSibling.textContent=current.productType==='banana'&&current.identity?.matched?
    (current.reviewCause==='obstructed'?'바나나는 인식했습니다. 포장 반사·라벨 가림 때문에 선도를 확인하기 어렵습니다. 다른 각도로 다시 촬영하거나 실물을 확인한 뒤 접수를 선택해 주세요.':'바나나는 인식했습니다. 손상 여부의 근거가 충분하지 않아 추가 확인이 필요합니다. 다시 촬영하거나 실물을 확인한 뒤 접수를 선택해 주세요.'):
    '사진만으로 선도를 확정하기 어렵습니다. 다시 촬영하거나 현장에서 확인한 상품을 해피콜로 접수할 수 있습니다.';
  if(!$('review-choice-dialog').open)$('review-choice-dialog').showModal();
}
$('review-retake').onclick=()=>{$('review-choice-dialog').close();manualReviewConfirmed=false;startScan(false);};
$('review-register').onclick=()=>{$('review-choice-dialog').close();manualReviewConfirmed=true;openDefectQuantity();};
$('review-close').onclick=()=>$('review-choice-dialog').close();

function openManualEntry(code){
  if(!/^\d{8,14}$/.test(code))return barcodeError('바코드 숫자 8~14자리를 입력해 주세요.');
  const known=products.find(p=>p.code===code);
  $('manual-code').value=code;$('manual-name').value=known?.name||'';$('manual-name').readOnly=!!known;
  $('manual-type').value=known?.type||'';$('manual-type').disabled=!!known;
  $('manual-arrival').value='';$('manual-arrival').max=today;$('manual-error').hidden=true;
  $('manual-entry-dialog').showModal();(known?$('manual-arrival'):$('manual-name')).focus();
}
function setupManualEntry(){
  $('delivery-filter').append(new Option('목록 외 수기 검수','manual'));
  const history=document.createElement('button');history.className='text-button';history.textContent='목록 외 수기 검수 내역';history.onclick=()=>openInspectionList('manual');$('home-summary').append(history);
  const add=document.createElement('button');add.className='text-button light';add.textContent='다른 입고일 · 목록 외 상품 검수';add.onclick=()=>{
    const code=$('barcode-value').value.trim();if(!/^\d{8,14}$/.test(code))return barcodeError('검수할 상품의 바코드를 먼저 입력해 주세요.');
    stopCamera();setBusy(false);openManualEntry(code);
  };$('barcode-controls').append(add);
  const dialog=document.createElement('dialog');dialog.id='manual-entry-dialog';dialog.className='completion-dialog manual-entry-dialog';dialog.setAttribute('aria-labelledby','manual-title');
  dialog.innerHTML='<form id="manual-entry-form"><h2 id="manual-title">목록 외 상품 검수</h2><p>상품정보와 실제 입고일을 확인해 주세요.</p><label for="manual-code">상품 바코드</label><input id="manual-code" readonly><label for="manual-name">상품명</label><input id="manual-name" maxlength="120" required placeholder="실물에 표시된 상품명"><label for="manual-type">선도 진단 품목</label><select id="manual-type" required><option value="">품목 선택</option><option value="banana">바나나</option><option value="peach">복숭아</option><option value="watermelon">수박</option></select><label for="manual-arrival">실제 입고일</label><input id="manual-arrival" type="date" required><p class="helper">전산 입고내역이 없으면 수량은 미확인으로 표시됩니다. 이전 입고 상품도 진단할 수 있으며, 해피콜은 입고 당일에만 등록할 수 있습니다.</p><p id="manual-error" role="alert" hidden></p><div class="completion-actions"><button id="manual-submit" class="button blue" type="submit">상품정보 저장 · 수량 확인</button><button id="manual-cancel" class="button" type="button">취소</button></div></form>';
  document.body.append(dialog);
  let saving=false;
  dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault();});$('manual-cancel').onclick=()=>dialog.close();
  $('manual-entry-form').onsubmit=async e=>{
    e.preventDefault();if(saving)return;saving=true;setBusy(true);$('manual-error').hidden=true;$('manual-submit').disabled=true;$('manual-cancel').disabled=true;
    try{
      const saved=await post('/api/deliveries/manual',{productCode:$('manual-code').value,productName:$('manual-name').value,productType:$('manual-type').value,arrivalDate:$('manual-arrival').value});
      await loadCatalog();if(!catalogReady||!deliveries.some(d=>d.id===saved.id))throw Error('상품정보는 저장되었으나 화면을 불러오지 못했습니다. 다시 시도해 주세요.');
      dialog.close();setBusy(false);showScan();$('delivery-filter').value=saved.source==='manual'?'manual':'today';await chooseDelivery(saved.id,{fresh:true});
      if(!saved.claimId)$('actual-quantity').focus({preventScroll:true});
    }catch(error){$('manual-error').textContent=error.message;$('manual-error').hidden=false;}
    finally{saving=false;setBusy(false);$('manual-submit').disabled=false;$('manual-cancel').disabled=false;if(selectedDelivery)renderDeliveryDetail();}
  };
}
setupManualEntry();

// The demo barcode step uses a catalog example; freshness diagnosis still analyzes a real photograph.
const barcodeAction=document.createElement('div');barcodeAction.id='barcode-action';barcodeAction.className='barcode-primary-action';barcodeAction.hidden=true;
barcodeAction.innerHTML='<button id="scan-barcode" class="shutter-button" type="button"><span aria-hidden="true">⌗</span> 스캔하기</button><p>예시 · '+DEMO_SCAN_PRODUCT.name+'</p>';
$('camera-dialog').append(barcodeAction);
$('scan-barcode').onclick=async()=>{
  if(barcodeMatching||cameraMode!=='barcode')return;
  $('scan-barcode').disabled=true;
  try{const code=$('barcode-value').value.trim();await acceptBarcode(code,cameraToken,{manual:!!code,demo:!code});}
  finally{$('scan-barcode').disabled=false;}
};
