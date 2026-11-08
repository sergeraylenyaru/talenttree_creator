import {abilityStatLines,equipmentRequirementLabels} from './ability-format.js';
import {matchesIconSearch} from './icon-search.js';
import {initIconFitting} from './icon-fit.js';
import {aboutMarkup} from './about.js';
import {characterBuilder,armorTypes,weaponTypes,equipmentIcons} from './character-builder.js';
import './translations.js';
import {t,getLanguage,setLanguage,initLanguage} from './i18n.js';
import {withoutBuild,restoreBrowserBuild,saveBrowserBuild} from './browser-build.js';
import {classEmblem,defaultClassIcon} from './class-emblem.js';
import {glyph,initUI,notify,notificationUser,closeMenus} from './ui.js';
import {publicationRow} from './publication-view.js';
import {createRankEditor} from './rank-editor.js';
import {blank,branch,total,validBuild,changeRank,normalize,route,reserved,moveTalent,defaultBudget,abilityTalentDraft,placeAbilityTalent,synchronizeAbilityTalents,abilityUnlocked,removeAbility,dependencyRoutes,talentState,branchIcon,groupedAbilities} from './engine.js';
import {icons,iconURL} from './icons.js';
const $=s=>document.querySelector(s);
const confirm=message=>window.confirm(t(message));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let aboutContent=null,aboutRequest=0;
let doc=blank(), projectId=null, user=null, mode='play', modalSave=null, modalDelete=null, dirty=false,modalCancel=null,abilityView='icons',favoriteTreeId=null;
doc.name=t('Новый класс');doc.branches.forEach((b,i)=>b.name=t('Ветка')+' '+(i+1));
try { const draft=JSON.parse(localStorage.getItem('talentforge-draft')); if(draft){doc=normalize(draft,{allowLegacy:true});dirty=localStorage.getItem('talentforge-draft-dirty')==='1';} } catch {}
function toast(message) { notify(message); $('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,4200); }
function persistBrowserBuild(){try{if(activeShare)saveBrowserBuild(doc,'share:'+activeShare);if(projectId)saveBrowserBuild(doc,'project:'+projectId);if(favoriteTreeId)saveBrowserBuild(doc,'favorite:'+favoriteTreeId);}catch{toast('Браузер не сохранил распределение очков.');}}
function setDirty(value){dirty=value;try{localStorage.setItem('talentforge-draft-dirty',value?'1':'0');}catch{}}
function persistDraft(){localStorage.removeItem('talentforge-draft-source');localStorage.setItem('talentforge-draft',JSON.stringify(doc));if(projectId&&user)localStorage.setItem('talentforge-draft-source',JSON.stringify({projectId,ownerLogin:user.login}));}
async function restoreDraftProject(){
 const restored=doc,login=user?.login;if(!login||projectId)return;
 try{const source=JSON.parse(localStorage.getItem('talentforge-draft-source'));if(source?.ownerLogin!==login||!source.projectId)return;await api('/projects/'+encodeURIComponent(source.projectId));if(doc===restored&&user?.login===login&&!activeShare&&!projectId)projectId=source.projectId;}catch{}
}
function changed(structural=true) { synchronizeAbilityTalents(doc);persistBrowserBuild();remember();if(structural)setDirty(true);$('#saveState').textContent='Есть несохранённые изменения';try{persistDraft();}catch{toast('Браузер не сохранил черновик. Экспортируй класс в JSON.');} }
async function api(path, data, method) {
 const options={method:method||(data?'POST':'GET'),headers:{'Content-Type':'application/json'}};
 if(data) options.body=JSON.stringify(data);
 const response=await fetch('/api'+path,options);
 const result=await response.json();if(!response.ok) throw Error(result.error||'Ошибка сервера');return result;
}
function image(id,extra='') { return `<img data-fit-icon src="${esc(iconURL(id))||'missing-icon'}" alt="" loading="lazy" draggable="false" ${extra}>`; }
document.addEventListener('error',e=>{if(e.target.tagName==='IMG'){e.target.style.visibility='hidden';e.target.alt='Иконка недоступна';}},true);
function syncHero(){const inTree=!$('.workspace').hidden;$('.intro').hidden=inTree||!$('#aboutPage').hidden;$('#treeHero').hidden=!inTree;$('#modeBar').hidden=!inTree;}
function showWorkspace(){closeMenus();$('#aboutPage').hidden=true;if(location.hash==='#about')history.replaceState(null,'',location.pathname+location.search);$('#library').hidden=true;$('#community').hidden=true;$('.workspace').hidden=false;document.body.dataset.view='editor';syncHero();}
function branchTint(b){return /^#[0-9a-f]{6}$/i.test(b?.color||'')?`style="background:linear-gradient(135deg,${b.color}66,#0b0d12e6)"`:'';}
function render() {if(!$('#aboutPage').hidden&&aboutContent)$('#aboutContent').innerHTML=aboutMarkup(aboutContent,getLanguage());hoverTarget=null;$('#tooltip').hidden=true;
 synchronizeAbilityTalents(doc);renderCharacter();updateHistoryButtons();if(!activeShare){$('#shareStats').hidden=true;$('#publicationBar').hidden=true;$('#publicationVotes').hidden=true;}
 $('#trees').style.setProperty('--tree-count',Math.min(4,doc.branches.length));
 $('#classIcon').innerHTML=classEmblem(doc.classIcon,branchIcon(doc.branches[0]));$('#classIcon').disabled=mode!=='edit';
 $('#treeSubtitle').textContent=doc.subtitle||'';$('#treeSubtitle').hidden=mode==='edit'||!doc.subtitle;$('#classSubtitle').value=doc.subtitle||'';$('#classSubtitle').hidden=mode!=='edit';$('#classSubtitle').disabled=mode!=='edit';$('#classDescription').value=doc.description||'';$('#classDescriptionEditor').hidden=mode!=='edit';$('#classDescriptionView').textContent=doc.description||'';$('#classDescriptionView').hidden=mode==='edit'||!doc.description;
 $('#treeTitle').textContent=doc.name;$('#treeTitle').hidden=mode==='edit';$('#className').hidden=mode!=='edit';$('#heroBranches').innerHTML=doc.branches.map(b=>`<button type="button" data-hero-branch="${esc(b.id)}" title="Перейти к ветке: ${esc(b.name)}" aria-label="Перейти к ветке ${esc(b.name)}">${image(branchIcon(b))}</button>`).join('');
 $('#className').value=doc.name;$('#budget').value=doc.budget;$('#rowCost').value=doc.rowCost;
 $('#points').textContent=`${total(doc)} / ${doc.budget}`;
 const track=$('.budget-track');track.setAttribute('aria-valuemax',doc.budget);track.setAttribute('aria-valuenow',total(doc));track.firstElementChild.style.width=`${doc.budget?Math.min(100,total(doc)/doc.budget*100):0}%`;
 updateNavigation();$('.workspace').dataset.mode=mode;$('#modeBar').dataset.mode=mode;$('#chooseFavorite').hidden=mode!=='play'||!user;
 for(const id of ['className','budget','rowCost']) $('#'+id).disabled=mode!=='edit';
 const foreign=!!activeShare&&!activePublication?.isOwner;$('#editMode').hidden=foreign;$('#copyToSelf').hidden=!foreign;
 $('#editMode').classList.toggle('selected',mode==='edit');$('#playMode').classList.toggle('selected',mode==='play');$('#editMode').setAttribute('aria-pressed',String(mode==='edit'));$('#playMode').setAttribute('aria-pressed',String(mode==='play'));
 $('#addBranch').hidden=mode!=='edit';$('#addBranch').disabled=doc.branches.length>=4;$('#addAbility').hidden=mode!=='edit';
 $('#hint').hidden=mode==='play';$('#hint').textContent=doc.branches.length>4?'В старом классе пять веток. Удали лишнюю перед сохранением; данные пока сохранены.':'Нажми на пустую ячейку, чтобы создать талант.';
 $('#trees').innerHTML=doc.branches.map(b=>`<article class="tree" ${branchTint(b)} data-branch="${esc(b.id)}"><div class="tree-header"><button class="branch-icon-button" data-action="branch-icon" title="Выбрать иконку ветки" aria-label="Иконка ветки ${esc(b.name)}" ${mode!=='edit'?'disabled':''}>${image(branchIcon(b))}</button><input aria-label="Название ветки" value="${esc(b.name)}" maxlength="80" ${mode!=='edit'?'disabled':''}><span>${b.talents.reduce((s,t)=>s+(doc.build[t.id]||0),0)} очк.</span>${mode==='edit'?'<button data-action="branch-color" aria-label="Цвет фона ветки" title="Цвет фона ветки">◐</button><button data-action="delete-branch" aria-label="Удалить ветку">×</button>':''}</div><div class="talent-grid">${Array.from({length:b.rows*4},(_,i)=>{
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
 const compact=abilityView==='icons';$('#abilityViewControls').hidden=false;
 for(const button of document.querySelectorAll('[data-ability-view]')){const selected=button.dataset.abilityView===abilityView;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}
 function card(a){const unlocked=abilityUnlocked(doc,a);return `<button class="ability-card ${compact?'ability-icon':''} ${mode==='play'&&!unlocked?'locked':''}" data-ability="${esc(a.id)}" draggable="${mode==='edit'}" aria-label="${esc(a.name)} — ${a.kind==='passive'?'пассивная':'активная'}"><span class="ability-fallback">✦</span>${image(a.icon)}${compact?'':`<div><strong data-user-content>${esc(a.name)}</strong><p>${esc(a.description)}</p><p class="interface-text">${abilityStats(a).map(esc).join(' · ')}</p></div>`}</button>`;}
 $('#abilities').innerHTML=groupedAbilities(doc).map((row,i)=>`<section class="ability-band branch-theme-${i%4}" ${branchTint(doc.branches.find(b=>b.id===row.id))} data-ability-band="${esc(row.id)}"><div class="ability-band-label" role="img" aria-label="${esc(row.name)}" title="${esc(row.name)}">${image(row.icon)}</div><div class="ability-band-content">${[['active','Активные'],['passive','Пассивные']].map(([kind,name])=>`<div class="ability-type-section" data-ability-kind="${kind}"><h4>${name} <span>${row[kind].length}</span></h4><div class="ability-items ${compact?'icons':'details'}">${row[kind].map(card).join('')||'<span class="muted">Нет способностей</span>'}</div></div>`).join('')}</div></section>`).join('');
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
/* Legacy viewport controls removed; branches use the responsive layout. */
window.addEventListener('resize',drawDependencies);
function modal(title, body, save, remove) {
 $('#modal').classList.remove('avatar-picker','compact-emblem-dialog','character-builder-dialog','auth-dialog','ability-editor-dialog','talent-editor-dialog');modalCancel=null;$('#favoriteItem').hidden=true;
 $('#modalTitle').toggleAttribute('data-user-content',[...doc.branches.flatMap(b=>b.talents),...doc.abilities].some(x=>x.name===title));$('#modalTitle').textContent=title;$('#modalBody').innerHTML=body;$('#formError').textContent='';modalSave=save;modalDelete=remove;
 $('#submitModal').textContent='Сохранить';$('#submitModal').hidden=!save;$('#deleteItem').hidden=!remove;$('#modal').showModal();
}
$('#closeModal').onclick=()=>{const back=modalCancel;modalCancel=null;$('#modal').close();if(back)setTimeout(back,0);};$('#modal').addEventListener('cancel',e=>{if(modalCancel){e.preventDefault();$('#closeModal').click();}});
$('#modalForm').onsubmit=async e=>{e.preventDefault();$('#formError').textContent='';const button=$('#submitModal');button.disabled=true;button.setAttribute('aria-busy','true');try{if(modalSave) await modalSave();}catch(err){$('#formError').textContent=err.message;}finally{button.disabled=false;button.setAttribute('aria-busy','false');}};
$('#deleteItem').onclick=()=>modalDelete?.();
function field(id,label,value='',type='text',attrs=''){return `<label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(value)}" ${attrs}>`;}
function refreshIconCategoryOptions(){const select=$('#iconCategory');if(!select)return;const current=select.value;select.innerHTML=`<option value="all">Все иконки</option><option value="weapons">Оружие и щиты</option><option value="armor">Доспехи</option>${iconCategories.filter(c=>!['general','weapon','armor'].includes(c.id)).map(c=>`<option data-user-content value="category:${esc(c.id)}">${esc(c.name)}</option>`).join('')}`;if([...select.options].some(o=>o.value===current))select.value=current;}
function iconMatchesCategory(i,value){if(value==='all')return true;if(value==='weapons')return i.categoryKind==='weapon'||i.category==='weapon'||/^inv_(?:sword|axe|mace|hammer|staff|wand|weapon|bow|crossbow|musket|spear|throwing|knife|shield|polearm)/i.test(i.id);if(value==='armor')return i.categoryKind==='armor'||i.category==='armor'||/^inv_(?:chest|helmet|shoulder|pants|belt|boots|bracer|shield)/i.test(i.id);return i.category===value.replace(/^category:/,'');}
function iconPicker(selected='inv_misc_questionmark'){
 return `<div class="compact-icon-picker"><button type="button" id="toggleIconPicker" class="icon-picker-trigger" aria-expanded="false" aria-controls="iconPickerOptions"><span class="icon-picker-thumb"><span class="icon-picker-fallback">?</span>${image(selected,'id="iconPreview"')}</span><span id="iconPickerCaption">${selected==='inv_misc_questionmark'?'Выбрать иконку':'Изменить иконку'}</span><span aria-hidden="true">⌄</span></button><div id="iconPickerOptions" class="icon-picker-options" hidden><label for="iconSearch">ИКОНКА · ПОИСК ПО НАЗВАНИЮ ИЛИ ТЕГАМ</label><input id="iconSearch" type="search" placeholder="Название или теги: лёд, frost, маг…" autocomplete="off"><label for="iconCategory">КАТЕГОРИЯ</label><select id="iconCategory"><option value="all">Все иконки</option></select><div id="iconGrid" class="icon-grid"></div>${field('iconName','ПРЯМОЕ ИМЯ WOW-ИКОНКИ',/^[a-z0-9_]+$/i.test(selected)?selected:'','text',`pattern="[A-Za-z0-9_]+" data-initial="${esc(selected)}"`)}<small id="iconCount" class="muted" role="status">Загрузка каталога…</small></div></div>`;
}
function readIcon(){return $('#iconName').value.toLowerCase()||$('#iconName').dataset.initial||'inv_misc_questionmark';}
function bindPicker(){
 let started=false;
 const update=()=>{if(!$('#iconGrid'))return;const found=iconCatalog.filter(i=>iconMatchesCategory(i,$('#iconCategory').value)&&matchesIconSearch(i,$('#iconSearch').value));$('#iconCount').textContent=`Найдено: ${found.length} · Каталог: ${iconCatalog.length} иконок`;$('#iconGrid').innerHTML=found.map(i=>`<button type="button" class="icon-choice ${i.id===readIcon()?'active':''}" data-icon="${esc(i.id)}" ${i.id.startsWith('custom:')?'data-user-content':''} title="${esc(i.label+(i.tags?' · '+i.tags:''))}">${image(i.id)}</button>`).join('')||'<p class="icon-search-empty">Ничего не найдено. Измени запрос или категорию.</p>';};
 function open(value){$('#iconPickerOptions').hidden=!value;$('#toggleIconPicker').setAttribute('aria-expanded',String(value));if(value&&!started){started=true;$('#iconGrid').setAttribute('aria-busy','true');loadIconCatalog(update).then(update).catch(()=>toast('Не удалось загрузить каталог иконок. Попробуй открыть выбор ещё раз.')).finally(()=>$('#iconGrid')?.setAttribute('aria-busy','false'));}}
 $('#toggleIconPicker').onclick=()=>open($('#iconPickerOptions').hidden);
 refreshIconCategoryOptions();$('#iconSearch').oninput=update;$('#iconCategory').onchange=update;
 const preview=()=>{$('#iconPreview').style.visibility='visible';$('#iconPreview').src=iconURL(readIcon())||'missing-icon';$('#iconPickerCaption').textContent='Изменить иконку';};
 $('#iconGrid').onclick=e=>{const btn=e.target.closest('[data-icon]');if(btn){$('#iconName').dataset.initial=btn.dataset.icon;$('#iconName').value=/^[a-z0-9_]+$/i.test(btn.dataset.icon)?btn.dataset.icon:'';preview();update();open(false);}};
 $('#iconName').oninput=preview;update();
}
function editTalent(b,row,col,existing,draft){
 const t=draft||existing||{id:crypto.randomUUID(),row,col,name:'',icon:'inv_misc_questionmark',maxRank:1,descriptions:[''],requires:''};
 if(t.grantedAbilityId){editAbilityPlacement(b,t,existing);return;}
 let rankEditor;
 function eligible(p){const candidate=p;if(p.id===t.id||p.row>t.row)return false;const seen=new Set();while(p.requires){if(p.requires===t.id||seen.has(p.id))return false;seen.add(p.id);p=b.talents.find(x=>x.id===p.requires);if(!p)return false;}return !!route(b,candidate,t);}
 modal(existing?'Редактировать талант':'Новый талант',`<div class="talent-identity"><div>${field('talentName','НАЗВАНИЕ',t.name,'text','required maxlength="100"')}</div>${iconPicker(t.icon)}</div>`+`<div class="two-cols"><div>${field('maxRank','КОЛИЧЕСТВО РАНГОВ',t.maxRank,'number','min="1" max="100" required')}</div><div><label for="requires">ТРЕБУЕТ ТАЛАНТ (ПОЛНЫЙ РАНГ)</label><select id="requires"><option value="">Без зависимости</option>${t.requires&&!b.talents.filter(eligible).some(p=>p.id===t.requires)?`<option value="${esc(t.requires)}" selected>Текущая зависимость: нужно изменить маршрут</option>`:''}${b.talents.filter(eligible).map(p=>`<option data-user-content value="${esc(p.id)}" ${t.requires===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div></div><div id="rankFields" class="rank-editor"></div>`,()=>{
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
 $('#modal').classList.add('talent-editor-dialog');$('#modalBody').insertAdjacentHTML('afterbegin','<div class="talent-source-actions"><button type="button" id="pickFavorite">★ Взять из избранного</button><button type="button" id="pickAbility">＋ Добавить способность</button></div>');
 $('#pickFavorite').hidden=!!existing;$('#pickFavorite').onclick=()=>{$('#modal').close();showFavorites({branchId:b.id,row,col});};
 $('#pickAbility').onclick=()=>{const saved={...t,...rankEditor.draft(),name:$('#talentName').value,icon:readIcon(),maxRank:Number($('#maxRank').value),requires:$('#requires').value};if(!rankEditor.draft().rankTemplate)delete saved.rankTemplate;const reopen=()=>editTalent(b,row,col,existing,saved);$('#modal').close();setTimeout(()=>pickAbilityForTalent(ability=>editTalent(b,row,col,existing,abilityTalentDraft(ability,saved)),reopen),0);};
 rankEditor=createRankEditor($('#rankFields'),$('#maxRank'),t,{name:()=>$('#talentName').value,icon:readIcon});$('#talentName').addEventListener('input',()=>rankEditor.refresh());$('#iconName').addEventListener('input',()=>rankEditor.refresh());bindPicker();$('#iconGrid').addEventListener('click',()=>rankEditor.refresh());favoriteButton('talent',()=>b.talents.find(x=>x.id===t.id));
}
function editAbilityPlacement(b,t,existing){
 const ability=doc.abilities.find(a=>a.id===t.grantedAbilityId);if(!ability){toast('Способность не найдена');return;}
 function eligible(p){if(p.id===t.id||p.row>t.row)return false;let current=p;const seen=new Set();while(current.requires){if(current.requires===t.id||seen.has(current.id))return false;seen.add(current.id);current=b.talents.find(x=>x.id===current.requires);if(!current)return false;}return !!route(b,p,t);}
 modal('Зависимость: '+ability.name,`<label for="requires">ТРЕБУЕТ ТАЛАНТ (ПОЛНЫЙ РАНГ)</label><select id="requires"><option value="">Без зависимости</option>${t.requires&&!b.talents.filter(eligible).some(p=>p.id===t.requires)?`<option value="${esc(t.requires)}" selected>Текущая зависимость: нужно изменить маршрут</option>`:''}${b.talents.filter(eligible).map(p=>`<option data-user-content value="${esc(p.id)}" ${t.requires===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select><p class="muted">Название, иконка и описание берутся из способности и изменяются в списке способностей.</p>`,()=>{const updated=abilityTalentDraft(ability,{...t,requires:$('#requires').value});if([...dependencyRoutes({...b,talents:b.talents.filter(x=>x.id!==updated.id).concat(updated)}).values()].some(p=>!p))throw Error('Стрелки пересекаются или нет свободного пути. Измени зависимость.');if(existing)b.talents[b.talents.indexOf(existing)]=updated;else b.talents.push(updated);if(!existing){ability.learningMode='talent';ability.talentId='';}if(!validBuild(doc,doc.build))doc.build={};changed();render();$('#modal').close();},existing?()=>{if(!confirm('Убрать способность из этой ячейки?'))return;b.talents=b.talents.filter(x=>x.id!==t.id);for(const p of b.talents)if(p.requires===t.id)p.requires='';for(const a of doc.abilities)if(a.talentId===t.id)a.talentId='';doc.build={};changed();render();$('#modal').close();}:null);
}
function editAbility(existing,onSaved=null,onCancel=null){
 const a=existing||{id:crypto.randomUUID(),name:'',description:'',icon:'inv_misc_questionmark',resourceUnit:'percent',resource:'',cast:'',cooldown:'',range:'',talentId:'',requirements:[],learningMode:'base'};
 if(mode==='play'){modal(a.name,`<p class="tooltip-description">${esc(a.description)}</p><div class="spell-stats">${abilityStats(a).map(line=>`<span>${esc(line)}</span>`).join('')}</div>`,null);readOnlyFavorite('ability',a);return;}
 const learning=a.learningMode||((a.talentId||doc.branches.some(b=>b.talents.some(t=>t.grantedAbilityId===a.id)))?'talent':'base');
 const requirementValues=[...new Set([...equipmentRequirementLabels,...(character().customArmorTypes||[]).map(v=>v.name),...(character().customWeaponTypes||[]).map(v=>v.name),...(a.requirements||[])])];
 const identity=`<div class="ability-identity"><div>${field('abilityName','НАЗВАНИЕ',a.name,'text','required maxlength="100"')}</div>${iconPicker(a.icon)}</div>`;
 const selectors=`<div class="ability-selectors"><div><label for="abilityKind">ТИП СПОСОБНОСТИ</label><select id="abilityKind"><option value="active" ${a.kind!=='passive'?'selected':''}>Активная</option><option value="passive" ${a.kind==='passive'?'selected':''}>Пассивная</option></select></div><div><label for="abilityBranch">ВЕТКА</label><select id="abilityBranch"><option value="auto" ${a.branchId===undefined||a.branchId==='auto'?'selected':''}>По размещению в дереве</option><option value="" ${a.branchId===''?'selected':''}>Общая — без ветки</option>${doc.branches.map(b=>`<option data-user-content value="${esc(b.id)}" ${a.branchId===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div></div>`;
 const costs=`<div class="ability-numbers"><div>${field('resource','СТОИМОСТЬ РЕСУРСА',numericValue(a.resource),'number','min="0" max="1000000000" step="any" required')}</div><div><label for="resourceUnit">Единицы</label><select id="resourceUnit"><option value="points" ${a.resourceUnit==='points'||a.resourceUnit===undefined?'selected':''}>ед.</option><option value="percent" ${a.resourceUnit==='percent'?'selected':''}>%</option><option value="count" ${a.resourceUnit==='count'?'selected':''}>шт.</option></select></div><div class="ability-wide"><label for="resourceType">РАСХОДУЕМЫЙ РЕСУРС</label><select id="resourceType">${resourceOptions(a.resourceType)}</select></div>${['cast','cooldown','range'].map((key,i)=>`<div>${field(key,['ВРЕМЯ ПРИМЕНЕНИЯ, СЕК.','ПЕРЕЗАРЯДКА, СЕК.','ДАЛЬНОСТЬ, М'][i],numericValue(a[key]),'number','min="0" max="1000000000" step="any" required')}</div>`).join('')}</div>`;
 const requirements=`<details class="ability-requirements" id="abilityRequirements"><summary>Требуется: <span id="requirementSummary">${a.requirements?.length?a.requirements.map(esc).join(', '):'Без требований'}</span></summary><div class="requirement-options">${requirementValues.map(value=>`<label><input type="checkbox" data-ability-requirement value="${esc(value)}" ${(a.requirements||[]).includes(value)?'checked':''}><span>${esc(value)}</span></label>`).join('')}</div></details>`;
 modal(existing?'Редактировать способность':'Новая способность',identity+`<div class="ability-editor-layout"><div>${selectors}<label for="abilityDescription">ОПИСАНИЕ</label><textarea id="abilityDescription" maxlength="10000" rows="8">${esc(a.description)}</textarea></div><div>${costs}${requirements}<label for="abilityLearning">ИЗУЧЕНИЕ СПОСОБНОСТИ</label><select id="abilityLearning"><option value="base" ${learning==='base'?'selected':''}>Изучается без таланта</option><option value="talent" ${learning==='talent'?'selected':''}>Требуется талант</option></select><div id="talentLinkField" ${learning==='base'?'hidden':''}><label for="talentLink">ОТКРЫВАЕТСЯ ТАЛАНТОМ</label><select id="talentLink"><option value="">По размещению в дереве</option>${doc.branches.flatMap(b=>b.talents).map(t=>`<option data-user-content value="${esc(t.id)}" ${a.talentId===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></div><p class="muted compact-field-help">0 м — ближний бой. 0 сек. — мгновенное применение.</p></div></div>`,()=>{
  const updated={...a,name:$('#abilityName').value.trim(),description:$('#abilityDescription').value,icon:readIcon(),learningMode:$('#abilityLearning').value,talentId:$('#abilityLearning').value==='talent'?$('#talentLink').value:'',kind:$('#abilityKind').value,branchId:$('#abilityBranch').value,requirements:[...document.querySelectorAll('[data-ability-requirement]:checked')].map(el=>el.value)};
  if(!updated.name)throw Error('Введи название');
  for(const key of ['resource','cast','cooldown','range']){updated[key]=Number($('#'+key).value);if(!Number.isFinite(updated[key])||updated[key]<0||updated[key]>1e9)throw Error('Характеристики должны быть неотрицательными числами');}updated.resourceType=$('#resourceType').value;updated.resourceUnit=$('#resourceUnit').value;
  if(existing)doc.abilities[doc.abilities.indexOf(existing)]=updated;else doc.abilities.push(updated);
  changed();render();$('#modal').close();if(onSaved)setTimeout(()=>onSaved(updated),0);
 },existing?()=>{if(confirm('Удалить способность и её размещения в деревьях?')){doc=removeAbility(doc,a.id);changed();render();$('#modal').close();}}:null);
 $('#modal').classList.add('ability-editor-dialog');$('#abilityLearning').onchange=()=>{$('#talentLinkField').hidden=$('#abilityLearning').value!=='talent';};bindPicker();favoriteButton('ability',()=>doc.abilities.find(x=>x.id===a.id));modalCancel=onCancel;
 for(const checkbox of document.querySelectorAll('[data-ability-requirement]'))checkbox.onchange=()=>{$('#requirementSummary').textContent=[...document.querySelectorAll('[data-ability-requirement]:checked')].map(el=>el.value).join(', ')||t('Без требований');};
}
$('#trees').addEventListener('change',e=>{if(e.target.matches('.tree-header input')){doc.branches.find(b=>b.id===e.target.closest('.tree').dataset.branch).name=e.target.value;changed();render();}});
function treeClick(e){
 const tree=e.target.closest('.tree');if(!tree)return;const b=doc.branches.find(b=>b.id===tree.dataset.branch),btn=e.target.closest('button');if(!btn)return;
 if(btn.dataset.talent){const t=b.talents.find(t=>t.id===btn.dataset.talent);if(mode==='edit'){editTalent(b,t.row,t.col,t);}else if(e.altKey){readOnlyTalent(t);}else{if(changeRank(doc,t.id,e.type==='contextmenu'||e.shiftKey?-1:1)){if(e.type!=='contextmenu'&&!e.shiftKey)trackAllocation();changed(false);render();}else toast('Не хватает очков, не выполнены требования или от таланта зависят другие.');}return;}
 if(mode!=='edit')return;
 if(btn.dataset.row!==undefined){if(reserved(b,Number(btn.dataset.row),Number(btn.dataset.col))){toast('Здесь проходит стрелка. Сначала убери зависимость.');return;}if(favoritePlacement){placeFavorite(favoritePlacement,{branchId:b.id,row:Number(btn.dataset.row),col:Number(btn.dataset.col)});return;}editTalent(b,Number(btn.dataset.row),Number(btn.dataset.col));return;}
 switch(btn.dataset.action){
  case 'branch-color':{
   const initial=b.color||['#426348','#4c4774','#714a3e','#3d5e78'][doc.branches.indexOf(b)%4];
   modal('Цвет фона: '+b.name,`<label for="branchColor">Оттенок ветки</label><input type="color" id="branchColor" value="${initial}"><div class="branch-color-swatches">${['#426348','#4c4774','#714a3e','#3d5e78','#765c27','#595f6b','#70496b','#337273'].map(c=>`<button type="button" data-branch-color="${c}" style="background:${c}" aria-label="Оттенок ${c}"></button>`).join('')}</div><div id="branchColorPreview" class="branch-color-preview">${esc(b.name)}</div><button type="button" id="resetBranchColor">Стандартный фон</button>`,()=>{if(reset)delete b.color;else b.color=$('#branchColor').value;changed();render();$('#modal').close();});
   let reset=false;const preview=()=>{$('#branchColorPreview').setAttribute('style',branchTint({color:$('#branchColor').value}).slice(7,-1));};
   $('#branchColor').oninput=()=>{reset=false;preview();};for(const button of document.querySelectorAll('[data-branch-color]'))button.onclick=()=>{$('#branchColor').value=button.dataset.branchColor;reset=false;preview();};$('#resetBranchColor').onclick=()=>{reset=true;$('#branchColorPreview').removeAttribute('style');};preview();return;
  }
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
$('#chooseFavorite').onclick=async()=>{
 if(!user)return;const button=$('#chooseFavorite');button.disabled=true;
 try{await api('/favorites',{kind:'tree',item:{document:withoutBuild(doc),sourceShare:activeShare||null}});toast('Дерево добавлено в избранное');}catch(error){toast(error.message);}finally{button.disabled=false;}
};
$('#heroBranches').onclick=e=>{const button=e.target.closest('[data-hero-branch]');if(!button)return;const tree=[...document.querySelectorAll('.tree')].find(t=>t.dataset.branch===button.dataset.heroBranch);tree?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});};
$('#createTreeFromEditor').onclick=()=>{$('#treeActions').open=false;$('#new').click();};$('#loadPresetFromEditor').onclick=()=>{$('#treeActions').open=false;$('#preset').click();};
$('#trees').onclick=treeClick;$('#trees').oncontextmenu=e=>{if(mode==='play'&&e.target.closest('[data-talent]')){e.preventDefault();treeClick(e);}};
$('#abilities').onclick=e=>{const el=e.target.closest('[data-ability]');if(el)editAbility(doc.abilities.find(a=>a.id===el.dataset.ability));};
$('#addBranch').onclick=()=>{if(doc.branches.length<4){const next=branch(t('Ветка')+' '+(doc.branches.length+1));next.rows=Math.max(...doc.branches.map(b=>b.rows));doc.branches.push(next);changed();render();}};
$('#addAbility').onclick=()=>editAbility();
$('#copyToSelf').onclick=()=>{if(!user){auth(false,copySharedToEditor);return;}copySharedToEditor();};
async function copySharedToEditor(){
 if(!activeShare)return;const token=activeShare,copy=structuredClone(doc),suffix=' '+t('— копия');copy.name=copy.name.slice(0,100-suffix.length)+suffix;const button=$('#copyToSelf');button.disabled=true;
 try{const result=await api('/projects',{document:withoutBuild(normalize(copy,{allowLegacy:true})),sourceShare:token,copy:true});if(activeShare!==token)return;copy.name=result.name||copy.name;doc=copy;projectId=result.id;activeShare=null;activePublication=null;favoriteTreeId=null;mode='edit';setDirty(false);persistBrowserBuild();try{persistDraft();}catch{}showWorkspace();resetHistory();render();history.replaceState(null,'',location.pathname);$('#saveState').textContent='Сохранено в аккаунте';toast('Дерево скопировано в ваши черновики');}catch(error){toast(error.message);}finally{button.disabled=false;}
}
$('#editMode').onclick=()=>{mode='edit';render();};$('#playMode').onclick=()=>{mode='play';render();};
$('#reset').onclick=()=>{doc.build={};changed(false);render();};
for(const id of ['className','budget','rowCost'])$('#'+id).onchange=()=>{
 const key=id==='className'?'name':id,value=key==='name'?$('#'+id).value.replace(/\s+/g,' ').trim():Number($('#'+id).value);
 if((key==='name'&&!value)||(key!=='name'&&(!Number.isInteger(value)||value<0||value>100000))){toast('Проверь значение');render();return;}
 doc[key]=value;if(key==='budget')doc.budgetAuto=false;if(!validBuild(doc,doc.build))doc.build={};changed();render();
};
$('#classIcon').onclick=()=>{if(!user){auth();return;}if(mode==='edit')editClassIcon();};
for(const [id,key,limit] of [['classSubtitle','subtitle',120],['classDescription','description',10000]])$('#'+id).onchange=()=>{const value=$('#'+id).value.trim();if(value.length>limit)return;doc[key]=value;changed();render();};
function editClassIcon(input=null,selectedLayer=0,target='class'){
 const draft=structuredClone(input||(target==='avatar'?(typeof user.avatar==='object'?user.avatar:defaultClassIcon(user.avatar)):doc.classIcon)||defaultClassIcon(branchIcon(doc.branches[0])));
 delete draft.background;delete draft.glow;
 let second=draft.layers.length===2,active=selectedLayer;
 if(!second)draft.layers.push({icon:'inv_sword_04',opacity:.55});
 for(const layer of draft.layers)Object.assign(layer,{x:layer.x??0,y:layer.y??0,scale:layer.scale??1,rotation:layer.rotation??0});
 const settings=[['Opacity','Непрозр.',0,100,'%'],['Scale','Размер',75,150,'%'],['Rotation','Поворот',-180,180,'°'],['X','Сдвиг X',-100,100,'%'],['Y','Сдвиг Y',-100,100,'%']];
 function model(){return {layers:structuredClone(draft.layers.slice(0,second?2:1))};}
 function controls(){const l=draft.layers[active];for(const [key] of settings)$('#emblem'+key).value=key==='Opacity'?Math.round(l.opacity*100):key==='Scale'?Math.round(l.scale*100):key==='Rotation'?l.rotation:l[key.toLowerCase()];}
 function preview(){
  if(!second)active=0;
  const m=model();$('#emblemLivePreview').innerHTML=classEmblem(m);$('#emblemSmallPreview').innerHTML=classEmblem(m);
  $('#emblemChoice2').hidden=!second;$('#toggleEmblemLayer').textContent=second?'−':'＋';$('#toggleEmblemLayer').setAttribute('aria-label',second?'Убрать вторую иконку':'Добавить вторую иконку');
  for(const button of document.querySelectorAll('[data-active-emblem]')){const selected=Number(button.dataset.activeEmblem)===active;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}
  for(const [key,, , ,unit] of settings)$('#emblem'+key+'Value').textContent=$('#emblem'+key).value+unit;
 }
 const choice=(layer,i)=>`<div id="emblemChoice${i+1}" class="emblem-icon-choice"><button type="button" data-active-emblem="${i}" aria-label="Двигать иконку ${i+1}" title="Выбрать эту иконку для перемещения">${image(layer.icon)}</button><button type="button" class="emblem-replace" data-emblem-layer="${i}" aria-label="Заменить иконку ${i+1}" title="Выбрать другую иконку">${glyph('edit')}</button></div>`;
 const sliders=settings.map(([key,label,min,max])=>`<label class="emblem-vslider" for="emblem${key}"><output id="emblem${key}Value"></output><input type="range" id="emblem${key}" min="${min}" max="${max}" step="1" aria-label="${label}"><span>${label}</span></label>`).join('');
 modal(target==='avatar'?'Аватар профиля':'Иконка класса',`<div class="compact-emblem"><div class="compact-emblem-main"><div class="emblem-preview-column"><div id="emblemLivePreview" tabindex="0" role="img" aria-label="Предпросмотр. Перетаскивай выбранную иконку; стрелки двигают её."></div><span id="emblemSmallPreview"></span><div class="emblem-icon-choices">${draft.layers.map(choice).join('')}<button type="button" id="toggleEmblemLayer" class="icon-button"></button></div></div><div class="emblem-slider-bank">${sliders}<button type="button" id="resetEmblemTransform" class="text-button" title="Сбросить положение, размер и поворот выбранной иконки">${glyph('undo')}Сбросить</button></div></div><p class="muted emblem-help">Нажми на нужную иконку снизу и двигай её в круге. Карандаш меняет изображение.</p></div>`,async()=>{if(target==='avatar'){const result=await api('/profile/avatar',{avatar:model()});user=result.user;renderUser();if(!$('#community').hidden)openCommunity(communityState.scope);toast('Аватар сохранён');}else{doc.classIcon=model();changed();render();}$('#modal').close();});
 $('#modal').classList.add('compact-emblem-dialog');
 for(const [key] of settings)$('#emblem'+key).oninput=e=>{const field=key==='Opacity'?'opacity':key==='Scale'?'scale':key==='Rotation'?'rotation':key.toLowerCase();draft.layers[active][field]=Number(e.target.value)/(key==='Opacity'||key==='Scale'?100:1);preview();};
 for(const button of document.querySelectorAll('[data-active-emblem]'))button.onclick=()=>{active=Number(button.dataset.activeEmblem);controls();preview();};
 $('#toggleEmblemLayer').onclick=()=>{second=!second;active=second?1:0;controls();preview();};
 $('#resetEmblemTransform').onclick=()=>{Object.assign(draft.layers[active],{x:0,y:0,scale:1,rotation:0});controls();preview();};
 for(const button of document.querySelectorAll('[data-emblem-layer]'))button.onclick=()=>{const m=model(),index=Number(button.dataset.emblemLayer);$('#modal').close();setTimeout(()=>{modal(target==='avatar'?'Выбрать иконку аватара':'Выбрать иконку класса',iconPicker(m.layers[index].icon),()=>{m.layers[index].icon=readIcon();$('#modal').close();setTimeout(()=>editClassIcon(m,index,target),0);});modalCancel=()=>editClassIcon(m,index,target);bindPicker();},0);};
 const pad=$('#emblemLivePreview');let drag=null;
 const move=(x,y)=>{draft.layers[active].x=Math.round(Math.max(-100,Math.min(100,x)));draft.layers[active].y=Math.round(Math.max(-100,Math.min(100,y)));controls();preview();};
 pad.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();pad.focus({preventScroll:true});pad.setPointerCapture(e.pointerId);const l=draft.layers[active];drag={x:e.clientX,y:e.clientY,baseX:l.x,baseY:l.y,rotation:l.rotation,size:pad.querySelector('.class-emblem').getBoundingClientRect().width};};
 pad.onpointermove=e=>{if(!drag)return;const dx=(e.clientX-drag.x)/drag.size*100,dy=(e.clientY-drag.y)/drag.size*100,a=drag.rotation*Math.PI/180;move(drag.baseX+dx*Math.cos(a)+dy*Math.sin(a),drag.baseY-dx*Math.sin(a)+dy*Math.cos(a));};
 pad.onpointerup=pad.onpointercancel=pad.onlostpointercapture=()=>drag=null;
 pad.onkeydown=e=>{const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!delta)return;e.preventDefault();const [x,y]=delta,step=e.shiftKey?5:1,l=draft.layers[active],a=l.rotation*Math.PI/180;move(l.x+step*(x*Math.cos(a)+y*Math.sin(a)),l.y+step*(-x*Math.sin(a)+y*Math.cos(a)));};
 controls();preview();
}
async function askToLeave(){
 if(!dirty)return true;
 const dialog=$('#draftDialog');$('#draftName').textContent=doc.name+(doc.subtitle?' '+doc.subtitle:'');$('#draftError').textContent='';dialog.showModal();
 return new Promise(resolve=>{
  let saving=false,settled=false;
  const finish=value=>{if(settled)return;settled=true;dialog.close();if(!value){if($('#modal').open)$('#modal').close();if(user)mode='edit';showWorkspace();render();}resolve(value);};
  const save=async()=>{saving=true;for(const b of dialog.querySelectorAll('button'))b.disabled=true;try{const result=await api('/projects',{id:projectId,document:withoutBuild(normalize(doc)),sourceShare:activeShare});projectId=result.id;persistBrowserBuild();try{persistDraft();}catch{}setDirty(false);$('#saveState').textContent='Сохранено в аккаунте';finish(true);}catch(error){$('#draftError').textContent=t(error.message);}finally{saving=false;for(const b of dialog.querySelectorAll('button'))b.disabled=false;}};
  $('#saveDraft').onclick=()=>{if(user){save();}else{auth(false,save);modalCancel=()=>finish(false);}};
  $('#discardDraft').onclick=()=>finish(true);$('#stayDraft').onclick=()=>finish(false);$('#closeDraft').onclick=()=>{if(!saving)finish(false);};dialog.oncancel=e=>{e.preventDefault();if(!saving)finish(false);};
 });
}
$('#new').onclick=async()=>{if(!await askToLeave())return;showWorkspace();doc=blank();doc.name=t('Новый класс');doc.branches.forEach((b,i)=>b.name=t('Ветка')+' '+(i+1));projectId=null;activeShare=null;favoriteTreeId=null;activePublication=null;mode='edit';changed();render();};
$('#preset').onclick=async()=>{
 try{
  const response=await fetch('presets/index.json');if(!response.ok)throw Error('Не удалось загрузить каталог');const classes=await response.json();
  let version='Forever',selected=classes.find(c=>c.version===version)?.id;
  modal('Стандартные деревья',`<div id="versionFilters" class="version-filters">${[['Forever','Forever'],['2.4.3','TBC'],['3.3.5a','WotLK']].map(([v,n])=>`<button type="button" data-version="${v}">${n}</button>`).join('')}</div><input type="hidden" id="presetClass"><div id="classCards" class="class-cards"></div><p class="muted">Тексты стандартных наборов на английском. Forever — снимок 1.60.1.69876, возможны отличия от текущего Wowhead.</p>`,async()=>{
   if(!selected)throw Error('Выбери класс');if(!await askToLeave())return;
   const response=await fetch(`presets/${selected}.json`);if(!response.ok)throw Error('Не удалось загрузить класс');doc=normalize(await response.json());showWorkspace();projectId=null;activeShare=null;favoriteTreeId=null;allocationSent=false;$('#shareStats').hidden=true;mode=user?'edit':'play';changed();render();$('#modal').close();toast(doc.source?.notice||'Класс загружен');
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
$('#export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(withoutBuild(doc),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${doc.name.replace(/[^\p{L}\p{N}_-]/gu,'_')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#import').onclick=()=>$('#file').click();$('#file').onchange=async e=>{
 try{const file=e.target.files[0];if(!file)return;if(file.size>2_000_000)throw Error('Файл больше 2 МБ');const incoming=normalize(JSON.parse(await file.text()));if(!await askToLeave())return;doc=incoming;projectId=null;activeShare=null;favoriteTreeId=null;changed();render();toast('Класс импортирован');}catch(err){toast(err.message);}finally{e.target.value='';}
};
function avatarMarkup(icon,name){return `<span class="user-avatar" aria-label="Аватар ${esc(name)}">${classEmblem(typeof icon==='object'?icon:defaultClassIcon(icon||'inv_misc_questionmark'))}</span>`;}
$('#profileAvatar').onclick=()=>{if(!user){auth();return;}editClassIcon(null,0,'avatar');};
$('#returnEditor').onclick=()=>{showWorkspace();render();if(activeShare)refreshShareStats();};
function updateNavigation(){
 const view=!$('#aboutPage').hidden?'about':!$('#library').hidden?$('#library').dataset.scope:!$('#community').hidden?(communityState.scope==='mine'?'publications':'rankings'):'projects';
 document.body.dataset.view=view;syncHero();
 for(const id of ['rankings','publications','projects','favorites','about']){const selected=id===view;$('#'+id).classList.toggle('nav-active',selected);if(selected)$('#'+id).setAttribute('aria-current','page');else $('#'+id).removeAttribute('aria-current');}
}

function renderUser(){if(!user)mode='play';$('#adminLink').hidden=!user?.isAdmin;if(user)setLanguage(user.language||'en');if(!$('#aboutPage').hidden&&aboutContent)$('#aboutContent').innerHTML=aboutMarkup(aboutContent,getLanguage());$('#publicationVotes').hidden=true;$('#chooseFavorite').hidden=mode!=='play'||!user;notificationUser(user?.login);$('#accountMenu').hidden=!user;closeMenus();if(!user&&!$('#library').hidden)showWorkspace();$('#profileAvatar').hidden=!user;$('#profileAvatar').innerHTML=user?avatarMarkup(user.avatar,user.login):'';if(!user){activePublication=null;$('#publicationBar').hidden=true;if(communityState.scope==='mine'){communityState.scope='rankings';$('#community').hidden=true;$('#community').innerHTML='';if($('#aboutPage').hidden)$('.workspace').hidden=false;}}if(activeShare)refreshShareStats();$('#user').textContent=user?.login||'';$('#auth').hidden=!!user;$('#logout').hidden=!user;}
function auth(register=false,onSuccess=null){
 modal(register?'Создать аккаунт':'Войти в мастерскую',`<div class="auth-intro"><span>✦</span><p>${register?'Создай аккаунт, чтобы сохранять и публиковать свои деревья.':'С возвращением в мастерскую.'}</p></div>${register?field('email','Электронная почта','','email','required maxlength="254" autocomplete="email"'):''}${field('login',register?'Публичный ник':'Почта или прежний логин','','text',register?'required pattern="[A-Za-z0-9_\\-]{3,32}" minlength="3" maxlength="32" autocomplete="nickname"':'required maxlength="254" autocomplete="username"')}${field('password','ПАРОЛЬ','','password',`required minlength="8" maxlength="128" autocomplete="${register?'new-password':'current-password'}"`)}${register?field('repeatPassword','Повторите пароль','','password','required minlength="8" maxlength="128" autocomplete="new-password"'):''}<div class="auth-options"><label><input type="checkbox" id="showPassword">Показать пароль</label>${register?'':'<span class="auth-help-links"><a href="account.html">Забыли пароль?</a><a href="account.html?mode=resend">Повторить подтверждение</a></span>'}</div><p class="muted">${register?'Пароль — от 8 символов. Ник виден другим пользователям, почта — нет.':'Существующие аккаунты также могут входить по прежнему логину.'}</p><button type="button" id="switchAuth">${register?'Уже есть аккаунт? Войти':'Нет аккаунта? Зарегистрироваться'}</button>`,async()=>{
  if(register&&$('#password').value!==$('#repeatPassword').value)throw Error(t('Пароли не совпадают'));
  const address=register?$('#email').value:'';const result=await api(register?'/register':'/login',{login:$('#login').value,password:$('#password').value,...(register?{email:address}:{})});
  if(result.verificationPending){modal('Проверьте почту',`<p>Мы отправили ссылку для подтверждения адреса. После подтверждения можно войти.</p><button type="button" id="resendVerification">Отправить ещё раз</button>`,null);$('#resendVerification').onclick=async()=>{try{await api('/auth/resend',{email:address});toast('Письмо отправлено');}catch(error){toast(error.message);}};return;}
  user=result.user;await restoreDraftProject();if(user&&!activeShare)mode='edit';resetHistory();renderUser();render();$('#modal').close();toast('Ты в мастерской. Теперь можно сохранить класс.');if(onSuccess)try{await onSuccess();}catch(error){toast(error.message);}const requestedShare=new URLSearchParams(location.search).get('share');if(requestedShare&&activeShare!==requestedShare)openPublication(requestedShare).catch(e=>toast(e.message));
 });$('#modal').classList.add('auth-dialog');$('#submitModal').textContent=register?'Зарегистрироваться':'Войти';$('#switchAuth').onclick=()=>{$('#modal').close();auth(!register,onSuccess);};$('#showPassword').onchange=e=>{for(const id of ['password','repeatPassword'])if($('#'+id))$('#'+id).type=e.target.checked?'text':'password';};
}
$('#profileSettings').onclick=()=>{
 if(!user)return;closeMenus();modal('Настройки профиля',`<p class="profile-email" data-user-content>${esc(user.email||'—')}</p><p class="muted">${user.emailVerified?'Почта подтверждена':'Почта не подтверждена'}</p><div class="account-email-actions"><button type="button" id="changeEmail">Изменить почту</button>${user.email&&!user.emailVerified?'<button type="button" id="verifyEmail">Подтвердить почту</button>':''}</div><label for="profileLanguage">Язык интерфейса</label><select id="profileLanguage"><option value="en" ${getLanguage()==='en'?'selected':''}>English</option><option value="ru" ${getLanguage()==='ru'?'selected':''}>Русский</option></select><label class="profile-toggle"><input id="show3d" type="checkbox" ${user.show3d?'checked':''}>3D-просмотр</label><p class="muted">Показывать блок персонажа под ресурсами. Движок 3D-моделей пока не подключён.</p>`,async()=>{const result=await api('/profile/settings',{show3d:$('#show3d').checked,language:$('#profileLanguage').value});user=result.user;renderUser();renderCharacter();$('#modal').close();toast('Настройки профиля сохранены');});$('#changeEmail').onclick=()=>{modal('Изменить почту',field('newEmail','Электронная почта',user.email||'','email','required maxlength="254" autocomplete="email"')+field('emailPassword','Текущий пароль','','password','required minlength="8" maxlength="128" autocomplete="current-password"'),async()=>{const result=await api('/auth/email',{email:$('#newEmail').value,password:$('#emailPassword').value});user=result.user;renderUser();render();$('#modal').close();toast(result.verificationSent?'Письмо отправлено':'Почта обновлена');});};if($('#verifyEmail'))$('#verifyEmail').onclick=async()=>{try{await api('/auth/resend',{email:user.email});toast('Письмо отправлено');}catch(error){toast(error.message);}};
};
$('#chooseAvatar').onclick=()=>{closeMenus();$('#profileAvatar').click();};
$('#auth').onclick=()=>auth();
$('#logout').onclick=async()=>{try{await api('/logout',{});const privateView=activeShare&&(activePublication?.visibility==='private'||activePublication?.archived);if(privateView){try{if(localStorage.getItem('talentforge-draft')===JSON.stringify(doc))localStorage.removeItem('talentforge-draft');}catch{}doc=blank();activeShare=null;favoriteTreeId=null;activePublication=null;setDirty(false);history.replaceState(null,'',location.pathname);showWorkspace();}user=null;projectId=null;mode='play';resetHistory();renderUser();render();toast(privateView?'Выход выполнен. Просмотр закрытой публикации завершён.':'Выход выполнен. Локальный черновик остаётся в этом браузере.');}catch(err){toast(err.message);}};
$('#save').onclick=async()=>{
 if(!user){auth();return;}const button=$('#save');button.disabled=true;button.setAttribute('aria-busy','true');
 try{const result=await api('/projects',{id:projectId,document:withoutBuild(normalize(doc)),sourceShare:activeShare});projectId=result.id;persistBrowserBuild();try{persistDraft();}catch{}setDirty(false);refreshShareStats();$('#saveState').textContent='Сохранено в аккаунте';toast('Класс сохранён в аккаунте. Очки калькулятора — только в этом браузере.');}catch(err){toast(err.message);}finally{button.disabled=false;button.setAttribute('aria-busy','false');}
};
$('#share').onclick=()=>{
 if(!user){auth();return;}
 modal('Зафиксировать версию',`<p>Будет сохранён и опубликован неизменяемый снимок класса без распределённых очков. Личный билд сохраняется только в браузере посетителя. Последующие правки рабочего класса не изменят эту версию.</p><label for="publicationVisibility">ВИДИМОСТЬ</label><select id="publicationVisibility"><option value="private">Только мне — доступно только автору</option><option value="unlisted" selected>Только по ссылке</option><option value="public">Общедоступное — участвует в рейтингах</option></select><p class="muted">Общедоступную версию смогут найти в рейтинге. Версию по ссылке увидят только те, кому передана ссылка.</p>`,async()=>{
  const visibility=$('#publicationVisibility').value;
  const saved=await api('/projects',{id:projectId,document:withoutBuild(normalize(doc)),sourceShare:activeShare});projectId=saved.id;persistBrowserBuild();try{persistDraft();}catch{}
  const result=await api('/publish',{projectId,visibility});setDirty(false);$('#saveState').textContent='Сохранено в аккаунте';
  const url=new URL(location.href);url.search='';url.searchParams.set('share',result.token);url.hash='';
  $('#modal').close();modal('Версия '+result.publication.version+' зафиксирована',field('shareURL','ССЫЛКА НА ПУБЛИКАЦИЮ',url.href,'text','readonly')+`<p>${visibility==='public'?'Публикация появилась в рейтинге.':visibility==='private'?'Только мне — открыть эту версию можешь только ты из своего аккаунта.':'Только по ссылке — в рейтинге не показывается.'}</p><p class="muted">Статистика и управление видимостью — в «Мои публикации».</p>`,null);$('#shareURL').select();
 });$('#submitModal').textContent='Зафиксировать и опубликовать';
};
$('#projects').onclick=()=>openLibrary('projects');
async function loadWorkingProject(pid,copy=false){
 if(!await askToLeave())return;
 const result=await api('/projects/'+encodeURIComponent(pid));doc=restoreBrowserBuild(normalize(result.document,{allowLegacy:true}),'project:'+pid);activeShare=null;favoriteTreeId=null;activePublication=null;allocationSent=false;projectId=copy?null:pid;mode='edit';if(copy){const existing=(await api('/projects')).projects,key=(name,subtitle)=>((name||'')+' '+(subtitle||'')).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim(),used=new Set(existing.map(p=>key(p.name,p.subtitle))),base=doc.name;let n=1;do{const suffix=' '+t('— копия')+(n>1?' ('+n+')':'');doc.name=base.slice(0,100-suffix.length)+suffix;n++;}while(used.has(key(doc.name,doc.subtitle)));}showWorkspace();if(copy)changed();else{setDirty(false);try{persistDraft();}catch{}$('#saveState').textContent='Сохранено в аккаунте';}resetHistory();render();history.replaceState(null,'',location.pathname);if($('#modal').open)$('#modal').close();
}
let libraryRequest=0;
async function confirmArchive(name){
 return new Promise(resolve=>{
  let settled=false;const done=value=>{if(settled)return;settled=true;$('#modal').close();resolve(value);};
  modal('Удаление в архив',`<p><strong data-user-content>${esc(name)}</strong></p><p>Дерево будет помещено в архив и станет недоступно по ссылке. Оно будет окончательно удалено через 30 дней, если не восстановить его.</p>`,()=>done(true));$('#submitModal').textContent='В архив';modalCancel=()=>done(false);
  const cancel=document.createElement('button');cancel.type='button';cancel.id='cancelArchive';cancel.textContent=t('Отмена');cancel.onclick=()=>done(false);$('#modalActions').prepend(cancel);$('#modal').addEventListener('close',()=>cancel.remove(),{once:true});
 });
}
function updateArchiveTimers(){for(const timer of document.querySelectorAll('[data-archive-expires]')){const left=Math.max(0,Number(timer.dataset.archiveExpires)*1000-Date.now()),totalMinutes=Math.ceil(left/60000),days=Math.floor(totalMinutes/1440),hours=Math.floor(totalMinutes%1440/60),minutes=totalMinutes%60;timer.textContent=t('До удаления:')+' '+days+' '+t('дн.')+' '+hours+' '+t('ч.')+' '+minutes+' '+t('мин.');}}
setInterval(updateArchiveTimers,60000);
async function openLibrary(scope,archived=false){
 if(!user){auth();return;}closeMenus();$('#aboutPage').hidden=true;if(location.hash==='#about')history.replaceState(null,'',location.pathname+location.search);const request=++libraryRequest,viewer=user.login;
 $('#library').dataset.scope=scope;$('#library').dataset.archived=String(archived);$('#library').hidden=false;$('#community').hidden=true;$('.workspace').hidden=true;$('#publicationBar').hidden=true;$('#shareStats').hidden=true;updateNavigation();
 const favorites=scope==='favorites';
 $('#library').innerHTML=`<div class="community-heading"><div><p class="eyebrow">ТВОЯ МАСТЕРСКАЯ</p><h2>${favorites?'Избранное':archived?'Архив деревьев':'Мои деревья'}</h2><p class="muted">${favorites?'Деревья, таланты и способности, которые всегда под рукой.':archived?'Восстановите дерево до истечения срока, чтобы сохранить его.':'Сохраняй идеи в черновиках и возвращайся к своим деревьям.'}</p></div></div><div class="list-tools"><label class="search-field">${glyph('search')}<input id="librarySearch" type="search" placeholder="${favorites?'Найти дерево, талант или способность':'Найти дерево'}" aria-label="Поиск в сохранениях"></label>${favorites?'':`<button id="toggleTreeArchive">${glyph(archived?'arrow':'layers')}${archived?'Вернуться в активные':'Архив'}</button>`}<span id="libraryCount" class="muted"></span></div>${favorites?'<div class="library-filters" aria-label="Тип избранного"><button data-kind="all" class="selected">Все</button><button data-kind="talent">Таланты</button><button data-kind="ability">Способности</button><button data-kind="tree">Деревья</button></div>':''}<div id="libraryItems" class="library-items" aria-busy="true"><div class="loading-state"><span class="spinner"></span>Загружаем твою мастерскую…</div></div>`;
 if(!favorites)$('#toggleTreeArchive').onclick=()=>openLibrary(scope,!archived);
 try{
  const result=await api(favorites?'/favorites':'/projects?archived='+(archived?'1':'0'));if(request!==libraryRequest||user?.login!==viewer||$('#library').hidden)return;
  let items=favorites?result.favorites:result.projects,kind='all';
  function paint(){
   const query=$('#librarySearch').value.toLocaleLowerCase('ru'),filtered=items.filter(item=>(!favorites||kind==='all'||item.kind===kind)&&(favorites?item.item.name:item.name+' '+(item.subtitle||'')).toLocaleLowerCase('ru').includes(query));
   $('#libraryCount').textContent=`${filtered.length} из ${items.length}`;$('#libraryItems').setAttribute('aria-busy','false');
   $('#libraryItems').innerHTML=filtered.length?filtered.map(item=>favorites?`<article class="library-card"><span class="library-emblem">${item.kind==='tree'?classEmblem(item.item.document.classIcon,branchIcon(item.item.document.branches[0])):image(item.item.icon)}</span><div class="library-copy"><strong>${esc(item.item.name)}</strong><span class="muted">${item.kind==='tree'?'Дерево':item.kind==='talent'?'Талант':'Способность'}</span></div><button data-use="${esc(item.id)}">${glyph(item.kind==='tree'?'eye':'plus')}${item.kind==='tree'?'Открыть дерево':'Добавить в дерево'}</button><button data-remove="${esc(item.id)}" class="icon-button danger" aria-label="Удалить из избранного">${glyph('trash')}</button></article>`:`<article class="library-card ${archived?'archived-tree':'open-tree-card'}" ${archived?'':`data-open="${esc(item.id)}" tabindex="0" role="link" aria-label="Открыть ${esc(item.name)}"`}>${classEmblem(item.classIcon,item.icon)}<div class="library-copy"><strong class="library-title" data-user-content>${esc(item.name)}${item.subtitle?` <small class="class-subtitle">${esc(item.subtitle)}</small>`:''}</strong><span class="muted">${archived?'В архиве':item.published?'Опубликовано':'Черновик'} · ${esc(new Date((archived?item.archivedAt:item.updated)*1000).toLocaleString('ru-RU'))}</span>${archived?`<span class="archive-deadline" data-archive-expires="${item.expiresAt}" title="${esc(new Date(item.expiresAt*1000).toLocaleString('ru-RU'))}"></span>`:''}</div>${archived?`<button data-restore-tree="${esc(item.id)}">${glyph('undo')}Восстановить</button>`:`<button data-copy="${esc(item.id)}">${glyph('copy')}Копия</button><button data-remove="${esc(item.id)}" class="icon-button danger" aria-label="Удалить дерево">${glyph('trash')}</button>`}</article>`).join(''):`<div class="empty library-empty">${glyph(favorites?'star':'layers')}<strong>${query||kind!=='all'?'Ничего не найдено':archived?'Архив пуст':favorites?'Сохрани то, что вдохновляет':'Здесь начнётся твоя история'}</strong><p>${query||kind!=='all'?'Попробуй другое название или фильтр.':archived?'Удалённые деревья будут здесь 30 дней.':favorites?'Открой талант или способность и нажми «В избранное».':'Создай дерево и нажми «Сохранить», чтобы вернуться к нему позже.'}</p></div>`;
   updateArchiveTimers();
  }
  $('#librarySearch').oninput=paint;for(const button of $('#library').querySelectorAll('[data-kind]'))button.onclick=()=>{kind=button.dataset.kind;for(const b of $('#library').querySelectorAll('[data-kind]'))b.classList.toggle('selected',b===button);paint();};paint();
  $('#libraryItems').onkeydown=e=>{if(e.target.matches('[data-open]')&&['Enter',' '].includes(e.key)){e.preventDefault();e.target.click();}};
  $('#libraryItems').onclick=async e=>{const button=e.target.closest('button'),card=e.target.closest('[data-open]');if(!button&&!card)return;if(button)button.disabled=true;try{
   if(!button&&card){await loadWorkingProject(card.dataset.open);return;}
   if(button.dataset.copy){await loadWorkingProject(button.dataset.copy,true);return;}
   if(button.dataset.restoreTree){await api('/projects/'+encodeURIComponent(button.dataset.restoreTree)+'/restore',{});items=items.filter(item=>item.id!==button.dataset.restoreTree);paint();toast('Дерево восстановлено');return;}
   if(button.dataset.remove){const item=items.find(item=>item.id===button.dataset.remove);if(favorites?!confirm('Удалить из избранного?'):!await confirmArchive(item.name))return;await api((favorites?'/favorites/':'/projects/')+encodeURIComponent(button.dataset.remove),{},'DELETE');if(!favorites&&projectId===button.dataset.remove)projectId=null;items=items.filter(item=>item.id!==button.dataset.remove);paint();toast(favorites?'Удалено из избранного':'Дерево отправлено в архив');return;}
   if(button.dataset.use){const favorite=items.find(item=>item.id===button.dataset.use);if(favorite.kind==='tree'){await openFavoriteTree(favorite);return;}showWorkspace();mode='edit';if(favorite.kind==='ability'){doc.abilities.push({...structuredClone(favorite.item),id:crypto.randomUUID(),talentId:'',branchId:'',learningMode:'base'});changed();render();toast('Способность добавлена');}else{favoritePlacement=structuredClone(favorite.item);render();toast('Нажми на пустую ячейку для размещения таланта');}}
  }catch(error){toast(error.message);}finally{if(button)button.disabled=false;}};
 }catch(error){if(request===libraryRequest&&!$('#library').hidden){$('#libraryItems').setAttribute('aria-busy','false');$('#libraryItems').textContent=error.message;}}
}
async function openFavoriteTree(favorite){
 if(favorite.item.sourceShare){await openPublication(favorite.item.sourceShare);return;}
 if(!await askToLeave())return;
 doc=restoreBrowserBuild(normalize(structuredClone(favorite.item.document),{allowLegacy:true}),'favorite:'+favorite.id);projectId=null;activeShare=null;favoriteTreeId=favorite.id;activePublication=null;mode='play';setDirty(false);showWorkspace();resetHistory();render();history.replaceState(null,'',location.pathname);try{persistDraft();}catch{}
}
$('#modal').addEventListener('close',()=>{if($('#modal').open)return;$('#modalBody').onclick=null;$('#submitModal').textContent='Сохранить';});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});

function character(){
 doc.character??={hp:10000,race:'Человек',gender:'Мужской',armory:'',resources:[{name:t('Мана'),max:100,current:100,unit:'percent',display:'bar',shape:'diamond',color:'#397de1'}]};
 return doc.character;
}
function equipmentMarkup(c){
 const armor=[...(c.armorTypes||[]).map(id=>({name:equipmentRequirementLabels[armorTypes.indexOf(id)],icon:equipmentIcons[id],standard:true})),...(c.customArmorTypes||[]).filter(item=>item.enabled)],weapons=[...(c.weaponTypes||[]).map(id=>({name:equipmentRequirementLabels[5+weaponTypes.indexOf(id)],icon:equipmentIcons[id],standard:true})),...(c.customWeaponTypes||[]).filter(item=>item.enabled)];
 if(!armor.length&&!weapons.length)return '';
 return `<section class="character-equipment-view"><h3>Доступная экипировка</h3>${[['Доспехи',armor],['Оружие',weapons]].filter(([,items])=>items.length).map(([label,items])=>`<h4>${label}</h4><ul>${items.map(item=>`<li>${image(item.icon)}<span ${item.standard?'':'data-user-content'}>${esc(item.name)}</span></li>`).join('')}</ul>`).join('')}</section>`;
}
function renderCharacter(){
 const panel=$('#characterPanel');if(!panel)return;
 panel.hidden=mode!=='play';$('.calc-layout').classList.toggle('with-character',mode==='play');if(mode!=='play'){$('.calc-layout').style.minHeight='';return;}
 const c=character(),attrs=(description,id)=>description?.trim()?`data-resource-tooltip="${id}" tabindex="0"`:'';
 panel.innerHTML=`<p class="muted">${esc(c.race)} · ${esc(c.gender)}</p><section class="resource-view" ${attrs(c.hpDescription,'hp')}><label>ЗДОРОВЬЕ</label><div class="resource-bar" style="--resource-color:#459254"><span style="width:100%"></span><strong>${esc(c.hp)} / ${esc(c.hp)}</strong></div></section>${c.resources.map((r,index)=>`<section class="resource-view" ${attrs(r.description,index)}><label data-user-content>${esc(r.name)}</label>${r.display==='bar'?`<div class="resource-bar" style="--resource-color:${/^#[0-9a-f]{6}$/i.test(r.color)?r.color:'#397de1'}"><span style="width:${Math.min(100,Math.max(0,r.current/r.max*100))}%"></span><strong>${esc(r.current)} / ${esc(r.max)} ${r.unit==='percent'?'%':r.unit==='count'?t('шт.'):t('ед.')}</strong></div>`:`<div class="resource-symbols">${Array.from({length:Math.min(20,r.max)},(_,i)=>`<span class="resource-symbol ${['circle','triangle','diamond','crystal','gem','orb','flame','star'].includes(r.shape)?r.shape:'circle'} ${i>=r.current?'spent':''}" style="background:${/^#[0-9a-f]{6}$/i.test(r.color)?r.color:'#397de1'}"></span>`).join('')}<small>${esc(r.current)} / ${esc(r.max)} ${r.unit==='percent'?'%':r.unit==='count'?t('шт.'):t('ед.')}</small></div>`}</section>`).join('')}${equipmentMarkup(c)}${user?.show3d?`<div class="model-placeholder"><span>♙</span><strong>${esc(c.race)}</strong><p class="muted">3D-просмотр пока не подключён</p>${safeArmory(c.armory)?`<a target="_blank" rel="noopener noreferrer" href="${esc(c.armory)}">Открыть персонажа ↗</a>`:''}</div>`:''}`;
 requestAnimationFrame(()=>{if(!panel.hidden)$('.calc-layout').style.minHeight=Math.ceil(panel.getBoundingClientRect().height+40)+'px';});
}
function safeArmory(value){try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='wowhead.com'||u.hostname.endsWith('.wowhead.com')||u.hostname==='worldofwarcraft.blizzard.com');}catch{return false;}}
$('#characterSettings').onclick=()=>{
 const builder=characterBuilder({character:character(),budget:doc.budget,automatic:doc.budgetAuto,defaultBudget:defaultBudget(doc),onChooseIcon:(current,onPick)=>{$('#modal').close();modal('Выбрать иконку',iconPicker(current),()=>{onPick(readIcon());openBuilder();});modalCancel=openBuilder;bindPicker();},onSave:(c,budget,automatic)=>{
 if(c.armory&&!safeArmory(c.armory))throw Error(t('Нужна HTTPS-ссылка на Wowhead или официальный сайт World of Warcraft'));
 const next=normalize({...structuredClone(doc),character:c,budgetAuto:automatic,budget:automatic?defaultBudget(doc):budget});doc=next;changed();render();$('#modal').close();
 }});
 function openBuilder(){if($('#modal').open)$('#modal').close();modal('Ресурсы и персонаж','',builder.save);$('#modalBody').append(builder.root);$('#modal').classList.add('character-builder-dialog','auth-dialog');}openBuilder();
};
function showTooltip(target,x,y){
 if($('#modal').open)return;
 const tip=$('#tooltip');const id=target.dataset.talent;
 const t=doc.branches.flatMap(b=>b.talents).find(t=>t.id===id);
 const a=doc.abilities.find(a=>a.id===target.dataset.ability);
 const resource=target.dataset.resourceTooltip===undefined?null:target.dataset.resourceTooltip==='hp'?{name:getLanguage()==='ru'?'Здоровье':'Health',description:character().hpDescription}:character().resources[Number(target.dataset.resourceTooltip)];
 if(!t&&!a&&!resource)return;
 if(resource){tip.innerHTML=`<strong data-user-content>${esc(resource.name)}</strong><p class="resource-description" data-user-content>${esc(resource.description||'')}</p>`;}else if(t){const rank=mode==='edit'?1:(doc.build[t.id]||0),parent=doc.branches.flatMap(b=>b.talents).find(p=>p.id===t.requires),b=doc.branches.find(b=>b.talents.includes(t));tip.innerHTML=`<strong data-user-content>${esc(t.name)}</strong><div>Талант · Ранг ${rank}/${t.maxRank}</div>${t.grantedAbilityId?`<div class="spell-stats">${abilityStats(doc.abilities.find(a=>a.id===t.grantedAbilityId)||{}).map(s=>`<span>${esc(s)}</span>`).join('')}</div>`:''}<p class="effect">${esc(t.descriptions[Math.max(0,rank-1)])}</p>${mode==='play'&&rank>0&&rank<t.maxRank?`<div>Следующий ранг:</div><p class="effect">${esc(t.descriptions[rank])}</p>`:''}<p class="requirements">${t.row?`Требуется ${t.row*doc.rowCost} очк. в ветке ${esc(b.name)}<br>`:''}${parent?'Требуется: '+esc(parent.name)+' ('+parent.maxRank+'/'+parent.maxRank+')':''}</p>`;
 }else tip.innerHTML=`<strong data-user-content>${esc(a.name)}</strong><div class="muted">${a.kind==='passive'?'Пассивная способность':'Активная способность'}</div><div class="spell-stats">${abilityStats(a).map(line=>`<span>${esc(line)}</span>`).join('')}</div><p class="effect">${esc(a.description)}</p>`;
 if(t&&mode==='play')tip.innerHTML+='<small class="muted">Alt + клик — просмотр и избранное таланта</small>';
 tip.hidden=false;const box=tip.getBoundingClientRect();tip.style.left=Math.max(8,Math.min(x+16,innerWidth-box.width-8))+'px';tip.style.top=Math.max(8,Math.min(y+16,innerHeight-box.height-8))+'px';
}
let hoverTarget=null;
document.addEventListener('dragstart',()=>{hoverTarget=null;$('#tooltip').hidden=true;},true);
document.addEventListener('pointerover',e=>{const target=e.target.closest('[data-talent],[data-ability],[data-resource-tooltip]');if(target){hoverTarget=target;showTooltip(target,e.clientX,e.clientY);}});
document.addEventListener('pointermove',e=>{if(hoverTarget)showTooltip(hoverTarget,e.clientX,e.clientY);});
document.addEventListener('pointerout',e=>{if(hoverTarget&&!hoverTarget.contains(e.relatedTarget)){hoverTarget=null;$('#tooltip').hidden=true;}});
document.addEventListener('focusin',e=>{if(e.target.matches('[data-talent],[data-ability],[data-resource-tooltip]')){const r=e.target.getBoundingClientRect();showTooltip(e.target,r.right,r.top);}});
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
function abilityStats(a){return abilityStatLines(a,abilityCost(a));}
function abilityCost(a){return a.resourceType?`${a.resource??0}${a.resourceUnit==='percent'?'%':a.resourceUnit==='count'?' '+t('шт.'):' '+t('ед.')} ${a.resourceType}`:a.resource||'Нет';}
let draggedTalent=null,draggedAbility=null,abilityDragIcon=null;
$('#trees').addEventListener('dragstart',e=>{const slot=e.target.closest('[data-talent]');if(mode!=='edit'||!slot){e.preventDefault();return;}draggedTalent=slot.dataset.talent;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedTalent);});
$('#trees').addEventListener('dragover',e=>{if(mode==='edit'&&(draggedTalent||draggedAbility)&&e.target.closest('.slot')){e.preventDefault();e.dataTransfer.dropEffect=draggedAbility?'copy':'move';}});
$('#trees').addEventListener('drop',e=>{const slot=e.target.closest('.slot');if(mode!=='edit'||(!draggedTalent&&!draggedAbility)||!slot)return;e.preventDefault();try{if(draggedAbility){if(slot.dataset.talent&&!confirm('Заменить талант выбранной способностью?'))return;doc=placeAbilityTalent(doc,draggedAbility,slot.closest('.tree').dataset.branch,Number(slot.dataset.row),Number(slot.dataset.col),!!slot.dataset.talent);}else doc=moveTalent(doc,draggedTalent,slot.closest('.tree').dataset.branch,Number(slot.dataset.row),Number(slot.dataset.col));changed();render();}catch(err){toast(err.message);}finally{draggedTalent=null;draggedAbility=null;abilityDragIcon?.remove();abilityDragIcon=null;}});
$('#trees').addEventListener('dragend',()=>draggedTalent=null);$('#abilities').addEventListener('dragstart',e=>{const card=e.target.closest('[data-ability]');if(mode!=='edit'||!card){e.preventDefault();return;}draggedAbility=card.dataset.ability;e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('text/plain',draggedAbility);const img=card.querySelector('img');abilityDragIcon=document.createElement('canvas');abilityDragIcon.width=48;abilityDragIcon.height=48;abilityDragIcon.style.cssText='position:fixed;left:-1000px;top:0;width:48px;height:48px;pointer-events:none';const context=abilityDragIcon.getContext('2d');context.fillStyle='#151a1f';context.fillRect(0,0,48,48);if(img?.complete&&img.naturalWidth)context.drawImage(img,2,2,44,44);else{context.fillStyle='#d6ad66';context.font='28px serif';context.fillText('✦',10,34);}context.strokeStyle='#d6ad66';context.strokeRect(1,1,46,46);document.body.append(abilityDragIcon);e.dataTransfer.setDragImage(abilityDragIcon,24,24);});$('#abilities').addEventListener('dragend',()=>{draggedAbility=null;abilityDragIcon?.remove();abilityDragIcon=null;});
let iconCatalog=[...icons],iconPromise=null,iconCategories=[],coreIconCatalog=[],customIconCatalog=[],iconCatalogRequest=0;
async function loadIconCatalog(onUpdate=()=>{}){
 const request=++iconCatalogRequest;
 function updateCatalog(){const combined=new Map();for(const i of [...icons,...coreIconCatalog,...customIconCatalog]){const previous=combined.get(i.id);combined.set(i.id,{...previous,...i,label:(previous?previous.label+' ':'')+i.label});}iconCatalog=[...combined.values()];refreshIconCategoryOptions();onUpdate();}
 const standard=(iconPromise??=Promise.all(['icon-catalog.json','weapon-icons.json'].map(path=>fetch(path).then(r=>{if(!r.ok)throw Error('Иконки недоступны');return r.json();}))).then(lists=>lists.flat()).catch(error=>{iconPromise=null;throw error;})).then(core=>{coreIconCatalog=core;updateCatalog();});
 const uploaded=api('/icons').then(({icons:custom,categories=[]})=>{if(request!==iconCatalogRequest)return;customIconCatalog=custom;iconCategories=categories;updateCatalog();});
 const results=await Promise.allSettled([standard,uploaded]);
 if(results.every(r=>r.status==='rejected'))throw Error('Не удалось загрузить каталог иконок');
 if(results[1].status==='rejected')toast('Не удалось загрузить загруженные иконки и теги. Открой выбор ещё раз.');
 return iconCatalog;
}
async function saveReadOnlyFavorite(kind,item){await api('/favorites',{kind,item:structuredClone(item)});$('#modal').close();toast('Сохранено в твоё избранное');}
function readOnlyFavorite(kind,item){const button=$('#favoriteItem');button.hidden=false;button.textContent=kind==='ability'?'★ Способность в избранное':'★ Талант в избранное';button.onclick=async()=>{const copy=structuredClone(item);if(!user){$('#modal').close();auth(false,()=>saveReadOnlyFavorite(kind,copy));return;}button.disabled=true;try{await saveReadOnlyFavorite(kind,copy);}catch(e){toast(e.message);}finally{button.disabled=false;}};}
function readOnlyTalent(t){const ability=t.grantedAbilityId?doc.abilities.find(a=>a.id===t.grantedAbilityId):null;modal(t.name,`<div class="readonly-talent-heading">${image(t.icon)}<strong data-user-content>${esc(t.name)}</strong></div><label for="favoritePreviewRank">Ранг предпросмотра</label><select id="favoritePreviewRank">${t.descriptions.map((_,i)=>`<option value="${i}">Ранг ${i+1}</option>`).join('')}</select><p id="favoritePreviewDescription" class="tooltip-description">${esc(t.descriptions[0])}</p>${ability?`<p class="gold">${abilityStats(ability).map(esc).join(' · ')}</p>`:''}<p class="muted">В избранное попадёт независимая копия всех рангов без зависимостей от этого дерева.</p>`,null);$('#favoritePreviewRank').onchange=e=>$('#favoritePreviewDescription').textContent=t.descriptions[Number(e.target.value)];readOnlyFavorite(ability?'ability':'talent',ability||t);}
function favoriteButton(kind,getItem){
 const button=$('#favoriteItem');button.hidden=false;button.textContent='★ В избранное';
 button.onclick=async()=>{if(!user){toast('Войди в аккаунт, чтобы сохранять избранное');return;}try{if(!$('#modalForm').reportValidity())return;await modalSave();const item=getItem();if(!item)return;await api('/favorites',{kind,item});toast('Сохранено в избранное аккаунта');}catch(err){toast(err.message);}};
}
let favoritePlacement=null;
$('#favorites').onclick=()=>openLibrary('favorites');
async function showFavorites(target=null){
 if(!target){openLibrary('favorites');return;}
 if(!user){auth();return;}
 try{const {favorites}=await api('/favorites');modal('Избранные таланты и способности',`<p class="muted">Добавляются независимые копии. Зависимости от исходного дерева не переносятся.</p><div class="favorite-list">${favorites.filter(f=>f.kind!=='tree'&&(!target||f.kind==='talent')).map(f=>`<div class="favorite-row">${image(f.item.icon)}<span><strong>${esc(f.item.name)}</strong><br><small>${f.kind==='talent'?'Талант':'Способность'}</small></span><button type="button" data-use-favorite="${esc(f.id)}">Добавить</button><button type="button" data-delete-favorite="${esc(f.id)}" aria-label="Удалить из избранного">×</button></div>`).join('')||'<p>Здесь пока пусто. Открой талант или способность и нажми «В избранное».</p>'}</div>`,null);
 for(const button of document.querySelectorAll('[data-delete-favorite]'))button.onclick=async()=>{try{await api('/favorites/'+button.dataset.deleteFavorite,{},'DELETE');button.closest('.favorite-row').remove();}catch(e){toast(e.message);}};
 for(const button of document.querySelectorAll('[data-use-favorite]'))button.onclick=()=>{const f=favorites.find(f=>f.id===button.dataset.useFavorite);$('#modal').close();showWorkspace();if(mode!=='edit'){mode='edit';render();}if(f.kind==='ability'){doc.abilities.push({...structuredClone(f.item),id:crypto.randomUUID(),talentId:'',branchId:'',learningMode:'base'});changed();render();toast('Способность добавлена');}else if(target){placeFavorite(f.item,target);}else{favoritePlacement=structuredClone(f.item);toast('Нажми на пустую ячейку для размещения таланта');}};
 }catch(err){toast(err.message);}
}
function placeFavorite(item,target){const b=doc.branches.find(b=>b.id===target.branchId);if(!b||b.talents.some(t=>t.row===target.row&&t.col===target.col)||reserved(b,target.row,target.col)){toast('Ячейка занята талантом или стрелкой');return;}const copy={...structuredClone(item),id:crypto.randomUUID(),row:target.row,col:target.col,requires:''};delete copy.grantedAbilityId;b.talents.push(copy);favoritePlacement=null;changed();render();toast('Талант добавлен из избранного');}

let activeShare=null,allocationSent=false,activePublication=null;
const communityState={scope:'rankings',sort:'views',page:0,archived:false};
const undoStates=[],redoStates=[];let historyCurrent=null;
function snapshot(){return JSON.stringify({document:doc,projectId,share:activeShare,favoriteTreeId});}
function remember(){const next=snapshot();if(historyCurrent&&next!==historyCurrent){undoStates.push(historyCurrent);if(undoStates.length>100)undoStates.shift();redoStates.length=0;}historyCurrent=next;updateHistoryButtons();}
function resetHistory(){undoStates.length=0;redoStates.length=0;historyCurrent=snapshot();updateHistoryButtons();}
function updateHistoryButtons(){$('#undo').disabled=!undoStates.length;$('#redo').disabled=!redoStates.length;}
function restoreHistory(redo=false){const previousStructure=JSON.stringify(withoutBuild(doc));const from=redo?redoStates:undoStates,to=redo?undoStates:redoStates;if(!from.length)return;to.push(snapshot());const state=JSON.parse(from.pop());doc=normalize(state.document,{allowLegacy:true});projectId=state.projectId;activeShare=state.share;favoriteTreeId=state.favoriteTreeId||null;persistBrowserBuild();historyCurrent=snapshot();if(JSON.stringify(withoutBuild(doc))!==previousStructure)setDirty(true);try{persistDraft();}catch{}render();$('#saveState').textContent='Есть несохранённые изменения';refreshShareStats();}
$('#undo').onclick=()=>restoreHistory();$('#redo').onclick=()=>restoreHistory(true);
document.addEventListener('keydown',e=>{if($('#modal').open||$('#draftDialog').open)return;if((e.ctrlKey||e.metaKey)&&!e.target.closest('input,textarea,select')&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();restoreHistory(e.key.toLowerCase()==='y'||e.shiftKey);}});
document.addEventListener('click',e=>{if(!user&&e.target.closest('#new,#editMode,#export,#import,#characterSettings,#addBranch,#addAbility')){e.preventDefault();e.stopImmediatePropagation();auth();}},true);
function showShareStats(stats){$('#shareStats').hidden=!activeShare||!$('#community').hidden||!$('#library').hidden;if(activeShare&&stats)$('#shareStats').textContent=`Распределяли очки: ${stats.allocated} · Сохранили себе: ${stats.saved}`;}
async function refreshShareStats(){if(!activeShare){$('#shareStats').hidden=true;return;}const token=activeShare,viewer=user?.login;try{const result=await api('/shared/'+encodeURIComponent(token));if(token===activeShare&&viewer===user?.login){showShareStats(result.stats);showPublication(result.publication);}}catch{}}
async function trackAllocation(){if(!activeShare||allocationSent)return;allocationSent=true;const token=activeShare;try{const result=await api('/shared/'+encodeURIComponent(token)+'/interact',{});if(activeShare===token){showShareStats(result.stats);showPublication(result.publication);}}catch{allocationSent=false;}}

function showPublication(info){
 if(!activeShare||!info){$('#publicationBar').hidden=true;$('#publicationVotes').hidden=true;return;}if(info.token!==activeShare)return;activePublication=info;if(!$('#community').hidden||!$('#library').hidden){$('#publicationBar').hidden=true;return;}
 const owner=!!user&&info.isOwner&&info.author?.toLowerCase()===user.login.toLowerCase();
 $('#publicationBar').hidden=false;$('#publicationBar').innerHTML=`<p class="muted">${esc(info.author||'Автор старой ссылки не указан')} · ${info.archived?'В архиве · ':''}Версия ${info.version} · ${info.visibility==='public'?'Общедоступное':info.visibility==='private'?'Только мне':'Только по ссылке'} · Просмотры: ${info.views}</p>`;
 $('#publicationVotes').hidden=false;$('#publicationVotes').innerHTML=`<button id="likePublication" aria-label="Лайки: ${info.likes}" aria-pressed="${info.myVote===1}" ${owner?'disabled title="Нельзя оценивать свою публикацию"':''}>👍 ${info.likes}</button><span ${owner?'title="Видно только создателю дерева"':''}><button id="dislikePublication" aria-label="${owner?'Дизлайки: '+(info.dislikes??0):'Дизлайк'}" aria-pressed="${info.myVote===-1}" ${owner?'disabled title="Видно только создателю дерева"':''}>👎${owner?' '+(info.dislikes??0):''}</button></span>`;
 for(const [id,vote]of [['likePublication',1],['dislikePublication',-1]])$('#'+id).onclick=async()=>{if(!user){auth();return;}for(const b of document.querySelectorAll('.vote-controls button'))b.disabled=true;try{const result=await api('/shared/'+encodeURIComponent(activeShare)+'/vote',{vote});showPublication(result.publication);}catch(err){toast(err.message);showPublication(activePublication);}};
}
async function openPublication(token){
 if(!await askToLeave())return;
 const result=await api('/shared/'+encodeURIComponent(token));doc=restoreBrowserBuild(normalize(result.document,{allowLegacy:true}),'share:'+token);projectId=null;activeShare=token;favoriteTreeId=null;allocationSent=false;setDirty(false);mode='play';resetHistory();showWorkspace();showShareStats(result.stats);showPublication(result.publication);render();$('#saveState').textContent='Копия опубликованной версии';const url=new URL(location.href);url.search='';url.searchParams.set('share',token);history.replaceState(null,'',url);
}
async function openAbout(){
 closeMenus();const request=++aboutRequest;$('#aboutPage').hidden=false;$('#library').hidden=true;$('#community').hidden=true;$('.workspace').hidden=true;$('#publicationBar').hidden=true;$('#shareStats').hidden=true;updateNavigation();
 if(location.hash!=='#about')history.replaceState(null,'',location.pathname+location.search+'#about');
 $('#aboutContent').setAttribute('aria-busy','true');if(aboutContent)$('#aboutContent').innerHTML=aboutMarkup(aboutContent,getLanguage());else $('#aboutContent').innerHTML='<p class="muted">Загрузка…</p>';
 try{const result=await api('/about');if(request!==aboutRequest||$('#aboutPage').hidden)return;aboutContent=result.content;$('#aboutContent').innerHTML=aboutMarkup(aboutContent,getLanguage());}catch(error){if(!$('#aboutPage').hidden)$('#aboutContent').textContent=error.message;}finally{if(request===aboutRequest)$('#aboutContent').setAttribute('aria-busy','false');}
}
$('#about').onclick=openAbout;$('#aboutReturnEditor').onclick=()=>{$('#returnEditor').click();};
$('#rankings').onclick=()=>openCommunity('rankings');$('#publications').onclick=()=>{if(!user){auth();return;}openCommunity('mine');};
async function openCommunity(scope='rankings'){
 if(scope!==communityState.scope)communityState.page=0;communityState.scope=scope;
 const mine=scope==='mine';if(!mine)communityState.archived=false;if(mine&&!user){auth();return;}
 closeMenus();$('#aboutPage').hidden=true;if(location.hash==='#about')history.replaceState(null,'',location.pathname+location.search);$('#library').hidden=true;$('#community').hidden=false;$('.workspace').hidden=true;$('#publicationBar').hidden=true;$('#shareStats').hidden=true;updateNavigation();
 $('#community').innerHTML=`<div class="community-heading"><div><p class="eyebrow">${mine?'ТВОЯ МАСТЕРСКАЯ':'СООБЩЕСТВО'}</p><h2>${mine?'Мои публикации':'Рейтинг деревьев'}</h2></div></div>${mine?`<div class="library-filters"><button id="activePublications" aria-pressed="${!communityState.archived}" class="${!communityState.archived?'selected':''}">Публикации</button><button id="archivedPublications" aria-pressed="${communityState.archived}" class="${communityState.archived?'selected':''}">Архив</button></div>${communityState.archived?'<p class="muted">Публикации в архиве доступны только тебе. Удалённые публикации и деревья хранятся 30 дней. Восстанови их до истечения срока.</p>':''}`:`<div class="ranking-tabs">${[['likes','По рейтингу'],['views','Самые просматриваемые'],['usage','Чаще используют калькулятор'],['latest','Последние опубликованные']].map(([sort,name])=>`<button data-sort="${sort}" aria-label="${name}" aria-pressed="${sort===communityState.sort}" class="${sort===communityState.sort?'selected':''}"><span class="ranking-symbol">${glyph(({likes:'trophy',views:'eye',usage:'calculator',latest:'clock'})[sort])}</span><span class="tab-label-full">${name}</span><span class="tab-label-short">${({likes:'Рейтинг',views:'Просмотры',usage:'Калькулятор',latest:'Новые'})[sort]}</span></button>`).join('')}</div>`}<div class="list-tools"><label class="search-field">${glyph('search')}<input id="publicationSearch" type="search" placeholder="Поиск на этой странице" aria-label="Поиск публикаций на текущей странице"></label><span id="searchResultCount" class="muted" role="status"></span></div><div id="publicationCards" class="publication-cards" aria-busy="true"><div class="loading-state"><span class="spinner"></span>Загружаем деревья…</div></div><div id="publicationPagination" class="publication-pagination"></div>`;
 for(const b of document.querySelectorAll('[data-sort]'))b.onclick=()=>{communityState.sort=b.dataset.sort;communityState.page=0;openCommunity('rankings');};
 if(mine)for(const [id,archived] of [['activePublications',false],['archivedPublications',true]])$('#'+id).onclick=()=>{communityState.archived=archived;communityState.page=0;openCommunity('mine');};
 const requested={...communityState},viewer=user?.login;
 try{
  const result=await api(mine?'/publications?page='+requested.page+'&archived='+(requested.archived?'1':'0'):'/rankings?sort='+requested.sort+'&page='+requested.page);
  if(JSON.stringify(requested)!==JSON.stringify(communityState)||viewer!==user?.login||$('#community').hidden)return;
  $('#publicationCards').setAttribute('aria-busy','false');
  $('#publicationCards').innerHTML=result.publications.length?result.publications.map((p,index)=>publicationRow(p,{mine,index,page:requested.page,sort:requested.sort,image,avatarMarkup})).join(''):'<div class="empty library-empty">'+glyph(mine?'layers':'trophy')+'<strong>'+(mine?(requested.archived?'Архив пуст':'Активных публикаций пока нет'):'Здесь появятся новые легенды')+'</strong><p>'+(mine?(requested.archived?'Здесь будут публикации, которые можно восстановить в течение 30 дней.':'Создай новую публикацию или восстанови прежнюю из архива.'):'Общедоступные зафиксированные деревья попадут в этот рейтинг.')+'</p></div>';
  updateArchiveTimers();$('#publicationSearch').oninput=()=>{const query=$('#publicationSearch').value.toLocaleLowerCase('ru');let visible=0;for(const row of document.querySelectorAll('.publication-row')){row.hidden=!row.textContent.toLocaleLowerCase('ru').includes(query);if(!row.hidden)visible++;}$('#searchResultCount').textContent=query?`Найдено на странице: ${visible}`:'';};
  for(const b of document.querySelectorAll('[data-open-publication]'))b.onclick=()=>openPublication(b.dataset.openPublication).catch(e=>toast(e.message));
  for(const row of document.querySelectorAll('[data-publication-row]'))row.onclick=e=>{if(e.target.closest('button,select,label,a'))return;openPublication(row.dataset.publicationRow).catch(err=>toast(err.message));};
  for(const b of document.querySelectorAll('[data-edit-project]'))b.onclick=()=>loadWorkingProject(b.dataset.editProject).catch(e=>toast(e.message));
  for(const b of document.querySelectorAll('[data-restore-working-project]'))b.onclick=async()=>{b.disabled=true;try{await api('/projects/'+encodeURIComponent(b.dataset.restoreWorkingProject)+'/restore',{});toast('Дерево восстановлено');openCommunity('mine');}catch(error){toast(error.message);b.disabled=false;}};
  for(const b of document.querySelectorAll('[data-copy-link]'))b.onclick=async()=>{const url=new URL(location.href);url.search='';url.searchParams.set('share',b.dataset.copyLink);url.hash='';try{await navigator.clipboard.writeText(url.href);toast('Ссылка скопирована');}catch{modal('Ссылка на публикацию',field('shareURL','ССЫЛКА',url.href,'text','readonly'),null);$('#shareURL').select();}};
  for(const button of document.querySelectorAll('[data-archive-publication],[data-restore-publication]'))button.onclick=async()=>{const restore=!!button.dataset.restorePublication,token=button.dataset.restorePublication||button.dataset.archivePublication;if(!restore&&!await confirmArchive(result.publications.find(p=>p.token===token)?.name||''))return;button.disabled=true;try{await api('/publications/'+encodeURIComponent(token)+'/'+(restore?'restore':'archive'),{});toast(restore?'Публикация восстановлена':'Публикация в архиве. Восстановление доступно 30 дней.');openCommunity('mine');}catch(e){toast(e.message);button.disabled=false;}};
  for(const select of document.querySelectorAll('[data-visibility]'))select.onchange=async()=>{select.disabled=true;try{await api('/publications/'+select.dataset.visibility+'/visibility',{visibility:select.value});openCommunity('mine');}catch(err){toast(err.message);openCommunity('mine');}};
  $('#publicationPagination').innerHTML=`<button id="previousPublications" ${requested.page?'':'disabled'}>← Назад</button><span>Страница ${requested.page+1}</span><button id="nextPublications" ${result.hasMore?'':'disabled'}>Далее →</button>`;
  $('#previousPublications').setAttribute('aria-label','Предыдущая страница');$('#nextPublications').setAttribute('aria-label','Следующая страница');
  $('#previousPublications').onclick=()=>{communityState.page--;openCommunity(scope);};$('#nextPublications').onclick=()=>{communityState.page++;openCommunity(scope);};
 }catch(err){const cards=$('#publicationCards');if(cards){cards.setAttribute('aria-busy','false');cards.textContent=err.message;}}
}
initUI();initLanguage();
resetHistory();
render();api('/me').then(async result=>{user=result.user;await restoreDraftProject();if(user&&!activeShare)mode='edit';resetHistory();renderUser();render();}).catch(()=>toast('Сервер недоступен. Проверь подключение и перезагрузи страницу.'));
const sharedToken=new URLSearchParams(location.search).get('share');
if(sharedToken) api('/shared/'+encodeURIComponent(sharedToken)).then(async result=>{
 if(!await askToLeave())return;
 doc=restoreBrowserBuild(normalize(result.document,{allowLegacy:true}),'share:'+sharedToken);projectId=null;activeShare=sharedToken;favoriteTreeId=null;showShareStats(result.stats);showPublication(result.publication);mode='play';resetHistory();render();$('#saveState').textContent='Копия класса по ссылке';toast('Открыта копия класса. Изменения не затрагивают оригинал.');
}).catch(err=>toast(err.message));

if(location.hash==='#about')openAbout();

initIconFitting();
