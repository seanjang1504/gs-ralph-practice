import {CATEGORIES,PROFILES,SOURCES,COMMON,REFERENCE_VERSION,REFERENCE_DATE,referenceDataset} from './freshness-data.js';
const $=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initial=PROFILES.find(p=>p.id===location.hash.slice(1));let category=initial?.category||'meat';
const list=items=>'<ul>'+items.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>';
const sourceLinks=ids=>'<div class="sources">'+ids.map(id=>'<a target="_blank" rel="noreferrer" href="'+esc(SOURCES[id].url)+'">'+esc(SOURCES[id].title)+'</a>').join('')+'</div>';
for(const c of CATEGORIES){const button=document.createElement('button');button.textContent=c.name;button.dataset.category=c.id;button.onclick=()=>{category=c.id;$('query').value='';render();};$('categories').append(button);}
function render(){
  const q=$('query').value.trim();document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===category)));
  const rows=PROFILES.filter(p=>(q||p.category===category)&&(!q||[p.name,p.scope].some(s=>s.includes(q))));
  $('count').textContent=(q?'전체 분류 검색':CATEGORIES.find(c=>c.id===category).name)+' · '+rows.length+'개 기준';
  $('profiles').innerHTML=rows.map(p=>'<details class="profile" id="profile-'+p.id+'"'+(initial?.id===p.id?' open':'')+'><summary><strong>'+esc(p.name)+'</strong><span class="badge '+(p.productType?'active':'')+'">'+(p.productType?'기존 AI 외관 분석 연결':'현장 검수 참고 · AI 분석 미지원')+'</span></summary><div class="body"><p class="scope">'+esc(p.scope)+'</p><h3>사진에서 확인</h3>'+list(p.visible)+'<h3>현장에서 별도 확인</h3>'+list(p.field)+'<div class="exceptions"><strong>오판하지 않도록</strong>'+list(p.exceptions)+'</div><h3>촬영할 때</h3><p>'+esc(p.photo)+'</p><h3>근거 자료</h3>'+sourceLinks(p.sources)+'</div></details>').join('')||'<p class="empty">일치하는 기준이 없습니다. 다른 품목명을 입력하세요.</p>';
}
$('query').addEventListener('input',render);
$('common').innerHTML='<h3>사진 확인</h3>'+list(COMMON.photoChecks)+'<h3>실물·기록 확인</h3>'+list(COMMON.fieldChecks)+'<h3>판정 범위</h3>'+list([COMMON.decisionPolicy.pass,COMMON.decisionPolicy.fail,COMMON.decisionPolicy.review,...COMMON.limitations]);
$('provenance').innerHTML='<p>'+esc(REFERENCE_VERSION)+'<br>자료 확인일 '+REFERENCE_DATE+' · 대표 품목군 '+PROFILES.length+'개</p><p>공개 유통사 운영 원칙과 USDA·FDA·UC Davis 자료의 관찰 항목을 참고해 작성했습니다. GS가 승인한 품목별 허용치·온도·잔여 판매기간 수치가 아니며 모델 가중치를 재학습하지 않았습니다. 전체 취급 품목을 망라하지 않습니다.</p>'+Object.keys(SOURCES).map(id=>sourceLinks([id])+'<p>'+esc(SOURCES[id].scope)+'</p>').join('');
$('download').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(referenceDataset(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=REFERENCE_VERSION+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
render();
