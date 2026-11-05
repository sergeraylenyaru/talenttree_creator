import {glyph,initUI,notify,notificationUser,closeMenus} from './ui.js';
import {publicationRow} from './publication-view.js';
import {createRankEditor} from './rank-editor.js';
import {blank,branch,total,validBuild,changeRank,normalize,route,reserved,moveTalent,defaultBudget,abilityTalentDraft,placeAbilityTalent,synchronizeAbilityTalents,abilityUnlocked,removeAbility,dependencyRoutes,talentState,branchIcon,groupedAbilities} from './engine.js';
import {icons,iconURL} from './icons.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let doc=blank(), projectId=null, user=null, mode='play', modalSave=null, modalDelete=null, dirty=false,modalCancel=null,abilityView='icons';
try { const draft=JSON.parse(localStorage.getItem('talentforge-draft')); if(draft) doc=normalize(draft,{allowLegacy:true}); } catch {}
function toast(message) { notify(message); $('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,4200); }
function changed() { synchronizeAbilityTalents(doc);remember();dirty=true;$('#saveState').textContent='Есть несохранённые изменения';try{localStorage.setItem('talentforge-draft',JSON.stringify(doc));}catch{toast('Браузер не сохранил черновик. Экспортируй класс в JSON.');} }
async function api(path, data, method) {
 const options={method:method||(data?'POST':'GET'),headers:{'Content-Type':'application/json'}};
 if(data) options.body=JSON.stringify(data);
 const response=await fetch('/api'+path,options);
 const result=await response.json();if(!response.ok) throw Error(result.error||'Ошибка сервера');return result;
}
function image(id,extra='') { return `<img src="${esc(iconURL(id))||'missing-icon'}" alt="" loading="lazy" draggable="false" ${extra}>`; }
document.addEventListener('error',e=>{if(e.target.tagName==='IMG'){e.target.style.visibility='hidden';e.target.alt='Иконка недоступна';}},true);
function showWorkspace(){closeMenus();$('#library').hidden=true;$('#community').hidden=true;$('.workspace').hidden=false;document.body.dataset.view='editor';}
function render() {
 synchronizeAbilityTalents(doc);renderCharacter();updateHistoryButtons();if(!activeShare){$('#shareStats').hidden=true;$('#publicationBar').hidden=true;}
 $('#trees').style.setProperty('--tree-count',Math.min(4,doc.branches.length));
 $('#className').value=doc.name;$('#budget').value=doc.budget;$('#rowCost').value=doc.rowCost;
 $('#points').textContent=`${total(doc)} / ${doc.budget}`;
 const track=$('.budget-track');track.setAttribute('aria-valuemax',doc.budget);track.setAttribute('aria-valuenow',total(doc));track.firstElementChild.style.width=`${doc.budget?Math.min(100,total(doc)/doc.budget*100):0}%`;
 updateNavigation();updateTreeControls();
 for(const id of ['className','budget','rowCost']) $('#'+id).disabled=mode!=='edit';
 $('#editMode').classList.toggle('selected',mode==='edit');$('#playMode').classList.toggle('selected',mode==='play');$('#editMode').setAttribute('aria-pressed',String(mode==='edit'));$('#playMode').setAttribute('aria-pressed',String(mode==='play'));
 $('#addBranch').hidden=mode!=='edit';$('#addBranch').disabled=doc.branches.length>=4;$('#addAbility').hidden=mode!=='edit';
 $('#hint').textContent=doc.branches.length>4?'В старом классе пять веток. Удали лишнюю перед сохранением; данные пока сохранены.':mode==='edit'?'Нажми на пустую ячейку, чтобы создать талант.':'Левая кнопка: +1 очко · Правая кнопка: −1 · Shift + клик: −1';
 $('#trees').innerHTML=doc.branches.map(b=>`<article class="tree" data-branch="${esc(b.id)}"><div class="tree-header"><button class="branch-icon-button" data-action="branch-icon" title="Выбрать иконку ветки" aria-label="Иконка ветки ${esc(b.name)}" ${mode!=='edit'?'disabled':''}>${image(branchIcon(b))}</button><input aria-label="Название ветки" value="${esc(b.name)}" maxlength="80" ${mode!=='edit'?'disabled':''}><span>${b.talents.reduce((s,t)=>s+(doc.build[t.id]||0),0)} очк.</span>${mode==='edit'?'<button data-action="delete-branch" aria-label="Удалить ветку">×</button>':''}</div><div class="talent-grid">${Array.from({length:b.rows*4},(_,i)=>{
 const row=Math.floor(i/4),col=i%4,t=b.talents.find(t=>t.row===row&&t.col===col);
 if(!t) return `<button class="slot ${mode==='play'?'empty-slot':''}" data-row="${row}" data-col="${col}" aria-label="Создать талант: ряд ${row+1}, столбец ${col+1}" ${mode!=='edit'?'disabled':''}>${mode==='edit'?'+':'·'}</button>`;
 const rank=doc.build[t.id]||0, next={...doc.build,[t.id]:rank+1};
 const state=mode==='edit'?'editable':talentState(doc,t), desc=t.descriptions[Math.max(0,rank-1)]||'Описание не задано';
 return `<button class="slot filled ${state} ${t.grantedAbilityId?'ability-talent':''}" data-state="${state}" data-talent="${esc(t.id)}" data-row="${row}" data-col="${col}" draggable="${mode==='edit'}" data-tip="${esc(t.name)} (${rank}/${t.maxRank})\n${esc(desc)}${t.requires?'\nТребуется полностью изучить: '+esc(b.talents.find(x=>x.id===t.requires)?.name):''}" aria-label="${esc(t.name)}, ранг ${rank} из ${t.maxRank}"><span class="fallback">✦</span>${image(t.icon)}<span class="rank">${mode==='edit'?'0':rank}/${t.maxRank}</span></button>`;
 }).join('')}</div>${mode==='edit'?'<div class="tree-footer"><button data-action="add-row">＋ Добавить ряд</button><button data-action="remove-row" title="Удалить последний ряд">− Ряд</button></div>':''}</article>`).join('');
 renderAbilities();
 requestAnimationFrame(drawDependencies);
}
function renderAbilities(){
 const compact=mode==='play'&&abilityView==='icons';$('#abilityViewControls').hidden=mode!=='play';
 for(const button of document.querySelectorAll('[data-ability-view]')){const selected=button.dataset.abilityView===abilityView;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}
 function card(a){const unlocked=abilityUnlocked(doc,a);return `<button class="ability-card ${compact?'ability-icon':''} ${mode==='play'&&!unlocked?'locked':''}" data-ability="${esc(a.id)}" draggable="${mode==='edit'}" aria-label="${esc(a.name)} — ${a.kind==='passive'?'пассивная':'активная'}"><span class="ability-fallback">✦</span>${image(a.icon)}${compact?'':`<div><strong>${esc(a.name)}</strong><p>${esc(a.description)}</p><p>${abilityStats(a).map(esc).join(' · ')}</p></div>`}</button>`;}
 $('#abilities').innerHTML=groupedAbilities(doc).map((row,i)=>`<section class="ability-band branch-theme-${i%4}" data-ability-band="${esc(row.id)}"><div class="ability-band-label">${image(row.icon)}<strong>${esc(row.name)}</strong></div><div class="ability-band-content">${[['active','Активные'],['passive','Пассивные']].map(([kind,name])=>`<div class="ability-type-section" data-ability-kind="${kind}"><h4>${name} <span>${row[kind].length}</span></h4><div class="ability-items ${compact?'icons':'details'}">${row[kind].map(card).join('')||'<span class="muted">Нет способностей</span>'}</div></div>`).join('')}</div></section>`).join('');
}
for(const button of document.querySelectorAll('[data-ability-view]'))button.onclick=()=>{abilityView=button.dataset.abilityView;renderAbilities();};
function drawDependencies(){
 for(const tree of document.querySelectorAll('.tree')){
  const b=doc.branches.find(b=>b.id===tree.dataset.branch), grid=tree.querySelector('.talent-grid');
  grid.querySelector('svg')?.remove();
  const planned=dependencyRoutes(b);
  tree.querySelector('.route-warning')?.remove();if([...planned.values()].some(path=>!path))tree.insertAdjacentHTML('beforeend','<p class="route-warning">Нет свободного пути для всех стрелок. Измени зависимости.</p>');
  const lines=b.talents.filter(t=>t.requires).map(t=>{
   const child=[...grid.querySelectorAll('[data-talent]')].find(el=>el.dataset.talent===t.id),parentTalent=b.talents.find(p=>p.id===t.requires),parent=[...grid.querySelectorAll('[data-talent]')].find(el=>el.dataset.talent===t.requires),path=planned.get(t.id);
   if(!child||!parent||!path)return '';
   const cells=[...grid.querySelectorAll('.slot')],points=path.map(([r,c])=>{const el=cells[r*4+c];return [el.offsetLeft+el.offsetWidth/2,el.offsetTop+el.offsetHeight/2];});
   const trim=(a,z,size)=>{const dx=z[0]-a[0],dy=z[1]-a[1],len=Math.hypot(dx,dy);return [a[0]+dx/len*size,a[1]+dy/len*size];};
   points[0]=trim(points[0],points[1],parent.offsetWidth/2+2);points[points.length-1]=trim(points.at(-1),points.at(-2),child.offsetWidth/2+3);
   const earlier=b.talents.filter(p=>p.row<t.row).reduce((sum,p)=>sum+(doc.build[p.id]||0),0),active=mode==='edit'||((doc.build[parentTalent.id]||0)===parentTalent.maxRank&&earlier>=t.row*doc.rowCost),status=active?'active':'inactive',coordinates=points.map(p=>p.join(',')).join(' ');
   return `<g class="dependency-arrow ${status}" data-dependency="${esc(t.id)}"><polyline class="arrow-shadow" points="${coordinates}"/><polyline class="arrow-body" points="${coordinates}"/><polyline class="arrow-highlight" points="${coordinates}" marker-end="url(#arrow-${status}-${b.id})"/></g>`;
  }).join('');
  grid.insertAdjacentHTML('afterbegin',`<svg class="dependency" aria-hidden="true"><defs>${['active','inactive'].map(state=>`<marker id="arrow-${state}-${esc(b.id)}" markerWidth="12" markerHeight="12" viewBox="0 0 12 12" refX="10" refY="6" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1 L11 6 L1 11 L3 6 Z" fill="${state==='active'?'#ffda35':'#929292'}" stroke="${state==='active'?'#362500':'#191919'}" stroke-width="1.2"/></marker>`).join('')}</defs>${lines}</svg>`);
 }
}
let treeZoom=1;
function updateTreeControls(){const focus=$('#focusBranch'),previous=focus.value;focus.innerHTML='<option value="">Все ветки</option>'+doc.branches.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');focus.value=doc.branches.some(b=>b.id===previous)?previous:'';}
function setTreeZoom(value){treeZoom=Math.max(.7,Math.min(1.5,Math.round(value*10)/10));$('#trees').style.setProperty('--tree-zoom',treeZoom);$('#zoomReset').textContent=Math.round(treeZoom*100)+'%';$('#zoomOut').disabled=treeZoom<=.7;$('#zoomIn').disabled=treeZoom>=1.5;requestAnimationFrame(drawDependencies);}
$('#zoomOut').onclick=()=>setTreeZoom(treeZoom-.1);$('#zoomIn').onclick=()=>setTreeZoom(treeZoom+.1);$('#zoomReset').onclick=()=>setTreeZoom(1);
$('#focusBranch').onchange=e=>{const tree=[...document.querySelectorAll('.tree')].find(t=>t.dataset.branch===e.target.value);if(tree)tree.scrollIntoView({block:'nearest',inline:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});else $('#trees').scrollLeft=0;};
window.addEventListener('resize',drawDependencies);
function modal(title, body, save, remove) {
 $('#modal').classList.remove('avatar-picker');modalCancel=null;$('#favoriteItem').hidden=true;
 $('#modalTitle').textContent=title;$('#modalBody').innerHTML=body;$('#formError').textContent='';modalSave=save;modalDelete=remove;
 $('#submitModal').hidden=!save;$('#deleteItem').hidden=!remove;$('#modal').showModal();
}
$('#closeModal').onclick=()=>{const back=modalCancel;modalCancel=null;$('#modal').close();if(back)setTimeout(back,0);};$('#modal').addEventListener('cancel',e=>{if(modalCancel){e.preventDefault();$('#closeModal').click();}});
$('#modalForm').onsubmit=async e=>{e.preventDefault();$('#formError').textContent='';const button=$('#submitModal');button.disabled=true;button.setAttribute('aria-busy','true');try{if(modalSave) await modalSave();}catch(err){$('#formError').textContent=err.message;}finally{button.disabled=false;button.setAttribute('aria-busy','false');}};
$('#deleteItem').onclick=()=>modalDelete?.();
function field(id,label,value='',type='text',attrs=''){return `<label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(value)}" ${attrs}>`;}
function iconPicker(selected='inv_misc_questionmark'){
 return `<label for="iconSearch">ИКОНКА · ПОИСК ПО НАЗВАНИЮ ИЛИ КЛАССУ</label><input id="iconSearch" placeholder="Огонь, лечение, воин…"><div id="iconGrid" class="icon-grid"></div>${field('iconName','ИЛИ ВВЕДИ ИМЯ ЛЮБОЙ WOW-ИКОНКИ',/^[a-z0-9_]+$/i.test(selected)?selected:'','text',`pattern="[A-Za-z0-9_]+" data-initial="${esc(selected)}"`)}<div class="icon-preview">${image(selected,'id="iconPreview"')}<small class="muted"><span id="iconCount">Загрузка каталога…</span></small></div>`;
}
function readIcon(){return $('#iconName').value.toLowerCase()||$('#iconName').dataset.initial||'inv_misc_questionmark';}
function bindPicker(){
 const update=()=>{if(!$('#iconGrid'))return;$('#iconCount').textContent=`Каталог: ${iconCatalog.length} иконок`;$('#iconGrid').innerHTML=iconCatalog.filter(i=>(i.id+' '+i.label).toLowerCase().includes($('#iconSearch').value.toLowerCase())).map(i=>`<button type="button" class="icon-choice ${i.id===$('#iconName').value?'active':''}" data-icon="${esc(i.id)}" title="${esc(i.label)}">${image(i.id)}</button>`).join('');};
 $('#iconSearch').oninput=update;
 const preview=()=>{$('#iconPreview').style.visibility='visible';$('#iconPreview').src=iconURL(readIcon())||'missing-icon';};
 $('#iconGrid').onclick=e=>{const btn=e.target.closest('[data-icon]');if(btn){$('#iconName').dataset.initial=btn.dataset.icon;$('#iconName').value=/^[a-z0-9_]+$/i.test(btn.dataset.icon)?btn.dataset.icon:'';preview();update();}};
 $('#iconName').oninput=preview;
 update();loadIconCatalog().then(update).catch(()=>toast('Не удалось загрузить полный каталог иконок'));
}
function editTalent(b,row,col,existing,draft){
 const t=draft||existing||{id:crypto.randomUUID(),row,col,name:'',icon:'inv_misc_questionmark',maxRank:1,descriptions:[''],requires:''};
 if(t.grantedAbilityId){editAbilityPlacement(b,t,existing);return;}
 let rankEditor;
 function eligible(p){const candidate=p;if(p.id===t.id||p.row>t.row)return false;const seen=new Set();while(p.requires){if(p.requires===t.id||seen.has(p.id))return false;seen.add(p.id);p=b.talents.find(x=>x.id===p.requires);if(!p)return false;}return !!route(b,candidate,t);}
 modal(existing?'Редактировать талант':'Новый талант',field('talentName','НАЗВАНИЕ',t.name,'text','required maxlength="100"')+iconPicker(t.icon)+`<div class="two-cols"><div>${field('maxRank','КОЛИЧЕСТВО РАНГОВ',t.maxRank,'number','min="1" max="100" required')}</div><div><label for="requires">ТРЕБУЕТ ТАЛАНТ (ПОЛНЫЙ РАНГ)</label><select id="requires"><option value="">Без зависимости</option>${t.requires&&!b.talents.filter(eligible).some(p=>p.id===t.requires)?`<option value="${esc(t.requires)}" selected>Текущая зависимость: нужно изменить маршрут</option>`:''}${b.talents.filter(eligible).map(p=>`<option value="${esc(p.id)}" ${t.requires===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div></div><div id="rankFields" class="rank-editor"></div>`,()=>{
  const maxRank=Number($('#maxRank').value),rankResult=rankEditor.result();
  const updated={...t,name:$('#talentName').value.trim(),icon:readIcon(),maxRank,requires:$('#requires').value,descriptions:rankResult.descriptions};
  if(rankResult.rankTemplate)updated.rankTemplate=rankResult.rankTemplate;else delete updated.rankTemplate;
  if(!updated.name)throw Error('Введи название');
  if([...dependencyRoutes({...b,talents:b.talents.filter(x=>x.id!==updated.id).concat(updated)}).values()].some(p=>!p))throw Error('Стрелки пересекаются или нет свободного пути. Измени зависимость.');
  if(existing)b.talents[b.talents.indexOf(existing)]=updated;else b.talents.push(updated);
  if(!validBuild(doc,doc.build)) doc.build={};changed();render();$('#modal').close();
 },existing?()=>{
  if(!confirm('Удалить талант? Зависимости от него будут сняты.'))return;
  b.talents=b.talents.filter(x=>x.id!==t.id);for(const x of b.talents)if(x.requires===t.id)x.requires='';for(const a of doc.abilities)if(a.talentId===t.id)a.talentId='';doc.build={};changed();render();$('#modal').close();
 }:null);
 $('#modalBody').insertAdjacentHTML('afterbegin','<div class="talent-source-actions"><button type="button" id="pickFavorite">★ Взять из избранного</button><button type="button" id="pickAbility">＋ Добавить способность</button></div>');
 $('#pickFavorite').hidden=!!existing;$('#pickFavorite').onclick=()=>{$('#modal').close();showFavorites({branchId:b.id,row,col});};
 $('#pickAbility').onclick=()=>{const saved={...t,...rankEditor.draft(),name:$('#talentName').value,icon:readIcon(),maxRank:Number($('#maxRank').value),requires:$('#requires').value};if(!rankEditor.draft().rankTemplate)delete saved.rankTemplate;const reopen=()=>editTalent(b,row,col,existing,saved);$('#modal').close();setTimeout(()=>pickAbilityForTalent(ability=>editTalent(b,row,col,existing,abilityTalentDraft(ability,saved)),reopen),0);};
 rankEditor=createRankEditor($('#rankFields'),$('#maxRank'),t,{name:()=>$('#talentName').value,icon:readIcon});$('#talentName').addEventListener('input',()=>rankEditor.refresh());$('#iconName').addEventListener('input',()=>rankEditor.refresh());bindPicker();$('#iconGrid').addEventListener('click',()=>rankEditor.refresh());favoriteButton('talent',()=>b.talents.find(x=>x.id===t.id));
}
function editAbilityPlacement(b,t,existing){
 const ability=doc.abilities.find(a=>a.id===t.grantedAbilityId);if(!ability){toast('Способность не найдена');return;}
 function eligible(p){if(p.id===t.id||p.row>t.row)return false;let current=p;const seen=new Set();while(current.requires){if(current.requires===t.id||seen.has(current.id))return false;seen.add(current.id);current=b.talents.find(x=>x.id===current.requires);if(!current)return false;}return !!route(b,p,t);}
 modal('Зависимость: '+ability.name,`<label for="requires">ТРЕБУЕТ ТАЛАНТ (ПОЛНЫЙ РАНГ)</label><select id="requires"><option value="">Без зависимости</option>${t.requires&&!b.talents.filter(eligible).some(p=>p.id===t.requires)?`<option value="${esc(t.requires)}" selected>Текущая зависимость: нужно изменить маршрут</option>`:''}${b.talents.filter(eligible).map(p=>`<option value="${esc(p.id)}" ${t.requires===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select><p class="muted">Название, иконка и описание берутся из способности и изменяются в списке способностей.</p>`,()=>{const updated=abilityTalentDraft(ability,{...t,requires:$('#requires').value});if([...dependencyRoutes({...b,talents:b.talents.filter(x=>x.id!==updated.id).concat(updated)}).values()].some(p=>!p))throw Error('Стрелки пересекаются или нет свободного пути. Измени зависимость.');if(existing)b.talents[b.talents.indexOf(existing)]=updated;else b.talents.push(updated);if(!validBuild(doc,doc.build))doc.build={};changed();render();$('#modal').close();},existing?()=>{if(!confirm('Убрать способность из этой ячейки?'))return;b.talents=b.talents.filter(x=>x.id!==t.id);for(const p of b.talents)if(p.requires===t.id)p.requires='';for(const a of doc.abilities)if(a.talentId===t.id)a.talentId='';doc.build={};changed();render();$('#modal').close();}:null);
}
function editAbility(existing,onSaved=null,onCancel=null){
 const a=existing||{id:crypto.randomUUID(),name:'',description:'',icon:'inv_misc_questionmark',resource:'',cast:'',cooldown:'',range:'',talentId:''};
 if(mode==='play'){modal(a.name,`<p class="tooltip-description">${esc(a.description)}</p><p class="gold">${abilityStats(a).map(esc).join(' · ')}</p>`,null);return;}
 modal(existing?'Редактировать способность':'Новая способность',field('abilityName','НАЗВАНИЕ',a.name,'text','required maxlength="100"')+iconPicker(a.icon)+`<div class="two-cols"><div><label for="abilityKind">ТИП СПОСОБНОСТИ</label><select id="abilityKind"><option value="active" ${a.kind!=='passive'?'selected':''}>Активная</option><option value="passive" ${a.kind==='passive'?'selected':''}>Пассивная</option></select></div><div><label for="abilityBranch">ВЕТКА</label><select id="abilityBranch"><option value="auto" ${a.branchId===undefined||a.branchId==='auto'?'selected':''}>По размещению в дереве</option><option value="" ${a.branchId===''?'selected':''}>Общая — без ветки</option>${doc.branches.map(b=>`<option value="${esc(b.id)}" ${a.branchId===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div></div><label for="abilityDescription">ОПИСАНИЕ</label><textarea id="abilityDescription" maxlength="10000">${esc(a.description)}</textarea><div class="two-cols">${['resource','cast','cooldown','range'].map((k,i)=>`<div>${field(k,['СТОИМОСТЬ РЕСУРСА','ВРЕМЯ ПРИМЕНЕНИЯ','ПЕРЕЗАРЯДКА','ДАЛЬНОСТЬ'][i],numericValue(a[k]),'number','min="0" max="1000000000" step="any" required')}</div>${k==='resource'?`<div><label for="resourceType">РАСХОДУЕМЫЙ РЕСУРС</label><select id="resourceType">${resourceOptions(a.resourceType)}</select></div>`:''}`).join('')}</div><p class="muted">Применение и восстановление — в секундах, дальность — в метрах. Название способности остаётся текстовым.</p><label for="talentLink">ОТКРЫВАЕТСЯ ТАЛАНТОМ</label><select id="talentLink"><option value="">Базовая способность</option>${doc.branches.flatMap(b=>b.talents).map(t=>`<option value="${esc(t.id)}" ${a.talentId===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select>`,()=>{
  const updated={...a,name:$('#abilityName').value.trim(),description:$('#abilityDescription').value,icon:readIcon(),talentId:$('#talentLink').value,kind:$('#abilityKind').value,branchId:$('#abilityBranch').value};
  if(!updated.name)throw Error('Введи название');
  for(const k of ['resource','cast','cooldown','range']){updated[k]=Number($('#'+k).value);if(!Number.isFinite(updated[k])||updated[k]<0||updated[k]>1e9)throw Error('Характеристики должны быть неотрицательными числами');}updated.resourceType=$('#resourceType').value;
  if(existing)doc.abilities[doc.abilities.indexOf(existing)]=updated;else doc.abilities.push(updated);
  changed();render();$('#modal').close();if(onSaved)setTimeout(()=>onSaved(updated),0);
 },existing?()=>{if(confirm('Удалить способность и её размещения в деревьях?')){doc=removeAbility(doc,a.id);changed();render();$('#modal').close();}}:null);bindPicker();favoriteButton('ability',()=>doc.abilities.find(x=>x.id===a.id));modalCancel=onCancel;
}
$('#trees').addEventListener('change',e=>{if(e.target.matches('.tree-header input')){doc.branches.find(b=>b.id===e.target.closest('.tree').dataset.branch).name=e.target.value;changed();render();}});
function treeClick(e){
 const tree=e.target.closest('.tree');if(!tree)return;const b=doc.branches.find(b=>b.id===tree.dataset.branch),btn=e.target.closest('button');if(!btn)return;
 if(btn.dataset.talent){const t=b.talents.find(t=>t.id===btn.dataset.talent);if(mode==='edit'){editTalent(b,t.row,t.col,t);}else{if(changeRank(doc,t.id,e.type==='contextmenu'||e.shiftKey?-1:1)){if(e.type!=='contextmenu'&&!e.shiftKey)trackAllocation();changed();render();}else toast('Не хватает очков, не выполнены требования или от таланта зависят другие.');}return;}
 if(mode!=='edit')return;
 if(btn.dataset.row!==undefined){if(reserved(b,Number(btn.dataset.row),Number(btn.dataset.col))){toast('Здесь проходит стрелка. Сначала убери зависимость.');return;}if(favoritePlacement){placeFavorite(favoritePlacement,{branchId:b.id,row:Number(btn.dataset.row),col:Number(btn.dataset.col)});return;}editTalent(b,Number(btn.dataset.row),Number(btn.dataset.col));return;}
 switch(btn.dataset.action){
  case 'branch-icon':modal('Иконка ветки «'+b.name+'»',iconPicker(branchIcon(b)),()=>{b.icon=readIcon();changed();render();$('#modal').close();});bindPicker();return;
  case 'add-row':if(b.rows>=1000){toast('Достигнут технический предел: 1000 рядов.');return;}{const rows=Math.max(...doc.branches.map(b=>b.rows))+1;for(const x of doc.branches)x.rows=rows;if(doc.budgetAuto)doc.budget=defaultBudget(doc);}break;
  case 'remove-row':{
   const rows=Math.max(...doc.branches.map(x=>x.rows));if(rows<=1)return;
   const removed=new Set(doc.branches.flatMap(x=>x.talents.filter(t=>t.row>=rows-1).map(t=>t.id)));
   if(removed.size&&!confirm('Последний ряд содержит таланты. Удалить его во всех ветках вместе с талантами?'))return;
   for(const x of doc.branches){x.rows=rows-1;x.talents=x.talents.filter(t=>!removed.has(t.id));}
   for(const a of doc.abilities)if(removed.has(a.talentId))a.talentId='';if(doc.budgetAuto)doc.budget=defaultBudget(doc);doc.build={};break;
  }
  case 'delete-branch':if(doc.branches.length===1){toast('Нужна хотя бы одна ветка.');return;}if(!confirm(`Удалить ветку «${b.name}» и её таланты?`))return;{const removed=new Set(b.talents.map(t=>t.id));doc.branches=doc.branches.filter(x=>x!==b);for(const a of doc.abilities)if(a.branchId===b.id)a.branchId='';for(const a of doc.abilities)if(removed.has(a.talentId))a.talentId='';doc.build={};}break;
  default:return;
 }
 changed();render();
}
$('#trees').onclick=treeClick;$('#trees').oncontextmenu=e=>{if(mode==='play'&&e.target.closest('[data-talent]')){e.preventDefault();treeClick(e);}};
$('#abilities').onclick=e=>{const el=e.target.closest('[data-ability]');if(el)editAbility(doc.abilities.find(a=>a.id===el.dataset.ability));};
$('#addBranch').onclick=()=>{if(doc.branches.length<4){const next=branch(`Ветка ${doc.branches.length+1}`);next.rows=Math.max(...doc.branches.map(b=>b.rows));doc.branches.push(next);changed();render();}};
$('#addAbility').onclick=()=>editAbility();
$('#editMode').onclick=()=>{mode='edit';render();};$('#playMode').onclick=()=>{mode='play';render();};
$('#reset').onclick=()=>{doc.build={};changed();render();};
for(const id of ['className','budget','rowCost'])$('#'+id).onchange=()=>{
 const key=id==='className'?'name':id,value=key==='name'?$('#'+id).value.trim():Number($('#'+id).value);
 if((key==='name'&&!value)||(key!=='name'&&(!Number.isInteger(value)||value<0||value>100000))){toast('Проверь значение');render();return;}
 doc[key]=value;if(key==='budget')doc.budgetAuto=false;if(!validBuild(doc,doc.build))doc.build={};changed();render();
};
$('#new').onclick=()=>{if(dirty&&!confirm('Создать новый класс? Текущий черновик будет заменён. Сначала можно сохранить или экспортировать его.'))return;showWorkspace();doc=blank();projectId=null;activeShare=null;activePublication=null;mode='edit';changed();render();};
$('#preset').onclick=async()=>{
 try{
  const response=await fetch('presets/index.json');if(!response.ok)throw Error('Не удалось загрузить каталог');const classes=await response.json();
  let version='Forever',selected=classes.find(c=>c.version===version)?.id;
  modal('Стандартные деревья',`<div id="versionFilters" class="version-filters">${[['Forever','Forever'],['2.4.3','TBC'],['3.3.5a','WotLK']].map(([v,n])=>`<button type="button" data-version="${v}">${n}</button>`).join('')}</div><input type="hidden" id="presetClass"><div id="classCards" class="class-cards"></div><p class="muted">Тексты стандартных наборов на английском. Forever — снимок 1.60.1.69876, возможны отличия от текущего Wowhead.</p>`,async()=>{
   if(!selected)throw Error('Выбери класс');if(dirty&&!confirm('Заменить текущий черновик выбранным классом?'))return;
   const response=await fetch(`presets/${selected}.json`);if(!response.ok)throw Error('Не удалось загрузить класс');doc=normalize(await response.json());showWorkspace();projectId=null;activeShare=null;allocationSent=false;$('#shareStats').hidden=true;mode=user?'edit':'play';changed();render();$('#modal').close();toast(doc.source?.notice||'Класс загружен');
  });
  function drawClasses(){
   for(const b of document.querySelectorAll('[data-version]')){b.classList.toggle('selected',b.dataset.version===version);b.setAttribute('aria-pressed',String(b.dataset.version===version));}
   const filtered=classes.filter(c=>(c.version||'3.3.5a')===version);if(!filtered.some(c=>c.id===selected))selected=filtered[0]?.id;
   $('#presetClass').value=selected||'';
   $('#classCards').innerHTML=filtered.map(c=>`<button type="button" data-class="${esc(c.id)}" class="class-card ${c.id===selected?'selected':''}" aria-pressed="${c.id===selected}">${image('class_'+c.id.replace(/^(forever|tbc)-/,''))}<strong>${esc(c.name)}</strong><small>${c.talents} талантов</small></button>`).join('');
   for(const b of document.querySelectorAll('[data-class]'))b.onclick=()=>{selected=b.dataset.class;drawClasses();};
  }
  for(const b of document.querySelectorAll('[data-version]'))b.onclick=()=>{version=b.dataset.version;drawClasses();};drawClasses();$('#submitModal').textContent=user?'Загрузить класс':'Открыть калькулятор';
 }catch(err){toast(err.message);}
};
$('#export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${doc.name.replace(/[^\p{L}\p{N}_-]/gu,'_')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#import').onclick=()=>$('#file').click();$('#file').onchange=async e=>{
 try{const file=e.target.files[0];if(!file)return;if(file.size>2_000_000)throw Error('Файл больше 2 МБ');const incoming=normalize(JSON.parse(await file.text()));if(dirty&&!confirm('Заменить текущий черновик импортированным классом?'))return;doc=incoming;projectId=null;activeShare=null;changed();render();toast('Класс импортирован');}catch(err){toast(err.message);}finally{e.target.value='';}
};
function avatarMarkup(icon,name){return `<span class="user-avatar"><span class="avatar-initial">${esc((name||'?').slice(0,1).toUpperCase())}</span>${image(icon||'inv_misc_questionmark')}</span>`;}
$('#profileAvatar').onclick=()=>{if(!user){auth();return;}modal('Аватар профиля',`<p class="muted">Выбери иконку. Аватар отображается в круге рядом с ником.</p>${iconPicker(user.avatar||'inv_misc_questionmark')}`,async()=>{const result=await api('/profile/avatar',{avatar:readIcon()});user=result.user;renderUser();$('#modal').close();if(!$('#community').hidden)openCommunity(communityState.scope);toast('Аватар сохранён');});$('#modal').classList.add('avatar-picker');bindPicker();};
function updateNavigation(){
 const view=!$('#library').hidden?$('#library').dataset.scope:!$('#community').hidden?(communityState.scope==='mine'?'publications':'rankings'):'projects';
 document.body.dataset.view=view;
 for(const id of ['rankings','publications','projects','favorites']){const selected=id===view;$('#'+id).classList.toggle('nav-active',selected);if(selected)$('#'+id).setAttribute('aria-current','page');else $('#'+id).removeAttribute('aria-current');}
}

function renderUser(){notificationUser(user?.login);$('#accountMenu').hidden=!user;closeMenus();if(!user&&!$('#library').hidden)showWorkspace();$('#profileAvatar').hidden=!user;$('#profileAvatar').innerHTML=user?avatarMarkup(user.avatar,user.login):'';if(!user){activePublication=null;$('#publicationBar').hidden=true;if(communityState.scope==='mine'){communityState.scope='rankings';$('#community').hidden=true;$('#community').innerHTML='';$('.workspace').hidden=false;}}if(activeShare)refreshShareStats();$('#user').textContent=user?.login||'';$('#auth').hidden=!!user;$('#logout').hidden=!user;}
function auth(register=false){
 modal(register?'Создать аккаунт':'Войти в мастерскую',`<p class="muted">Сохраняй классы в своей учётной записи и возвращайся к ним позже.</p>${field('login','ЛОГИН','','text','required pattern="[A-Za-z0-9_\\-]{3,32}" minlength="3" maxlength="32" autocomplete="username"')}${field('password','ПАРОЛЬ','','password',`required minlength="8" maxlength="128" autocomplete="${register?'new-password':'current-password'}"`)}<p class="muted">Логин: латинские буквы, цифры, _ и -. Пароль: минимум 8 символов.</p><button type="button" id="switchAuth">${register?'Уже есть аккаунт? Войти':'Нет аккаунта? Зарегистрироваться'}</button>`,async()=>{const result=await api(register?'/register':'/login',{login:$('#login').value,password:$('#password').value});user=result.user;if(user&&!activeShare)mode='edit';renderUser();render();$('#modal').close();toast('Ты в мастерской. Теперь можно сохранить класс.');});
 $('#submitModal').textContent=register?'Зарегистрироваться':'Войти';$('#switchAuth').onclick=()=>{$('#modal').close();auth(!register);};
}
$('#chooseAvatar').onclick=()=>{closeMenus();$('#profileAvatar').click();};
$('#auth').onclick=()=>auth();
$('#logout').onclick=async()=>{try{await api('/logout',{});user=null;projectId=null;mode='play';resetHistory();renderUser();render();toast('Выход выполнен. Локальный черновик остаётся в этом браузере.');}catch(err){toast(err.message);}};
$('#save').onclick=async()=>{
 if(!user){auth();return;}const button=$('#save');button.disabled=true;button.setAttribute('aria-busy','true');
 try{const result=await api('/projects',{id:projectId,document:normalize(doc),sourceShare:activeShare});projectId=result.id;dirty=false;refreshShareStats();$('#saveState').textContent='Сохранено в аккаунте';toast('Класс и текущий билд сохранены');}catch(err){toast(err.message);}finally{button.disabled=false;button.setAttribute('aria-busy','false');}
};
$('#share').onclick=()=>{
 if(!user){auth();return;}
 modal('Зафиксировать версию',`<p>Будет сохранён и опубликован неизменяемый снимок класса с текущим билдом. Последующие правки рабочего класса не изменят эту версию.</p><label for="publicationVisibility">ВИДИМОСТЬ</label><select id="publicationVisibility"><option value="unlisted">Только по ссылке</option><option value="public">Общедоступное — участвует в рейтингах</option></select><p class="muted">Общедоступную версию смогут найти в рейтинге. Версию по ссылке увидят только те, кому передана ссылка.</p>`,async()=>{
  const visibility=$('#publicationVisibility').value;
  const saved=await api('/projects',{id:projectId,document:normalize(doc),sourceShare:activeShare});projectId=saved.id;
  const result=await api('/publish',{projectId,visibility});dirty=false;$('#saveState').textContent='Сохранено в аккаунте';
  const url=new URL(location.href);url.search='';url.searchParams.set('share',result.token);url.hash='';
  $('#modal').close();modal('Версия '+result.publication.version+' зафиксирована',field('shareURL','ССЫЛКА НА ПУБЛИКАЦИЮ',url.href,'text','readonly')+`<p>${visibility==='public'?'Публикация появилась в рейтинге.':'Только по ссылке — в рейтинге не показывается.'}</p><p class="muted">Статистика и управление видимостью — в «Мои публикации».</p>`,null);$('#shareURL').select();
 });$('#submitModal').textContent='Зафиксировать и опубликовать';
};
$('#projects').onclick=()=>openLibrary('projects');
async function loadWorkingProject(pid,copy=false){
 if(dirty&&!confirm('Заменить текущий черновик выбранным деревом?'))return;
 const result=await api('/projects/'+encodeURIComponent(pid));doc=normalize(result.document,{allowLegacy:true});activeShare=null;activePublication=null;allocationSent=false;projectId=copy?null:pid;mode='edit';if(copy)doc.name+=' — копия';showWorkspace();if(copy)changed();else{dirty=false;try{localStorage.setItem('talentforge-draft',JSON.stringify(doc));}catch{}$('#saveState').textContent='Сохранено в аккаунте';}resetHistory();render();history.replaceState(null,'',location.pathname);if($('#modal').open)$('#modal').close();
}
let libraryRequest=0;
async function openLibrary(scope){
 if(!user){auth();return;}closeMenus();const request=++libraryRequest,viewer=user.login;
 $('#library').dataset.scope=scope;$('#library').hidden=false;$('#community').hidden=true;$('.workspace').hidden=true;$('#publicationBar').hidden=true;$('#shareStats').hidden=true;updateNavigation();
 const favorites=scope==='favorites';
 $('#library').innerHTML=`<div class="community-heading"><div><p class="eyebrow">ТВОЯ МАСТЕРСКАЯ</p><h2>${favorites?'Избранное':'Мои деревья'}</h2><p class="muted">${favorites?'Таланты и способности, которые всегда под рукой.':'Сохраняй идеи и возвращайся к своим деревьям.'}</p></div><button id="closeLibrary">${glyph('arrow')}К редактору</button></div><div class="list-tools"><label class="search-field">${glyph('search')}<input id="librarySearch" type="search" placeholder="${favorites?'Найти талант или способность':'Найти дерево'}" aria-label="Поиск в сохранениях"></label><span id="libraryCount" class="muted"></span></div>${favorites?'<div class="library-filters" aria-label="Тип избранного"><button data-kind="all" class="selected">Все</button><button data-kind="talent">Таланты</button><button data-kind="ability">Способности</button></div>':''}<div id="libraryItems" class="library-items" aria-busy="true"><div class="loading-state"><span class="spinner"></span>Загружаем твою мастерскую…</div></div>`;
 $('#closeLibrary').onclick=()=>{showWorkspace();render();if(activeShare)refreshShareStats();};
 try{
  const result=await api(favorites?'/favorites':'/projects');if(request!==libraryRequest||user?.login!==viewer||$('#library').hidden)return;
  let items=favorites?result.favorites:result.projects,kind='all';
  function paint(){
   const query=$('#librarySearch').value.toLocaleLowerCase('ru'),filtered=items.filter(item=>(!favorites||kind==='all'||item.kind===kind)&&(favorites?item.item.name:item.name).toLocaleLowerCase('ru').includes(query));
   $('#libraryCount').textContent=`${filtered.length} из ${items.length}`;$('#libraryItems').setAttribute('aria-busy','false');
   $('#libraryItems').innerHTML=filtered.length?filtered.map(item=>favorites?`<article class="library-card"><span class="library-emblem">${image(item.item.icon)}</span><div class="library-copy"><strong>${esc(item.item.name)}</strong><span class="muted">${item.kind==='talent'?'Талант':'Способность'}</span></div><button data-use="${esc(item.id)}">${glyph('plus')}Добавить в дерево</button><button data-remove="${esc(item.id)}" class="icon-button danger" aria-label="Удалить из избранного">${glyph('trash')}</button></article>`:`<article class="library-card"><span class="library-emblem">${glyph('layers')}</span><div class="library-copy"><button class="library-title" data-open="${esc(item.id)}">${esc(item.name)}</button><span class="muted">Изменено ${esc(new Date(item.updated*1000).toLocaleString('ru-RU'))}</span></div><button data-open="${esc(item.id)}">${glyph('edit')}Открыть</button><button data-copy="${esc(item.id)}">${glyph('copy')}Копия</button><button data-remove="${esc(item.id)}" class="icon-button danger" aria-label="Удалить дерево">${glyph('trash')}</button></article>`).join(''):`<div class="empty library-empty">${glyph(favorites?'star':'layers')}<strong>${query||kind!=='all'?'Ничего не найдено':favorites?'Сохрани то, что вдохновляет':'Здесь начнётся твоя история'}</strong><p>${query||kind!=='all'?'Попробуй другое название или фильтр.':favorites?'Открой талант или способность и нажми «В избранное».':'Создай дерево и нажми «Сохранить», чтобы вернуться к нему позже.'}</p></div>`;
  }
  $('#librarySearch').oninput=paint;for(const button of $('#library').querySelectorAll('[data-kind]'))button.onclick=()=>{kind=button.dataset.kind;for(const b of $('#library').querySelectorAll('[data-kind]'))b.classList.toggle('selected',b===button);paint();};paint();
  $('#libraryItems').onclick=async e=>{const button=e.target.closest('button');if(!button)return;button.disabled=true;try{
   if(button.dataset.open||button.dataset.copy){await loadWorkingProject(button.dataset.open||button.dataset.copy,!!button.dataset.copy);return;}
   if(button.dataset.remove){if(!confirm(favorites?'Удалить из избранного?':'Удалить сохранённое дерево?'))return;await api((favorites?'/favorites/':'/projects/')+encodeURIComponent(button.dataset.remove),{},'DELETE');if(!favorites&&projectId===button.dataset.remove)projectId=null;items=items.filter(item=>item.id!==button.dataset.remove);paint();toast(favorites?'Удалено из избранного':'Дерево удалено');return;}
   if(button.dataset.use){const favorite=items.find(item=>item.id===button.dataset.use);showWorkspace();mode='edit';if(favorite.kind==='ability'){doc.abilities.push({...structuredClone(favorite.item),id:crypto.randomUUID(),talentId:'',branchId:''});changed();render();toast('Способность добавлена');}else{favoritePlacement=structuredClone(favorite.item);render();toast('Нажми на пустую ячейку для размещения таланта');}}
  }catch(error){toast(error.message);}finally{button.disabled=false;}};
 }catch(error){if(request===libraryRequest&&!$('#library').hidden){$('#libraryItems').setAttribute('aria-busy','false');$('#libraryItems').textContent=error.message;}}
}
$('#modal').addEventListener('close',()=>{$('#modalBody').onclick=null;$('#submitModal').textContent='Сохранить';});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});

function character(){
 doc.character??={hp:10000,race:'Человек',gender:'Мужской',armory:'',resources:[{name:'Мана',max:100,current:100,display:'bar',shape:'diamond',color:'#397de1'}]};
 return doc.character;
}
function renderCharacter(){
 const panel=$('#characterPanel');if(!panel)return;
 panel.hidden=mode!=='play';$('.calc-layout').classList.toggle('with-character',mode==='play');
 if(mode!=='play')return;
 const c=character();
 panel.innerHTML=`<h2>${esc(doc.name)}</h2><p class="muted">${esc(c.race)} · ${esc(c.gender)}</p><label>ЗДОРОВЬЕ</label><div class="resource-bar" style="--resource-color:#459254"><span style="width:100%"></span><strong>${esc(c.hp)} / ${esc(c.hp)}</strong></div>${c.resources.map(r=>`<label>${esc(r.name)}</label>${r.display==='bar'?`<div class="resource-bar" style="--resource-color:${/^#[0-9a-f]{6}$/i.test(r.color)?r.color:'#397de1'}"><span style="width:${Math.min(100,Math.max(0,r.current/r.max*100))}%"></span><strong>${esc(r.current)} / ${esc(r.max)}</strong></div>`:`<div class="resource-symbols">${Array.from({length:Math.min(100,r.max)},(_,i)=>`<span class="resource-symbol ${['circle','triangle','diamond','crystal','gem','orb','flame','star'].includes(r.shape)?r.shape:'circle'} ${i>=r.current?'spent':''}" style="background:${/^#[0-9a-f]{6}$/i.test(r.color)?r.color:'#397de1'}"></span>`).join('')}<small>${esc(r.current)} / ${esc(r.max)}</small></div>`}`).join('')}<div class="model-placeholder"><span>♙</span><strong>${esc(c.race)}</strong><p class="muted">3D-просмотр пока не подключён</p>${safeArmory(c.armory)?`<a target="_blank" rel="noopener noreferrer" href="${esc(c.armory)}">Открыть персонажа ↗</a>`:''}</div>`;
}
function safeArmory(value){try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='wowhead.com'||u.hostname.endsWith('.wowhead.com')||u.hostname==='worldofwarcraft.blizzard.com');}catch{return false;}}
$('#characterSettings').onclick=()=>{
 const c=structuredClone(character());
 const races=['Человек','Орк','Дворф','Ночной эльф','Нежить','Таурен','Гном','Тролль','Эльф крови','Дреней'];
 modal('Ресурсы и персонаж',`${field('characterBudget','ОЧКИ ТАЛАНТОВ',doc.budget,'number','min="0" max="100000" required')}<p class="muted">По умолчанию для ${Math.max(...doc.branches.map(b=>b.rows))} рядов: ${defaultBudget(doc)} очк. (41 за 5 рядов, +5 за каждый следующий).</p><label><input id="autoBudget" type="checkbox" ${doc.budgetAuto?'checked':''}> Рассчитывать автоматически по рядам</label>${field('hp','МАКСИМАЛЬНОЕ ЗДОРОВЬЕ',c.hp,'number','min="1" max="100000000" required')}<div class="two-cols"><div><label>РАСА</label><select id="race">${races.map(r=>`<option ${r===c.race?'selected':''}>${r}</option>`).join('')}</select></div><div><label>ПОЛ</label><select id="gender"><option ${c.gender==='Мужской'?'selected':''}>Мужской</option><option ${c.gender==='Женский'?'selected':''}>Женский</option></select></div></div>${field('armory','ССЫЛКА НА ПЕРСОНАЖА WOWHEAD / WORLD OF WARCRAFT',c.armory,'url')}<p class="muted">Ссылка сохраняется для перехода к персонажу. Она пока не загружает 3D-модель или экипировку.</p><div id="resourceEditor"></div><button type="button" id="addResource">＋ Добавить ресурс</button>`,()=>{
  readResources();c.hp=Number($('#hp').value);c.race=$('#race').value;c.gender=$('#gender').value;c.armory=$('#armory').value;
  if(c.armory&&!safeArmory(c.armory))throw Error('Нужна HTTPS-ссылка на Wowhead или официальный сайт World of Warcraft');
  for(const r of c.resources)if(!r.name.trim()||!Number.isInteger(r.max)||r.max<1||!Number.isInteger(r.current)||r.current<0||r.current>r.max||(r.display==='icons'&&r.max>100))throw Error('Проверь ресурс: максимум от 1, начальное значение от 0 до максимума. Для иконок — до 100.');
  const budget=Number($('#characterBudget').value);if(!Number.isInteger(budget)||budget<0||budget>100000)throw Error('Проверь количество очков');doc.budgetAuto=$('#autoBudget').checked;doc.budget=doc.budgetAuto?defaultBudget(doc):budget;if(!validBuild(doc,doc.build))doc.build={};doc.character=c;changed();render();$('#modal').close();
 });
 function readResources(){for(const [i,r] of c.resources.entries()){const root=$(`[data-resource="${i}"]`);if(!root)continue;for(const key of ['name','max','current','display','shape','color'])r[key]=root.querySelector(`[data-field="${key}"]`).value; r.max=Number(r.max);r.current=Number(r.current);}}
 function draw(){
  $('#resourceEditor').innerHTML=c.resources.map((r,i)=>`<fieldset data-resource="${i}"><legend>Ресурс ${i+1}</legend><label>ТИП</label><select data-type><option value="custom">Свой ресурс</option>${['Мана','Энергия','Ярость'].map(n=>`<option ${r.name===n?'selected':''}>${n}</option>`).join('')}</select><label>НАЗВАНИЕ</label><input data-field="name" value="${esc(r.name)}" required maxlength="60"><div class="two-cols"><div><label>МАКСИМУМ</label><input data-field="max" type="number" min="1" max="100000000" required value="${r.max}"></div><div><label>ПО УМОЛЧАНИЮ</label><input data-field="current" type="number" min="0" required value="${r.current}"></div><div><label>ВИД</label><select data-field="display"><option value="bar" ${r.display==='bar'?'selected':''}>Полоска</option><option value="icons" ${r.display==='icons'?'selected':''}>Иконки</option></select></div><div><label>ФОРМА</label><select data-field="shape">${[['circle','Круг'],['triangle','Треугольник'],['diamond','Ромб'],['crystal','Кристалл'],['gem','Самоцвет'],['orb','Сфера'],['flame','Пламя'],['star','Звезда']].map(([v,n])=>`<option value="${v}" ${r.shape===v?'selected':''}>${n}</option>`).join('')}</select></div></div><label>ЦВЕТ</label><input data-field="color" type="color" value="${esc(r.color)}"><button type="button" data-remove-resource="${i}">Удалить ресурс</button></fieldset>`).join('');
  for(const root of document.querySelectorAll('[data-resource]'))root.querySelector('[data-type]').onchange=e=>{if(e.target.value!=='custom'){root.querySelector('[data-field="name"]').value=e.target.value;root.querySelector('[data-field="color"]').value={'Мана':'#397de1','Энергия':'#ddc742','Ярость':'#d63838'}[e.target.value];}};
  for(const btn of document.querySelectorAll('[data-remove-resource]'))btn.onclick=()=>{readResources();c.resources.splice(Number(btn.dataset.removeResource),1);draw();};
 }
 $('#addResource').onclick=()=>{readResources();c.resources.push({name:'Новый ресурс',max:5,current:5,display:'icons',shape:'diamond',color:'#d63838'});draw();};draw();$('#characterBudget').oninput=()=>$('#autoBudget').checked=false;$('#autoBudget').onchange=()=>{if($('#autoBudget').checked)$('#characterBudget').value=defaultBudget(doc);};
};
function showTooltip(target,x,y){
 if(mode!=='play')return;
 const tip=$('#tooltip');const id=target.dataset.talent;
 const t=doc.branches.flatMap(b=>b.talents).find(t=>t.id===id);
 const a=doc.abilities.find(a=>a.id===target.dataset.ability);
 if(!t&&!a)return;
 if(t){const rank=doc.build[t.id]||0,parent=doc.branches.flatMap(b=>b.talents).find(p=>p.id===t.requires),b=doc.branches.find(b=>b.talents.includes(t));tip.innerHTML=`<strong>${esc(t.name)}</strong><div>Талант · Ранг ${rank}/${t.maxRank}</div>${t.grantedAbilityId?`<div class="spell-stats">${abilityStats(doc.abilities.find(a=>a.id===t.grantedAbilityId)||{}).map(s=>`<span>${esc(s)}</span>`).join('')}</div>`:''}<p class="effect">${esc(t.descriptions[Math.max(0,rank-1)])}</p>${rank>0&&rank<t.maxRank?`<div>Следующий ранг:</div><p class="effect">${esc(t.descriptions[rank])}</p>`:''}<p class="requirements">${t.row?`Требуется ${t.row*doc.rowCost} очк. в ветке ${esc(b.name)}<br>`:''}${parent?'Требуется: '+esc(parent.name)+' ('+parent.maxRank+'/'+parent.maxRank+')':''}</p>`;
 }else tip.innerHTML=`<strong>${esc(a.name)}</strong><div class="muted">${a.kind==='passive'?'Пассивная способность':'Активная способность'}</div><div class="spell-stats"><span>Стоимость: ${esc(abilityCost(a))}</span><span>Дальность: ${esc(a.range===0?'0 м':a.range?a.range+' м':'—')}</span><span>Применение: ${esc(a.cast?a.cast+' сек.':'Мгновенно')}</span><span>Восстановление: ${esc(a.cooldown?a.cooldown+' сек.':'Нет')}</span></div><p class="effect">${esc(a.description)}</p>`;
 tip.hidden=false;const box=tip.getBoundingClientRect();tip.style.left=Math.max(8,Math.min(x+16,innerWidth-box.width-8))+'px';tip.style.top=Math.max(8,Math.min(y+16,innerHeight-box.height-8))+'px';
}
let hoverTarget=null;
document.addEventListener('pointerover',e=>{const target=e.target.closest('[data-talent],[data-ability]');if(target){hoverTarget=target;showTooltip(target,e.clientX,e.clientY);}});
document.addEventListener('pointermove',e=>{if(hoverTarget)showTooltip(hoverTarget,e.clientX,e.clientY);});
document.addEventListener('pointerout',e=>{if(hoverTarget&&!hoverTarget.contains(e.relatedTarget)){hoverTarget=null;$('#tooltip').hidden=true;}});
document.addEventListener('focusin',e=>{if(e.target.matches('[data-talent],[data-ability]')){const r=e.target.getBoundingClientRect();showTooltip(e.target,r.right,r.top);}});
document.addEventListener('focusout',()=>$('#tooltip').hidden=true);
document.addEventListener('click',()=>{hoverTarget=null;$('#tooltip').hidden=true;});

function pickAbilityForTalent(onPick,onBack){
 modal('Добавить способность в талант',`<p class="muted">Выбери способность. Её название, иконка и описание станут основой таланта; способность откроется при изучении таланта.</p><div class="ability-picker-grid">${doc.abilities.map(a=>`<button type="button" data-pick-ability="${esc(a.id)}">${image(a.icon)}<span>${esc(a.name)}</span></button>`).join('')||'<p class="muted">Способностей пока нет. Создай первую ниже.</p>'}</div><div class="talent-source-actions"><button type="button" id="newPickerAbility" class="primary">＋ Добавить способность</button><button type="button" id="backToTalent">← К таланту</button></div>`,null);
 modalCancel=onBack;
 for(const button of document.querySelectorAll('[data-pick-ability]'))button.onclick=()=>{const ability=doc.abilities.find(a=>a.id===button.dataset.pickAbility);$('#modal').close();setTimeout(()=>onPick(ability),0);};
 $('#backToTalent').onclick=()=>{$('#modal').close();setTimeout(onBack,0);};
 $('#newPickerAbility').onclick=()=>{$('#modal').close();setTimeout(()=>editAbility(null,onPick,()=>pickAbilityForTalent(onPick,onBack)),0);};
}
function numericValue(value){const n=Number.parseFloat(value);return Number.isFinite(n)&&n>=0?n:0;}
function resourceOptions(selected){const names=[...new Set(['Здоровье','Мана','Энергия','Ярость',...character().resources.map(r=>r.name),...(selected?[selected]:[])])];return names.map(n=>`<option ${n===(selected||'Мана')?'selected':''}>${esc(n)}</option>`).join('');}
function abilityStats(a){return ['Стоимость: '+abilityCost(a),'Применение: '+(a.cast?a.cast+' сек.':'Мгновенно'),'Восстановление: '+(a.cooldown?a.cooldown+' сек.':'Нет'),'Дальность: '+(a.range||0)+' м'];}
function abilityCost(a){return a.resourceType?`${a.resource??0} ${a.resourceType}`:a.resource||'Нет';}
let draggedTalent=null,draggedAbility=null,abilityDragIcon=null;
$('#trees').addEventListener('dragstart',e=>{const slot=e.target.closest('[data-talent]');if(mode!=='edit'||!slot){e.preventDefault();return;}draggedTalent=slot.dataset.talent;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedTalent);});
$('#trees').addEventListener('dragover',e=>{if(mode==='edit'&&(draggedTalent||draggedAbility)&&e.target.closest('.slot')){e.preventDefault();e.dataTransfer.dropEffect=draggedAbility?'copy':'move';}});
$('#trees').addEventListener('drop',e=>{const slot=e.target.closest('.slot');if(mode!=='edit'||(!draggedTalent&&!draggedAbility)||!slot)return;e.preventDefault();try{if(draggedAbility){if(slot.dataset.talent&&!confirm('Заменить талант выбранной способностью?'))return;doc=placeAbilityTalent(doc,draggedAbility,slot.closest('.tree').dataset.branch,Number(slot.dataset.row),Number(slot.dataset.col),!!slot.dataset.talent);}else doc=moveTalent(doc,draggedTalent,slot.closest('.tree').dataset.branch,Number(slot.dataset.row),Number(slot.dataset.col));changed();render();}catch(err){toast(err.message);}finally{draggedTalent=null;draggedAbility=null;abilityDragIcon?.remove();abilityDragIcon=null;}});
$('#trees').addEventListener('dragend',()=>draggedTalent=null);$('#abilities').addEventListener('dragstart',e=>{const card=e.target.closest('[data-ability]');if(mode!=='edit'||!card){e.preventDefault();return;}draggedAbility=card.dataset.ability;e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('text/plain',draggedAbility);const img=card.querySelector('img');abilityDragIcon=document.createElement('canvas');abilityDragIcon.width=48;abilityDragIcon.height=48;abilityDragIcon.style.cssText='position:fixed;left:-1000px;top:0;width:48px;height:48px;pointer-events:none';const context=abilityDragIcon.getContext('2d');context.fillStyle='#151a1f';context.fillRect(0,0,48,48);if(img?.complete&&img.naturalWidth)context.drawImage(img,2,2,44,44);else{context.fillStyle='#d6ad66';context.font='28px serif';context.fillText('✦',10,34);}context.strokeStyle='#d6ad66';context.strokeRect(1,1,46,46);document.body.append(abilityDragIcon);e.dataTransfer.setDragImage(abilityDragIcon,24,24);});$('#abilities').addEventListener('dragend',()=>{draggedAbility=null;abilityDragIcon?.remove();abilityDragIcon=null;});
let iconCatalog=[...icons],iconPromise=null;
function loadIconCatalog(){
 return iconPromise??=fetch('icon-catalog.json').then(r=>{if(!r.ok)throw Error('Иконки недоступны');return r.json();}).then(list=>{const combined=new Map();for(const i of [...icons,...list]){const previous=combined.get(i.id);combined.set(i.id,{id:i.id,label:(previous?previous.label+' ':'')+i.label});}iconCatalog=[...combined.values()];return iconCatalog;}).catch(e=>{iconPromise=null;throw e;});
}
function favoriteButton(kind,getItem){
 const button=$('#favoriteItem');button.hidden=false;
 button.onclick=async()=>{if(!user){toast('Войди в аккаунт, чтобы сохранять избранное');return;}try{if(!$('#modalForm').reportValidity())return;await modalSave();const item=getItem();if(!item)return;await api('/favorites',{kind,item});toast('Сохранено в избранное аккаунта');}catch(err){toast(err.message);}};
}
let favoritePlacement=null;
$('#favorites').onclick=()=>openLibrary('favorites');
async function showFavorites(target=null){
 if(!target){openLibrary('favorites');return;}
 if(!user){auth();return;}
 try{const {favorites}=await api('/favorites');modal('Избранные таланты и способности',`<p class="muted">Добавляются независимые копии. Зависимости от исходного дерева не переносятся.</p><div class="favorite-list">${favorites.filter(f=>!target||f.kind==='talent').map(f=>`<div class="favorite-row">${image(f.item.icon)}<span><strong>${esc(f.item.name)}</strong><br><small>${f.kind==='talent'?'Талант':'Способность'}</small></span><button type="button" data-use-favorite="${esc(f.id)}">Добавить</button><button type="button" data-delete-favorite="${esc(f.id)}" aria-label="Удалить из избранного">×</button></div>`).join('')||'<p>Здесь пока пусто. Открой талант или способность и нажми «В избранное».</p>'}</div>`,null);
 for(const button of document.querySelectorAll('[data-delete-favorite]'))button.onclick=async()=>{try{await api('/favorites/'+button.dataset.deleteFavorite,{},'DELETE');button.closest('.favorite-row').remove();}catch(e){toast(e.message);}};
 for(const button of document.querySelectorAll('[data-use-favorite]'))button.onclick=()=>{const f=favorites.find(f=>f.id===button.dataset.useFavorite);$('#modal').close();showWorkspace();if(mode!=='edit'){mode='edit';render();}if(f.kind==='ability'){doc.abilities.push({...structuredClone(f.item),id:crypto.randomUUID(),talentId:'',branchId:''});changed();render();toast('Способность добавлена');}else if(target){placeFavorite(f.item,target);}else{favoritePlacement=structuredClone(f.item);toast('Нажми на пустую ячейку для размещения таланта');}};
 }catch(err){toast(err.message);}
}
function placeFavorite(item,target){const b=doc.branches.find(b=>b.id===target.branchId);if(!b||b.talents.some(t=>t.row===target.row&&t.col===target.col)||reserved(b,target.row,target.col)){toast('Ячейка занята талантом или стрелкой');return;}const copy={...structuredClone(item),id:crypto.randomUUID(),row:target.row,col:target.col,requires:''};delete copy.grantedAbilityId;b.talents.push(copy);favoritePlacement=null;changed();render();toast('Талант добавлен из избранного');}

let activeShare=null,allocationSent=false,activePublication=null;
const communityState={scope:'rankings',sort:'views',page:0};
const undoStates=[],redoStates=[];let historyCurrent=null;
function snapshot(){return JSON.stringify({document:doc,projectId,share:activeShare});}
function remember(){const next=snapshot();if(historyCurrent&&next!==historyCurrent){undoStates.push(historyCurrent);if(undoStates.length>100)undoStates.shift();redoStates.length=0;}historyCurrent=next;updateHistoryButtons();}
function resetHistory(){undoStates.length=0;redoStates.length=0;historyCurrent=snapshot();updateHistoryButtons();}
function updateHistoryButtons(){$('#undo').disabled=!undoStates.length;$('#redo').disabled=!redoStates.length;}
function restoreHistory(redo=false){const from=redo?redoStates:undoStates,to=redo?undoStates:redoStates;if(!from.length)return;to.push(snapshot());const state=JSON.parse(from.pop());doc=normalize(state.document,{allowLegacy:true});projectId=state.projectId;activeShare=state.share;historyCurrent=snapshot();dirty=true;try{localStorage.setItem('talentforge-draft',JSON.stringify(doc));}catch{}render();$('#saveState').textContent='Есть несохранённые изменения';refreshShareStats();}
$('#undo').onclick=()=>restoreHistory();$('#redo').onclick=()=>restoreHistory(true);
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.target.closest('input,textarea,select')&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();restoreHistory(e.key.toLowerCase()==='y'||e.shiftKey);}});
document.addEventListener('click',e=>{if(!user&&e.target.closest('#new,#editMode,#export,#import,#characterSettings,#addBranch,#addAbility')){e.preventDefault();e.stopImmediatePropagation();auth();}},true);
function showShareStats(stats){$('#shareStats').hidden=!activeShare||!$('#community').hidden||!$('#library').hidden;if(activeShare&&stats)$('#shareStats').textContent=`Распределяли очки: ${stats.allocated} · Сохранили себе: ${stats.saved}`;}
async function refreshShareStats(){if(!activeShare){$('#shareStats').hidden=true;return;}const token=activeShare,viewer=user?.login;try{const result=await api('/shared/'+encodeURIComponent(token));if(token===activeShare&&viewer===user?.login){showShareStats(result.stats);showPublication(result.publication);}}catch{}}
async function trackAllocation(){if(!activeShare||allocationSent)return;allocationSent=true;const token=activeShare;try{const result=await api('/shared/'+encodeURIComponent(token)+'/interact',{});if(activeShare===token){showShareStats(result.stats);showPublication(result.publication);}}catch{allocationSent=false;}}

function showPublication(info){
 if(!activeShare||!info){$('#publicationBar').hidden=true;return;}if(info.token!==activeShare)return;activePublication=info;if(!$('#community').hidden||!$('#library').hidden){$('#publicationBar').hidden=true;return;}
 const owner=!!user&&info.isOwner&&info.author?.toLowerCase()===user.login.toLowerCase();
 $('#publicationBar').hidden=false;$('#publicationBar').innerHTML=`<div><strong>${esc(info.name)}</strong><p class="muted">${esc(info.author||'Автор старой ссылки не указан')} · Версия ${info.version} · ${info.visibility==='public'?'Общедоступное':'Только по ссылке'} · Просмотры: ${info.views}</p></div><div class="vote-controls"><button id="likePublication" aria-pressed="${info.myVote===1}" ${owner?'disabled title="Нельзя оценивать свою публикацию"':''}>👍 ${info.likes}</button><button id="dislikePublication" aria-pressed="${info.myVote===-1}" ${owner?'disabled title="Нельзя оценивать свою публикацию"':''}>👎</button>${owner?`<small>Дизлайки: ${info.dislikes??0} · Видно только тебе</small>`:''}</div>`;
 for(const [id,vote]of [['likePublication',1],['dislikePublication',-1]])$('#'+id).onclick=async()=>{if(!user){auth();return;}for(const b of document.querySelectorAll('.vote-controls button'))b.disabled=true;try{const result=await api('/shared/'+encodeURIComponent(activeShare)+'/vote',{vote});showPublication(result.publication);}catch(err){toast(err.message);showPublication(activePublication);}};
}
async function openPublication(token){
 if(dirty&&!confirm('Открыть опубликованную версию и заменить текущий черновик?'))return;
 const result=await api('/shared/'+encodeURIComponent(token));doc=normalize(result.document,{allowLegacy:true});projectId=null;activeShare=token;allocationSent=false;dirty=false;mode='play';resetHistory();showWorkspace();showShareStats(result.stats);showPublication(result.publication);render();$('#saveState').textContent='Копия опубликованной версии';const url=new URL(location.href);url.search='';url.searchParams.set('share',token);history.replaceState(null,'',url);
}
$('#rankings').onclick=()=>openCommunity('rankings');$('#publications').onclick=()=>{if(!user){auth();return;}openCommunity('mine');};
async function openCommunity(scope='rankings'){
 if(scope!==communityState.scope)communityState.page=0;communityState.scope=scope;
 const mine=scope==='mine';if(mine&&!user){auth();return;}
 closeMenus();$('#library').hidden=true;$('#community').hidden=false;$('.workspace').hidden=true;$('#publicationBar').hidden=true;$('#shareStats').hidden=true;updateNavigation();
 $('#community').innerHTML=`<div class="community-heading"><div><p class="eyebrow">${mine?'ТВОЯ МАСТЕРСКАЯ':'СООБЩЕСТВО'}</p><h2>${mine?'Мои публикации':'Рейтинг деревьев'}</h2></div><button id="closeCommunity">${glyph('arrow')}К калькулятору</button></div>${mine?'':`<div class="ranking-tabs">${[['likes','По рейтингу'],['views','Самые просматриваемые'],['usage','Чаще используют калькулятор'],['latest','Последние опубликованные']].map(([sort,name])=>`<button data-sort="${sort}" aria-label="${name}" aria-pressed="${sort===communityState.sort}" class="${sort===communityState.sort?'selected':''}"><span class="ranking-symbol">${glyph(({likes:'trophy',views:'eye',usage:'calculator',latest:'clock'})[sort])}</span><span class="tab-label-full">${name}</span><span class="tab-label-short">${({likes:'Рейтинг',views:'Просмотры',usage:'Калькулятор',latest:'Новые'})[sort]}</span></button>`).join('')}</div>`}<div class="list-tools"><label class="search-field">${glyph('search')}<input id="publicationSearch" type="search" placeholder="Поиск на этой странице" aria-label="Поиск публикаций на текущей странице"></label><span id="searchResultCount" class="muted" role="status"></span></div><div id="publicationCards" class="publication-cards" aria-busy="true"><div class="loading-state"><span class="spinner"></span>Загружаем деревья…</div></div><div id="publicationPagination" class="publication-pagination"></div>`;
 $('#closeCommunity').onclick=()=>{showWorkspace();render();if(activeShare){showPublication(activePublication);refreshShareStats();}};
 for(const b of document.querySelectorAll('[data-sort]'))b.onclick=()=>{communityState.sort=b.dataset.sort;communityState.page=0;openCommunity('rankings');};
 const requested={...communityState},viewer=user?.login;
 try{
  const result=await api(mine?'/publications?page='+requested.page:'/rankings?sort='+requested.sort+'&page='+requested.page);
  if(JSON.stringify(requested)!==JSON.stringify(communityState)||viewer!==user?.login||$('#community').hidden)return;
  $('#publicationCards').setAttribute('aria-busy','false');
  $('#publicationCards').innerHTML=result.publications.length?result.publications.map((p,index)=>publicationRow(p,{mine,index,page:requested.page,sort:requested.sort,image,avatarMarkup})).join(''):'<div class="empty library-empty">'+glyph(mine?'layers':'trophy')+'<strong>'+(mine?'Твоя первая публикация впереди':'Здесь появятся новые легенды')+'</strong><p>'+(mine?'Сохрани дерево и нажми «Зафиксировать и опубликовать».':'Общедоступные зафиксированные деревья попадут в этот рейтинг.')+'</p></div>';
  $('#publicationSearch').oninput=()=>{const query=$('#publicationSearch').value.toLocaleLowerCase('ru');let visible=0;for(const row of document.querySelectorAll('.publication-row')){row.hidden=!row.textContent.toLocaleLowerCase('ru').includes(query);if(!row.hidden)visible++;}$('#searchResultCount').textContent=query?`Найдено на странице: ${visible}`:'';};
  for(const b of document.querySelectorAll('[data-open-publication]'))b.onclick=()=>openPublication(b.dataset.openPublication).catch(e=>toast(e.message));
  for(const row of document.querySelectorAll('[data-publication-row]'))row.onclick=e=>{if(e.target.closest('button,select,label,a'))return;openPublication(row.dataset.publicationRow).catch(err=>toast(err.message));};
  for(const b of document.querySelectorAll('[data-edit-project]'))b.onclick=()=>loadWorkingProject(b.dataset.editProject).catch(e=>toast(e.message));
  for(const b of document.querySelectorAll('[data-copy-link]'))b.onclick=async()=>{const url=new URL(location.href);url.search='';url.searchParams.set('share',b.dataset.copyLink);url.hash='';try{await navigator.clipboard.writeText(url.href);toast('Ссылка скопирована');}catch{modal('Ссылка на публикацию',field('shareURL','ССЫЛКА',url.href,'text','readonly'),null);$('#shareURL').select();}};
  for(const select of document.querySelectorAll('[data-visibility]'))select.onchange=async()=>{select.disabled=true;try{await api('/publications/'+select.dataset.visibility+'/visibility',{visibility:select.value});openCommunity('mine');}catch(err){toast(err.message);openCommunity('mine');}};
  $('#publicationPagination').innerHTML=`<button id="previousPublications" ${requested.page?'':'disabled'}>← Назад</button><span>Страница ${requested.page+1}</span><button id="nextPublications" ${result.hasMore?'':'disabled'}>Далее →</button>`;
  $('#previousPublications').setAttribute('aria-label','Предыдущая страница');$('#nextPublications').setAttribute('aria-label','Следующая страница');
  $('#previousPublications').onclick=()=>{communityState.page--;openCommunity(scope);};$('#nextPublications').onclick=()=>{communityState.page++;openCommunity(scope);};
 }catch(err){const cards=$('#publicationCards');if(cards){cards.setAttribute('aria-busy','false');cards.textContent=err.message;}}
}
initUI();
resetHistory();
render();api('/me').then(result=>{user=result.user;if(user&&!activeShare)mode='edit';renderUser();render();}).catch(()=>toast('Сервер недоступен. Проверь подключение и перезагрузи страницу.'));
const sharedToken=new URLSearchParams(location.search).get('share');
if(sharedToken) api('/shared/'+encodeURIComponent(sharedToken)).then(result=>{
 if(dirty&&!confirm('Открыть класс по ссылке и заменить черновик?'))return;
 doc=normalize(result.document,{allowLegacy:true});projectId=null;activeShare=sharedToken;showShareStats(result.stats);showPublication(result.publication);mode='play';resetHistory();render();$('#saveState').textContent='Копия класса по ссылке';toast('Открыта копия класса. Изменения не затрагивают оригинал.');
}).catch(err=>toast(err.message));
