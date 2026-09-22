export const CATALOG = [
  {code:'8809153478085',name:'델)프레시윅바나나(3~5입/봉)',type:'banana',package:'3~5입/봉',manualCheck:'봉당 3~5입 및 포장 상태는 현장에서 확인해 주세요.'},
  {code:'2345001827927',name:'F)부드러운복숭아(4~6입/팩)',type:'peach',package:'4~6입/팩',manualCheck:'팩당 4~6입과 실제 눌림·경도는 현장에서 확인해 주세요.'},
  {code:'2800024017590',name:'고당도수박6kg상(1입/박스)',type:'watermelon',package:'6kg 이상 · 1입/박스',manualCheck:'6kg 이상 여부는 저울, 당도는 당도계로 별도 확인해 주세요.'},
  {code:'8809153476197',name:'델몬트)클래식바나나2입',type:'banana',package:'2입',manualCheck:'2입 구성과 포장 상태는 현장에서 확인해 주세요.'}
];
export const RULE_VERSION='appearance-2026-09-v3-banana-retail';
export const CRITERIA = {
  banana:{title:'바나나 유통 외관 참고 기준',source:'https://postharvest.ucdavis.edu/produce-facts-sheets/banana',normal:'후숙 전 녹색부터 노란색·작은 갈색 반점까지 숙도와 손상을 구분합니다. 껍질·꼭지에 뚜렷한 곰팡이·부패·누액·심한 함몰이 없는지 확인합니다.',caution:'작은 갈색 반점(슈가 스팟)·가벼운 마찰 자국·녹색만으로 부적합 처리하지 않습니다. 넓은 검변은 과숙·저온장해·손상을 구분해 추가 확인합니다. 반사·라벨로 표면이 가리면 재촬영합니다. GS 공식 입고·반품 기준은 별도 확인이 필요합니다.',unobservable:'과육 내부, 냄새, 실제 경도, 당도, 남은 판매 가능 일수, 포장 속 가려진 면',
    sources:[{title:'UC Davis · 바나나 수확 후 품질',url:'https://postharvest.ucdavis.edu/produce-facts-sheets/banana'},{title:'Chiquita · 유통 매장 품질 관리',url:'https://chiquitabrands.com/wp-content/uploads/2020/09/Chiquita-Whitepaper-Quality-on-Shelf.pdf'},{title:'컬리 · 후숙·반점 상품 안내',url:'https://www.kurly.com/goods/1000384279'}],
    ripenessGuide:'녹색: 후숙 전 / 녹황색: 후숙 중 / 노란색: 후숙 / 작은 갈색 반점: 후숙 진행 / 넓은 갈변·검변: 상태 확인. 숙도만으로 적합·부적합을 확정하지 않습니다.',rules:[
    {key:'decay',name:'곰팡이·부패',normal:'bananas with clean peel and no mold or visible rot',defect:'rotten bananas covered with fuzzy mold and decaying areas'},
    {key:'skin',name:'껍질 손상·누액',normal:'whole bananas with intact unbroken peel',defect:'damaged bananas with split open torn peel and leaking pulp'},
    {key:'collapse',name:'심한 함몰·변형',normal:'fresh plump bananas holding their normal shape',defect:'severely damaged bananas with collapsed shriveled skin and large rotten black patches'},
    {key:'crown',name:'꼭지·절단면 부패',normal:'a healthy banana stem',defect:'a moldy rotting banana stem',unclear:'a banana stem hidden from view'}
  ]},
  peach:{title:'복숭아 외관 기준',source:'https://postharvest.ucdavis.edu/produce-facts-sheets/peach',normal:'표면과 형태가 온전하고 뚜렷한 곰팡이·상처·짓무름이 없음',caution:'품종별 색상과 자연스러운 잔털은 결함으로 단정하지 않습니다. 연한 품종의 정상 숙도와 압상은 사진만으로 구분이 어려울 수 있습니다.',unobservable:'내부 갈변, 실제 연도·경도, 향, 당도, 팩 바닥면',rules:[
    {key:'decay',name:'곰팡이·부패',normal:'fresh peaches with clean natural fuzzy skin and no mold',defect:'rotten peaches with mold colonies and brown decaying patches'},
    {key:'skin',name:'상처·갈라짐·누액',normal:'whole fresh peaches with intact unbroken skin',defect:'damaged peaches with torn split skin and leaking juice'},
    {key:'collapse',name:'압상·짓무름',normal:'plump peaches with normal round shape and undamaged surface',defect:'badly bruised peaches with sunken crushed brown areas and collapsed flesh'}
  ]},
  watermelon:{title:'통수박 외관 기준',source:'https://postharvest.ucdavis.edu/produce-facts-sheets/watermelon',normal:'과피와 형태가 온전하고 균열·누액·뚜렷한 부패 병반이 없음',caution:'줄무늬와 바닥의 노란 착색만으로 부적합 처리하지 않습니다. 외관 적합은 고당도 또는 내부 적합 판정이 아닙니다.',unobservable:'당도·6kg 중량·내부 공동·내부 과육 손상·냄새',rules:[
    {key:'decay',name:'표면 부패·병반',normal:'a whole watermelon with clean healthy green rind and normal yellow ground spot',defect:'a rotten whole watermelon with mold and sunken decaying lesions on the rind'},
    {key:'skin',name:'균열·누액',normal:'a whole uncut watermelon with intact unbroken rind',defect:'a damaged whole watermelon with deep cracks and leaking juice'},
    {key:'collapse',name:'심한 함몰·외상',normal:'a whole watermelon with a regular shape and undamaged smooth rind',defect:'a severely damaged watermelon with large sunken bruises and crushed rind'}
  ]}
};
export function findProduct(code){return CATALOG.find(product=>product.code===code);}
export function summarizeCriteria(assessments){
  const defect=assessments.find(a=>a.status==='defect');
  if(defect)return {verdict:'fail',reason:`‘${defect.name}’ 항목에서 손상 외관 설명과의 높은 일치가 확인되었습니다. 실물을 함께 확인해 주세요.`};
  if(assessments.every(a=>a.status==='normal'))return {verdict:'pass',reason:'촬영된 면에서 곰팡이·표면 손상·심한 변형 항목이 정상 외관 설명에 가깝게 분류되었습니다.'};
  return {verdict:'review',reason:'일부 외관 항목을 명확하게 구분하지 못했습니다. 다른 각도에서 다시 촬영하거나 담당자에게 확인해 주세요.'};
}
// Relative text/image matches are provisional assistance, never calibrated defect probabilities.
export function combineEvidence(overall, assessments, identityMatched) {
  if(!identityMatched)return {verdict:'review',reason:'선택한 상품과 사진이 일치하는지 확인하기 어렵습니다. 해당 상품 전체를 다시 촬영해 주세요.'};
  const ranked=[...overall].sort((a,b)=>b.score-a.score),top=ranked[0];
  if(!top||ranked.length<2||!ranked.every(s=>Number.isFinite(s.score)&&s.score>=0&&s.score<=1))throw Error('Invalid scores');
  const strong=top.score>=.60&&top.score-ranked[1].score>=.15;
  const defect=assessments.find(a=>a.status==='defect');
  if(strong&&top.kind==='fail'&&defect)return {verdict:'fail',reason:'전체 사진이 부패·손상 외관 설명에 가깝고, ‘'+defect.name+'’ 항목에서도 손상 설명과 높은 일치가 확인되었습니다. 실물을 함께 확인해 주세요.'};
  if(strong&&top.kind==='pass'&&!defect)return {verdict:'pass',reason:'촬영된 면의 전체 외관이 정상 상품 설명에 더 가깝습니다. 항목별 추가 확인 사항과 보이지 않는 면은 현장에서 확인해 주세요.'};
  return {verdict:'review',reason:'전체 외관과 세부 항목을 일관되게 판단하기 어렵습니다. 다른 각도에서 재촬영하거나 담당자에게 확인해 주세요.'};
}
export function evaluateCriterion(rule,output){
  const sorted=[...output].sort((a,b)=>b.score-a.score),top=sorted[0],gap=top.score-sorted[1].score;
  const status=top.label===rule.defect&&top.score>=.80&&gap>=.30?'defect':top.label===rule.normal&&top.score>=.65&&gap>=.15?'normal':'uncertain';
  return {key:rule.key,name:rule.name,status,normalScore:output.find(o=>o.label===rule.normal)?.score??0,defectScore:output.find(o=>o.label===rule.defect)?.score??0,uncertainScore:output.find(o=>o.label===rule.unclear)?.score??0,topScore:top.score,gap};
}
