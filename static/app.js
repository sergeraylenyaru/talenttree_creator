import {blank,branch,total,validBuild,changeRank,normalize,route,reserved} from './engine.js';
import {icons,iconURL} from './icons.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let doc=blank(), projectId=null, user=null, mode='edit', modalSave=null, modalDelete=null, dirty=false;
try { const draft=JSON.parse(localStorage.getItem('talentforge-draft')); if(draft) doc=normalize(draft); } catch {}
function toast(message) { $('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,4200); }
function changed() { dirty=true;$('#saveState').textContent='Есть несохранённые изменения';try{localStorage.setItem('talentforge-draft',JSON.stringify(doc));}catch{toast('Браузер не сохранил черновик. Экспортируй класс в JSON.');} }
async function api(path, data, method) {
 const options={method:method||(data?'POST':'GET'),headers:{'Content-Type':'application/json'}};
 if(data) options.body=JSON.stringify(data);
 const response=await fetch('/api'+path,options);
 const result=await response.json();if(!response.ok) throw Error(result.error||'Ошибка сервера');return result;
}
function image(id,extra='') { return `<img src="${esc(iconURL(id))||'missing-icon'}" alt="" loading="lazy" ${extra}>`; }
document.addEventListener('error',e=>{if(e.target.tagName==='IMG'){e.target.style.visibility='hidden';e.target.alt='Иконка недоступна';}},true);
function render() {
 renderCharacter();
 $('#className').value=doc.name;$('#budget').value=doc.budget;$('#rowCost').value=doc.rowCost;
 $('#points').textContent=`${total(doc)} / ${doc.budget}`;
 for(const id of ['className','budget','rowCost']) $('#'+id).disabled=mode!=='edit';
 $('#editMode').classList.toggle('selected',mode==='edit');$('#playMode').classList.toggle('selected',mode==='play');
 $('#addBranch').hidden=mode!=='edit';$('#addBranch').disabled=doc.branches.length>=5;$('#addAbility').hidden=mode!=='edit';
 $('#hint').textContent=mode==='edit'?'Нажми на пустую ячейку, чтобы создать талант.':'Левая кнопка: +1 очко · Правая кнопка: −1 · Shift + клик: −1';
 $('#trees').innerHTML=doc.branches.map(b=>`<article class="tree" data-branch="${esc(b.id)}"><div class="tree-header"><input aria-label="Название ветки" value="${esc(b.name)}" maxlength="80" ${mode!=='edit'?'disabled':''}><span>${b.talents.reduce((s,t)=>s+(doc.build[t.id]||0),0)} очк.</span>${mode==='edit'?'<button data-action="delete-branch" aria-label="Удалить ветку">×</button>':''}</div><div class="talent-grid">${Array.from({length:b.rows*4},(_,i)=>{
 const row=Math.floor(i/4),col=i%4,t=b.talents.find(t=>t.row===row&&t.col===col);
 if(!t) return `<button class="slot ${mode==='play'?'empty-slot':''}" data-row="${row}" data-col="${col}" aria-label="Создать талант: ряд ${row+1}, столбец ${col+1}" ${mode!=='edit'?'disabled':''}>${mode==='edit'?'+':'·'}</button>`;
 const rank=doc.build[t.id]||0, next={...doc.build,[t.id]:rank+1};
 const available=validBuild(doc,next), desc=t.descriptions[Math.max(0,rank-1)]||'Описание не задано';
 return `<button class="slot filled ${rank===t.maxRank?'maxed':available?'available':rank?'':'locked'}" data-talent="${esc(t.id)}" data-tip="${esc(t.name)} (${rank}/${t.maxRank})\n${esc(desc)}${t.requires?'\nТребуется полностью изучить: '+esc(b.talents.find(x=>x.id===t.requires)?.name):''}" aria-label="${esc(t.name)}, ранг ${rank} из ${t.maxRank}"><span class="fallback">✦</span>${image(t.icon)}<span class="rank">${mode==='edit'?'0':rank}/${t.maxRank}</span></button>`;
 }).join('')}</div>${mode==='edit'?'<div class="tree-footer"><button data-action="add-row">＋ Добавить ряд</button><button data-action="remove-row" title="Удалить последний ряд">− Ряд</button></div>':''}</article>`).join('');
 $('#abilities').innerHTML=doc.abilities.length?doc.abilities.map(a=>{const unlocked=!a.talentId||(doc.build[a.talentId]||0)>0;return `<button class="ability-card ${mode==='play'&&!unlocked?'locked':''}" data-ability="${esc(a.id)}">${image(a.icon)}<div><strong>${esc(a.name)}</strong><p>${esc(a.description)}</p><p>${[a.resource&&'Стоимость: '+a.resource,a.cast&&'Применение: '+a.cast,a.cooldown&&'Восстановление: '+a.cooldown,a.range&&'Дальность: '+a.range].filter(Boolean).map(esc).join(' · ')}</p>${a.talentId?`<small class="gold">${unlocked?'✦':'🔒'} ${esc(doc.branches.flatMap(b=>b.talents).find(t=>t.id===a.talentId)?.name||'Талант удалён')}</small>`:''}</div></button>`;}).join(''):'<div class="empty"><strong>Здесь начинается арсенал твоего класса</strong>Добавь первую способность — активную или пассивную.</div>';
 requestAnimationFrame(drawDependencies);
}
function drawDependencies(){
 for(const tree of document.querySelectorAll('.tree')){
  const b=doc.branches.find(b=>b.id===tree.dataset.branch), grid=tree.querySelector('.talent-grid');
  grid.querySelector('svg')?.remove();
  const lines=b.talents.filter(t=>t.requires).map(t=>{
   const child=[...grid.querySelectorAll('[data-talent]')].find(el=>el.dataset.talent===t.id), parent=[...grid.querySelectorAll('[data-talent]')].find(el=>el.dataset.talent===t.requires);
   if(!child||!parent)return '';
   const path=route(b,b.talents.find(p=>p.id===t.requires),t);
   if(!path)return '';
   const cells=[...grid.querySelectorAll('.slot')];
   const points=path.map(([r,c])=>{const el=cells[r*4+c];return [el.offsetLeft+el.offsetWidth/2,el.offsetTop+el.offsetHeight/2];});
   const trim=(a,z)=>{const dx=z[0]-a[0],dy=z[1]-a[1],len=Math.hypot(dx,dy);return [a[0]+dx/len*26,a[1]+dy/len*26];};
   points[0]=trim(points[0],points[1]);points[points.length-1]=trim(points.at(-1),points.at(-2));
   return `<polyline points="${points.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#a28a54" stroke-width="2" marker-end="url(#arrow-${b.id})"/>`;
  }).join('');
  grid.insertAdjacentHTML('afterbegin',`<svg class="dependency" aria-hidden="true"><defs><marker id="arrow-${esc(b.id)}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#a28a54"/></marker></defs>${lines}</svg>`);
 }
}
window.addEventListener('resize',drawDependencies);
function modal(title, body, save, remove) {
 $('#modalTitle').textContent=title;$('#modalBody').innerHTML=body;$('#formError').textContent='';modalSave=save;modalDelete=remove;
 $('#submitModal').hidden=!save;$('#deleteItem').hidden=!remove;$('#modal').showModal();
}
$('#closeModal').onclick=()=>$('#modal').close();
$('#modalForm').onsubmit=async e=>{e.preventDefault();$('#formError').textContent='';const button=$('#submitModal');button.disabled=true;try{if(modalSave) await modalSave();}catch(err){$('#formError').textContent=err.message;}finally{button.disabled=false;}};
$('#deleteItem').onclick=()=>modalDelete?.();
function field(id,label,value='',type='text',attrs=''){return `<label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(value)}" ${attrs}>`;}
function iconPicker(selected='inv_misc_questionmark'){
 return `<label for="iconSearch">ИКОНКА · ПОИСК В СТАРТОВОМ КАТАЛОГЕ</label><input id="iconSearch" placeholder="Огонь, лечение, воин…"><div id="iconGrid" class="icon-grid"></div>${field('iconName','ИЛИ ВВЕДИ ИМЯ ЛЮБОЙ WOW-ИКОНКИ',/^[a-z0-9_]+$/i.test(selected)?selected:'','text',`pattern="[A-Za-z0-9_]+" data-initial="${esc(selected)}"`)}<div class="icon-preview">${image(selected,'id="iconPreview"')}<small class="muted">Каталог: ${icons.length} иконок. Для стандартных талантов сохранены исходные изображения.</small></div><label for="customIcon">СВОЯ ИКОНКА · PNG, JPEG ИЛИ WEBP, ДО 250 КБ</label><input type="file" id="customIcon" accept="image/png,image/jpeg,image/webp">`;
}
function readIcon(){return $('#iconName').value.toLowerCase()||$('#iconName').dataset.initial||'inv_misc_questionmark';}
function bindPicker(){
 const update=()=>{$('#iconGrid').innerHTML=icons.filter(i=>(i.id+' '+i.label).toLowerCase().includes($('#iconSearch').value.toLowerCase())).map(i=>`<button type="button" class="icon-choice ${i.id===$('#iconName').value?'active':''}" data-icon="${esc(i.id)}" title="${esc(i.label)}">${image(i.id)}</button>`).join('');};
 $('#iconSearch').oninput=update;
 const preview=()=>{$('#iconPreview').style.visibility='visible';$('#iconPreview').src=iconURL(readIcon())||'missing-icon';};
 $('#iconGrid').onclick=e=>{const btn=e.target.closest('[data-icon]');if(btn){$('#iconName').value=btn.dataset.icon;preview();update();}};
 $('#iconName').oninput=preview;
 $('#customIcon').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>250000){toast('Нужна картинка PNG, JPEG или WebP до 250 КБ');return;}const reader=new FileReader();reader.onload=()=>{$('#iconName').dataset.initial=reader.result;$('#iconName').value='';preview();};reader.readAsDataURL(file);};update();
}
function editTalent(b,row,col,existing){
 const t=existing||{id:crypto.randomUUID(),row,col,name:'',icon:'inv_misc_questionmark',maxRank:1,descriptions:[''],requires:''};
 let descriptions=[...t.descriptions];
 function eligible(p){const candidate=p;if(p.id===t.id||p.row>t.row)return false;const seen=new Set();while(p.requires){if(p.requires===t.id||seen.has(p.id))return false;seen.add(p.id);p=b.talents.find(x=>x.id===p.requires);if(!p)return false;}return !!route(b,candidate,t);}
 modal(existing?'Редактировать талант':'Новый талант',field('talentName','НАЗВАНИЕ',t.name,'text','required maxlength="100"')+iconPicker(t.icon)+`<div class="two-cols"><div>${field('maxRank','КОЛИЧЕСТВО РАНГОВ',t.maxRank,'number','min="1" max="100" required')}</div><div><label for="requires">ТРЕБУЕТ ТАЛАНТ (ПОЛНЫЙ РАНГ)</label><select id="requires"><option value="">Без зависимости</option>${b.talents.filter(eligible).map(p=>`<option value="${esc(p.id)}" ${t.requires===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div></div><p class="muted">Укажи полный текст эффекта для каждого ранга. Он может отличаться целиком.</p><div id="rankFields" class="rank-fields"></div>`,()=>{
  capture();const maxRank=Number($('#maxRank').value);
  const updated={...t,name:$('#talentName').value.trim(),icon:readIcon(),maxRank,requires:$('#requires').value,descriptions:Array.from({length:maxRank},(_,i)=>descriptions[i]||'')};
  if(!updated.name)throw Error('Введи название');
  if(existing)b.talents[b.talents.indexOf(existing)]=updated;else b.talents.push(updated);
  if(!validBuild(doc,doc.build)) doc.build={};changed();render();$('#modal').close();
 },existing?()=>{
  if(!confirm('Удалить талант? Зависимости от него будут сняты.'))return;
  b.talents=b.talents.filter(x=>x.id!==t.id);for(const x of b.talents)if(x.requires===t.id)x.requires='';for(const a of doc.abilities)if(a.talentId===t.id)a.talentId='';doc.build={};changed();render();$('#modal').close();
 }:null);
 function capture(){for(const el of document.querySelectorAll('[data-description]'))descriptions[Number(el.dataset.description)]=el.value;}
 function ranks(){capture();const n=Math.max(1,Math.min(100,Number($('#maxRank').value)||1));$('#rankFields').innerHTML=Array.from({length:n},(_,i)=>`<label for="rank${i}">РАНГ ${i+1}</label><textarea id="rank${i}" data-description="${i}" maxlength="5000" placeholder="Увеличивает урон на ${(i+1)*2}%">${esc(descriptions[i]||'')}</textarea>`).join('');}
 $('#maxRank').oninput=ranks;ranks();bindPicker();
}
function editAbility(existing){
 const a=existing||{id:crypto.randomUUID(),name:'',description:'',icon:'inv_misc_questionmark',resource:'',cast:'',cooldown:'',range:'',talentId:''};
 if(mode==='play'){modal(a.name,`<p class="tooltip-description">${esc(a.description)}</p><p class="gold">${[a.resource&&'Стоимость: '+a.resource,a.cast&&'Применение: '+a.cast,a.cooldown&&'Восстановление: '+a.cooldown,a.range&&'Дальность: '+a.range].filter(Boolean).map(esc).join(' · ')}</p>`,null);return;}
 modal(existing?'Редактировать способность':'Новая способность',field('abilityName','НАЗВАНИЕ',a.name,'text','required maxlength="100"')+iconPicker(a.icon)+`<label for="abilityDescription">ОПИСАНИЕ</label><textarea id="abilityDescription" maxlength="10000">${esc(a.description)}</textarea><div class="two-cols">${['resource','cast','cooldown','range'].map((k,i)=>`<div>${field(k,['СТОИМОСТЬ РЕСУРСА','ВРЕМЯ ПРИМЕНЕНИЯ','ПЕРЕЗАРЯДКА','ДАЛЬНОСТЬ'][i],a[k],'text','maxlength="100"')}</div>`).join('')}</div><label for="talentLink">ОТКРЫВАЕТСЯ ТАЛАНТОМ</label><select id="talentLink"><option value="">Базовая способность</option>${doc.branches.flatMap(b=>b.talents).map(t=>`<option value="${esc(t.id)}" ${a.talentId===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select>`,()=>{
  const updated={...a,name:$('#abilityName').value.trim(),description:$('#abilityDescription').value,icon:readIcon(),talentId:$('#talentLink').value};
  if(!updated.name)throw Error('Введи название');
  for(const k of ['resource','cast','cooldown','range'])updated[k]=$('#'+k).value;
  if(existing)doc.abilities[doc.abilities.indexOf(existing)]=updated;else doc.abilities.push(updated);
  changed();render();$('#modal').close();
 },existing?()=>{if(confirm('Удалить способность?')){doc.abilities=doc.abilities.filter(x=>x.id!==a.id);changed();render();$('#modal').close();}}:null);bindPicker();
}
$('#trees').addEventListener('change',e=>{if(e.target.matches('.tree-header input')){doc.branches.find(b=>b.id===e.target.closest('.tree').dataset.branch).name=e.target.value;changed();}});
function treeClick(e){
 const tree=e.target.closest('.tree');if(!tree)return;const b=doc.branches.find(b=>b.id===tree.dataset.branch),btn=e.target.closest('button');if(!btn)return;
 if(btn.dataset.talent){const t=b.talents.find(t=>t.id===btn.dataset.talent);if(mode==='edit'){editTalent(b,t.row,t.col,t);}else{if(changeRank(doc,t.id,e.type==='contextmenu'||e.shiftKey?-1:1)){changed();render();}else toast('Не хватает очков, не выполнены требования или от таланта зависят другие.');}return;}
 if(mode!=='edit')return;
 if(btn.dataset.row!==undefined){if(reserved(b,Number(btn.dataset.row),Number(btn.dataset.col))){toast('Здесь проходит стрелка. Сначала убери зависимость.');return;}editTalent(b,Number(btn.dataset.row),Number(btn.dataset.col));return;}
 switch(btn.dataset.action){
  case 'add-row':if(b.rows>=1000){toast('Достигнут технический предел: 1000 рядов.');return;}{const rows=Math.max(...doc.branches.map(b=>b.rows))+1;for(const x of doc.branches)x.rows=rows;}break;
  case 'remove-row':{
   const rows=Math.max(...doc.branches.map(x=>x.rows));if(rows<=1)return;
   const removed=new Set(doc.branches.flatMap(x=>x.talents.filter(t=>t.row>=rows-1).map(t=>t.id)));
   if(removed.size&&!confirm('Последний ряд содержит таланты. Удалить его во всех ветках вместе с талантами?'))return;
   for(const x of doc.branches){x.rows=rows-1;x.talents=x.talents.filter(t=>!removed.has(t.id));}
   for(const a of doc.abilities)if(removed.has(a.talentId))a.talentId='';doc.build={};break;
  }
  case 'delete-branch':if(doc.branches.length===1){toast('Нужна хотя бы одна ветка.');return;}if(!confirm(`Удалить ветку «${b.name}» и её таланты?`))return;{const removed=new Set(b.talents.map(t=>t.id));doc.branches=doc.branches.filter(x=>x!==b);for(const a of doc.abilities)if(removed.has(a.talentId))a.talentId='';doc.build={};}break;
  default:return;
 }
 changed();render();
}
$('#trees').onclick=treeClick;$('#trees').oncontextmenu=e=>{if(mode==='play'&&e.target.closest('[data-talent]')){e.preventDefault();treeClick(e);}};
$('#abilities').onclick=e=>{const el=e.target.closest('[data-ability]');if(el)editAbility(doc.abilities.find(a=>a.id===el.dataset.ability));};
$('#addBranch').onclick=()=>{if(doc.branches.length<5){const next=branch(`Ветка ${doc.branches.length+1}`);next.rows=Math.max(...doc.branches.map(b=>b.rows));doc.branches.push(next);changed();render();}};
$('#addAbility').onclick=()=>editAbility();
$('#editMode').onclick=()=>{mode='edit';render();};$('#playMode').onclick=()=>{mode='play';render();};
$('#reset').onclick=()=>{doc.build={};changed();render();};
for(const id of ['className','budget','rowCost'])$('#'+id).onchange=()=>{
 const key=id==='className'?'name':id,value=key==='name'?$('#'+id).value.trim():Number($('#'+id).value);
 if((key==='name'&&!value)||(key!=='name'&&(!Number.isInteger(value)||value<0||value>100000))){toast('Проверь значение');render();return;}
 doc[key]=value;if(!validBuild(doc,doc.build))doc.build={};changed();render();
};
$('#new').onclick=()=>{if(dirty&&!confirm('Создать новый класс? Текущий черновик будет заменён. Сначала можно сохранить или экспортировать его.'))return;doc=blank();projectId=null;changed();render();};
$('#preset').onclick=async()=>{
 try{
  const response=await fetch('presets/index.json');if(!response.ok)throw Error('Не удалось загрузить каталог');const classes=await response.json();
  modal('Стандартные таланты · 3.3.5a',`<p class="inline-info">Импортируется редактируемая копия: три ветки, все ранги и зависимости. Названия и описания талантов — на английском из исходного набора. Базовый список способностей не включён.</p><label for="presetClass">КЛАСС</label><select id="presetClass">${classes.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} — ${c.talents} талантов</option>`).join('')}</select><p class="muted">Источник: CraftedRO / Offline talent calculator 3.3.5a, GPL-3.0. Это набор сообщества; игровые эффекты не симулируются.</p>`,async()=>{
   if(dirty&&!confirm('Заменить текущий черновик стандартным классом?'))return;
   const response=await fetch(`presets/${$('#presetClass').value}.json`);if(!response.ok)throw Error('Не удалось загрузить класс');const incoming=normalize(await response.json());doc=incoming;projectId=null;mode='edit';changed();render();$('#modal').close();toast('Класс загружен. Все таланты можно редактировать.');
  });$('#submitModal').textContent='Загрузить класс';
 }catch(err){toast(err.message);}
};
$('#export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${doc.name.replace(/[^\p{L}\p{N}_-]/gu,'_')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#import').onclick=()=>$('#file').click();$('#file').onchange=async e=>{
 try{const file=e.target.files[0];if(!file)return;if(file.size>2_000_000)throw Error('Файл больше 2 МБ');const incoming=normalize(JSON.parse(await file.text()));if(dirty&&!confirm('Заменить текущий черновик импортированным классом?'))return;doc=incoming;projectId=null;changed();render();toast('Класс импортирован');}catch(err){toast(err.message);}finally{e.target.value='';}
};
function renderUser(){$('#user').textContent=user?.login||'';$('#auth').hidden=!!user;$('#logout').hidden=!user;}
function auth(register=false){
 modal(register?'Создать аккаунт':'Войти в мастерскую',`<p class="muted">Сохраняй классы в своей учётной записи и возвращайся к ним позже.</p>${field('login','ЛОГИН','','text','required pattern="[A-Za-z0-9_\\-]{3,32}" minlength="3" maxlength="32" autocomplete="username"')}${field('password','ПАРОЛЬ','','password',`required minlength="8" maxlength="128" autocomplete="${register?'new-password':'current-password'}"`)}<p class="muted">Логин: латинские буквы, цифры, _ и -. Пароль: минимум 8 символов.</p><button type="button" id="switchAuth">${register?'Уже есть аккаунт? Войти':'Нет аккаунта? Зарегистрироваться'}</button>`,async()=>{const result=await api(register?'/register':'/login',{login:$('#login').value,password:$('#password').value});user=result.user;renderUser();$('#modal').close();toast('Ты в мастерской. Теперь можно сохранить класс.');});
 $('#submitModal').textContent=register?'Зарегистрироваться':'Войти';$('#switchAuth').onclick=()=>{$('#modal').close();auth(!register);};
}
$('#auth').onclick=()=>auth();
$('#logout').onclick=async()=>{try{await api('/logout',{});user=null;projectId=null;renderUser();toast('Выход выполнен. Локальный черновик остаётся в этом браузере.');}catch(err){toast(err.message);}};
$('#save').onclick=async()=>{
 if(!user){auth();return;}const button=$('#save');button.disabled=true;
 try{const result=await api('/projects',{id:projectId,document:normalize(doc)});projectId=result.id;dirty=false;$('#saveState').textContent='Сохранено в аккаунте';toast('Класс и текущий билд сохранены');}catch(err){toast(err.message);}finally{button.disabled=false;}
};
$('#share').onclick=()=>{
 if(!user){auth();return;}
 modal('Поделиться классом и билдом','<p>Будет создана ссылка на текущую копию класса и распределение очков. Её смогут открыть все, у кого есть ссылка.</p><p class="muted">Последующие правки класса не изменят эту копию. Учётная запись автора не публикуется.</p>',async()=>{
  const result=await api('/share',{document:normalize(doc)});const url=new URL(location.href);url.search='';url.searchParams.set('share',result.token);url.hash='';
  $('#modal').close();modal('Ссылка готова',field('shareURL','СКОПИРУЙ ССЫЛКУ',url.href,'text','readonly')+'<p class="muted">Получатель сможет распределить очки и сохранить свою копию.</p>',null);$('#shareURL').select();
 });$('#submitModal').textContent='Создать ссылку';
};
$('#projects').onclick=async()=>{
 if(!user){auth();return;}
 try{const {projects}=await api('/projects');modal('Мои классы',projects.length?projects.map(p=>`<div class="library-item"><strong>${esc(p.name)}<br><small>${esc(new Date(p.updated*1000).toLocaleString('ru-RU'))}</small></strong><button type="button" data-open="${esc(p.id)}">Открыть</button><button type="button" data-copy="${esc(p.id)}">Копия</button><button type="button" class="danger" data-remove="${esc(p.id)}" aria-label="Удалить класс">×</button></div>`).join(''):'<div class="empty">Пока нет сохранённых классов.<br>Закрой окно и нажми «Сохранить».</div>',null);
 $('#modalBody').onclick=async e=>{const btn=e.target.closest('button');if(!btn)return;try{
  if(btn.dataset.remove){if(!confirm('Удалить сохранённый класс?'))return;await api('/projects/'+btn.dataset.remove,{},'DELETE');if(projectId===btn.dataset.remove)projectId=null;btn.closest('.library-item').remove();return;}
  const pid=btn.dataset.open||btn.dataset.copy;if(!pid)return;if(dirty&&!confirm('Заменить текущий черновик выбранным классом?'))return;
  const result=await api('/projects/'+pid);doc=normalize(result.document);projectId=btn.dataset.copy?null:pid;if(btn.dataset.copy)doc.name+=' — копия';changed();render();$('#modal').close();
 }catch(err){toast(err.message);}};
 }catch(err){toast(err.message);}
};
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
 panel.innerHTML=`<h2>${esc(doc.name)}</h2><p class="muted">${esc(c.race)} · ${esc(c.gender)}</p><label>ЗДОРОВЬЕ</label><div class="resource-bar" style="--resource-color:#459254"><span style="width:100%"></span><strong>${esc(c.hp)} / ${esc(c.hp)}</strong></div>${c.resources.map(r=>`<label>${esc(r.name)}</label>${r.display==='bar'?`<div class="resource-bar" style="--resource-color:${/^#[0-9a-f]{6}$/i.test(r.color)?r.color:'#397de1'}"><span style="width:${Math.min(100,Math.max(0,r.current/r.max*100))}%"></span><strong>${esc(r.current)} / ${esc(r.max)}</strong></div>`:`<div class="resource-symbols">${Array.from({length:Math.min(100,r.max)},(_,i)=>`<span class="resource-symbol ${['circle','triangle','diamond'].includes(r.shape)?r.shape:'circle'} ${i>=r.current?'spent':''}" style="background:${/^#[0-9a-f]{6}$/i.test(r.color)?r.color:'#397de1'}"></span>`).join('')}<small>${esc(r.current)} / ${esc(r.max)}</small></div>`}`).join('')}<div class="model-placeholder"><span>♙</span><strong>${esc(c.race)}</strong><p class="muted">3D-просмотр пока не подключён</p>${safeArmory(c.armory)?`<a target="_blank" rel="noopener noreferrer" href="${esc(c.armory)}">Открыть персонажа ↗</a>`:''}</div>`;
}
function safeArmory(value){try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='wowhead.com'||u.hostname.endsWith('.wowhead.com')||u.hostname==='worldofwarcraft.blizzard.com');}catch{return false;}}
$('#characterSettings').onclick=()=>{
 const c=structuredClone(character());
 const races=['Человек','Орк','Дворф','Ночной эльф','Нежить','Таурен','Гном','Тролль','Эльф крови','Дреней'];
 modal('Ресурсы и персонаж',`${field('hp','МАКСИМАЛЬНОЕ ЗДОРОВЬЕ',c.hp,'number','min="1" max="100000000" required')}<div class="two-cols"><div><label>РАСА</label><select id="race">${races.map(r=>`<option ${r===c.race?'selected':''}>${r}</option>`).join('')}</select></div><div><label>ПОЛ</label><select id="gender"><option ${c.gender==='Мужской'?'selected':''}>Мужской</option><option ${c.gender==='Женский'?'selected':''}>Женский</option></select></div></div>${field('armory','ССЫЛКА НА ПЕРСОНАЖА WOWHEAD / WORLD OF WARCRAFT',c.armory,'url')}<p class="muted">Ссылка сохраняется для перехода к персонажу. Она пока не загружает 3D-модель или экипировку.</p><div id="resourceEditor"></div><button type="button" id="addResource">＋ Добавить ресурс</button>`,()=>{
  readResources();c.hp=Number($('#hp').value);c.race=$('#race').value;c.gender=$('#gender').value;c.armory=$('#armory').value;
  if(c.armory&&!safeArmory(c.armory))throw Error('Нужна HTTPS-ссылка на Wowhead или официальный сайт World of Warcraft');
  for(const r of c.resources)if(!r.name.trim()||!Number.isInteger(r.max)||r.max<1||!Number.isInteger(r.current)||r.current<0||r.current>r.max||(r.display==='icons'&&r.max>100))throw Error('Проверь ресурс: максимум от 1, начальное значение от 0 до максимума. Для иконок — до 100.');
  doc.character=c;changed();render();$('#modal').close();
 });
 function readResources(){for(const [i,r] of c.resources.entries()){const root=$(`[data-resource="${i}"]`);if(!root)continue;for(const key of ['name','max','current','display','shape','color'])r[key]=root.querySelector(`[data-field="${key}"]`).value; r.max=Number(r.max);r.current=Number(r.current);}}
 function draw(){
  $('#resourceEditor').innerHTML=c.resources.map((r,i)=>`<fieldset data-resource="${i}"><legend>Ресурс ${i+1}</legend><label>ТИП</label><select data-type><option value="custom">Свой ресурс</option>${['Мана','Энергия','Ярость'].map(n=>`<option ${r.name===n?'selected':''}>${n}</option>`).join('')}</select><label>НАЗВАНИЕ</label><input data-field="name" value="${esc(r.name)}" required maxlength="60"><div class="two-cols"><div><label>МАКСИМУМ</label><input data-field="max" type="number" min="1" max="100000000" required value="${r.max}"></div><div><label>ПО УМОЛЧАНИЮ</label><input data-field="current" type="number" min="0" required value="${r.current}"></div><div><label>ВИД</label><select data-field="display"><option value="bar" ${r.display==='bar'?'selected':''}>Полоска</option><option value="icons" ${r.display==='icons'?'selected':''}>Иконки</option></select></div><div><label>ФОРМА</label><select data-field="shape">${[['circle','Круг'],['triangle','Треугольник'],['diamond','Ромб']].map(([v,n])=>`<option value="${v}" ${r.shape===v?'selected':''}>${n}</option>`).join('')}</select></div></div><label>ЦВЕТ</label><input data-field="color" type="color" value="${esc(r.color)}"><button type="button" data-remove-resource="${i}">Удалить ресурс</button></fieldset>`).join('');
  for(const root of document.querySelectorAll('[data-resource]'))root.querySelector('[data-type]').onchange=e=>{if(e.target.value!=='custom'){root.querySelector('[data-field="name"]').value=e.target.value;root.querySelector('[data-field="color"]').value={'Мана':'#397de1','Энергия':'#ddc742','Ярость':'#d63838'}[e.target.value];}};
  for(const btn of document.querySelectorAll('[data-remove-resource]'))btn.onclick=()=>{readResources();c.resources.splice(Number(btn.dataset.removeResource),1);draw();};
 }
 $('#addResource').onclick=()=>{readResources();c.resources.push({name:'Новый ресурс',max:5,current:5,display:'icons',shape:'diamond',color:'#d63838'});draw();};draw();
};
function showTooltip(target,x,y){
 if(mode!=='play')return;
 const tip=$('#tooltip');const id=target.dataset.talent;
 const t=doc.branches.flatMap(b=>b.talents).find(t=>t.id===id);
 const a=doc.abilities.find(a=>a.id===target.dataset.ability);
 if(!t&&!a)return;
 if(t){const rank=doc.build[t.id]||0,parent=doc.branches.flatMap(b=>b.talents).find(p=>p.id===t.requires),b=doc.branches.find(b=>b.talents.includes(t));tip.innerHTML=`<strong>${esc(t.name)}</strong><div>Талант · Ранг ${rank}/${t.maxRank}</div><p class="effect">${esc(t.descriptions[Math.max(0,rank-1)])}</p>${rank>0&&rank<t.maxRank?`<div>Следующий ранг:</div><p class="effect">${esc(t.descriptions[rank])}</p>`:''}<p class="requirements">${t.row?`Требуется ${t.row*doc.rowCost} очк. в ветке ${esc(b.name)}<br>`:''}${parent?'Требуется: '+esc(parent.name)+' ('+parent.maxRank+'/'+parent.maxRank+')':''}</p>`;
 }else tip.innerHTML=`<strong>${esc(a.name)}</strong><div class="spell-stats"><span>Стоимость: ${esc(a.resource||'Нет')}</span><span>Дальность: ${esc(a.range||'—')}</span><span>Применение: ${esc(a.cast||'Мгновенно')}</span><span>Восстановление: ${esc(a.cooldown||'Нет')}</span></div><p class="effect">${esc(a.description)}</p>`;
 tip.hidden=false;const box=tip.getBoundingClientRect();tip.style.left=Math.max(8,Math.min(x+16,innerWidth-box.width-8))+'px';tip.style.top=Math.max(8,Math.min(y+16,innerHeight-box.height-8))+'px';
}
let hoverTarget=null;
document.addEventListener('pointerover',e=>{const target=e.target.closest('[data-talent],[data-ability]');if(target){hoverTarget=target;showTooltip(target,e.clientX,e.clientY);}});
document.addEventListener('pointermove',e=>{if(hoverTarget)showTooltip(hoverTarget,e.clientX,e.clientY);});
document.addEventListener('pointerout',e=>{if(hoverTarget&&!hoverTarget.contains(e.relatedTarget)){hoverTarget=null;$('#tooltip').hidden=true;}});
document.addEventListener('focusin',e=>{if(e.target.matches('[data-talent],[data-ability]')){const r=e.target.getBoundingClientRect();showTooltip(e.target,r.right,r.top);}});
document.addEventListener('focusout',()=>$('#tooltip').hidden=true);
document.addEventListener('click',()=>{hoverTarget=null;$('#tooltip').hidden=true;});
render();api('/me').then(result=>{user=result.user;renderUser();}).catch(()=>toast('Сервер недоступен. Редактор работает, сохранение — через JSON.'));
const sharedToken=new URLSearchParams(location.search).get('share');
if(sharedToken) api('/shared/'+encodeURIComponent(sharedToken)).then(result=>{
 if(dirty&&!confirm('Открыть класс по ссылке и заменить черновик?'))return;
 doc=normalize(result.document);projectId=null;mode='play';render();$('#saveState').textContent='Копия класса по ссылке';toast('Открыта копия класса. Изменения не затрагивают оригинал.');
}).catch(err=>toast(err.message));
