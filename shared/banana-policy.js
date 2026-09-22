import {combineEvidence} from './catalog.js';

// Equal numbers of descriptions per category avoid giving bananas more softmax mass
// simply because packaged/bunched examples have been added. These are prompts, not training data.
export const BANANA_IDENTITY_LABELS={
  banana:['a banana','a bunch of bananas','bananas inside a clear plastic bag'],
  peach:['a peach','a group of peaches','peaches inside a clear plastic bag'],
  watermelon:['a watermelon','a group of watermelons','a watermelon wrapped in clear plastic'],
  apple:['an apple','a group of apples','apples inside a clear plastic bag'],
  person:['a person','a person holding a phone','a person sitting in a room'],
  room:['an empty room','a ceiling with lights','a table in an office'],
  other:['a non-food object','a plastic bag without fruit','a printed fruit label without fruit']
};
export const BANANA_VISIBILITY=[
  {key:'clear',label:'clearly visible banana peels ready for inspection'},
  {key:'obstructed',label:'bananas obscured by a plastic bag with glare and a large label'},
  {key:'blurred',label:'a dark blurry picture of bananas'}
];
export const BANANA_RIPENESS=[
  {key:'green',label:'후숙 전 · 초록색',prompt:'unripe green bananas'},
  {key:'turning',label:'후숙 중 · 녹황색',prompt:'yellow green bananas with green tips'},
  {key:'yellow',label:'후숙 · 노란색',prompt:'ripe yellow bananas'},
  {key:'speckled',label:'후숙 진행 · 작은 갈색 반점',prompt:'ripe yellow bananas with small brown sugar spots'},
  {key:'dark',label:'넓은 갈변·검변 · 상태 확인',prompt:'overripe bananas with mostly brown or black peels'}
];
function validateScores(scores,labels){
  if(!Array.isArray(scores)||scores.length!==labels.length||new Set(scores.map(s=>s.label)).size!==labels.length||
    !scores.every(s=>labels.includes(s.label)&&Number.isFinite(s.score)&&s.score>=0&&s.score<=1))throw Error('Invalid banana evidence');
  return [...scores].sort((a,b)=>b.score-a.score);
}
export function bananaIdentity(scores){
  validateScores(scores,Object.values(BANANA_IDENTITY_LABELS).flat());
  const groups=Object.entries(BANANA_IDENTITY_LABELS).map(([kind,labels])=>({kind,score:scores.filter(s=>labels.includes(s.label)).reduce((sum,s)=>sum+s.score,0)})).sort((a,b)=>b.score-a.score);
  const top=groups[0],score=groups.find(s=>s.kind==='banana').score;
  return {matched:top.kind==='banana'&&score>=.50&&score-groups[1].score>=.08,score,label:top.kind,groups,method:'balanced-category-prompts'};
}
export function bananaDecision({scores,assessments,identity,visibilityScores,ripenessScores}){
  if(!identity.matched)return {verdict:'review',reason:'사진에서 바나나를 확인하지 못했습니다. 바나나 전체가 화면 중앙을 크게 채우도록 다시 촬영해 주세요.',reviewCause:'identity',bananaInspection:{recognition:'unconfirmed'}};
  const visibility=validateScores(visibilityScores,BANANA_VISIBILITY.map(s=>s.label));
  const top=visibility[0],visibilityKey=BANANA_VISIBILITY.find(s=>s.label===top.label).key;
  const obstructed=visibilityKey!=='clear'&&top.score>=.75&&top.score-visibility[1].score>=.25;
  const ripeness=validateScores(ripenessScores,BANANA_RIPENESS.map(s=>s.prompt));
  const ripeTop=ripeness[0],estimated=!obstructed&&ripeTop.score>=.60&&ripeTop.score-ripeness[1].score>=.15;
  const stage=BANANA_RIPENESS.find(s=>s.prompt===ripeTop.label);
  const bananaInspection={recognition:'matched',visibility:{status:obstructed?visibilityKey:'not_flagged',score:top.score,scores:visibility},
    ripeness:{estimated,key:estimated?stage.key:'uncertain',label:estimated?stage.label:'사진만으로 숙도 구분 어려움',score:estimated?ripeTop.score:null,scores:ripeness},
    policy:'공개 유통 자료 기반 참고 기준 · GS 공식 입고/반품 기준 아님'};
  if(obstructed)return {verdict:'review',reviewCause:visibilityKey,bananaInspection,confidence:{score:top.score,basis:'visibility'},
    reason:visibilityKey==='obstructed'?'바나나로 인식했습니다. 포장 비닐 반사·라벨·가림 때문에 껍질 상태를 확인하기 어렵습니다. 반사를 피해 각도를 바꾸고 라벨이 가리지 않는 면과 꼭지를 다시 촬영해 주세요. 포장 자체를 불량으로 판단한 것은 아닙니다.':'바나나로 인식했으나 사진이 어둡거나 흐려 손상 유무를 확인하기 어렵습니다. 밝은 곳에서 초점을 맞춘 뒤 다시 촬영해 주세요.'};
  const decision=combineEvidence(scores,assessments,true);
  // Ripeness alone never proves decay or suitability for this store's receiving standard.
  if(estimated&&stage.key==='dark'&&decision.verdict!=='fail')return {verdict:'review',reviewCause:'ripeness',bananaInspection,reason:'바나나로 인식했습니다. 넓은 갈변·검변 외관은 과숙·저온장해·손상을 구분해 확인해야 합니다. 색상만으로 부패를 확정하지 않으며, 꼭지와 껍질 손상·누액 및 점포 입고 허용 기준을 확인해 주세요.'};
  const note=estimated&&stage.key==='speckled'?' 작은 갈색 반점은 후숙 특징일 수 있어 반점만으로 부적합 처리하지 않습니다.':estimated&&['green','turning'].includes(stage.key)?' 녹색이 남은 후숙 단계는 부패와 별개이며 점포의 입고 숙도 기준을 확인해 주세요.':'';
  return {...decision,reviewCause:decision.verdict==='review'?'evidence':null,bananaInspection,
    reason:(decision.verdict==='review'?'바나나로 인식했습니다. 숙도 색상과 별개로 곰팡이·껍질 손상·심한 함몰 여부를 일관되게 판단할 근거가 부족합니다. 꼭지와 표면을 밝고 선명하게 다시 촬영하거나 담당자에게 확인해 주세요.':'바나나로 인식했습니다. '+decision.reason)+note};
}
