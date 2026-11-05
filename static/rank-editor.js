import {renderRankTemplate,inferRankTemplate} from './rank-template.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createRankEditor(root,countInput,talent){
 let count=Number(countInput.value)||1,mode=talent.rankTemplate?'template':talent.name?'separate':'template';
 let texts=[...talent.descriptions],model=structuredClone(talent.rankTemplate||{text:texts[0]||'',variables:[]}),previewRank=0;
 const num=value=>Number(String(value).replace(',','.'));
 function capture(){for(const el of root.querySelectorAll('[data-description]'))texts[Number(el.dataset.description)]=el.value;}
 function result(){capture();if(mode==='separate')return{descriptions:Array.from({length:count},(_,i)=>texts[i]||''),rankTemplate:null};const saved={text:model.text,variables:model.variables.map(v=>({key:v.key,label:v.label,values:v.values.slice(0,count),start:v.start??v.values[0]??'0',step:v.step??'0'}))};return{descriptions:renderRankTemplate(saved,count),rankTemplate:saved};}
 function updatePreview(){
  const output=root.querySelector('#rankPreview');if(!output)return;
  try{const descriptions=mode==='template'?renderRankTemplate(model,count):Array.from({length:count},(_,i)=>texts[i]||'');output.textContent=descriptions[previewRank]||'Здесь появится описание таланта';output.classList.remove('preview-error');}catch(e){output.textContent=e.message;output.classList.add('preview-error');}
 }
 function draw(){
  root.innerHTML=`<div class="description-modes" role="group" aria-label="Описание рангов"><button type="button" data-mode="template" class="${mode==='template'?'selected':''}">Один текст, разные числа</button><button type="button" data-mode="separate" class="${mode==='separate'?'selected':''}">Отдельные тексты</button></div>${mode==='template'?`<label for="rankText">ОБЩЕЕ ОПИСАНИЕ</label><textarea id="rankText" maxlength="5000" placeholder="Например: Увеличивает урон на 2%.">${esc(model.text)}</textarea><p class="muted">Выдели число в тексте и нажми кнопку. Для каждого ранга меняй только значения в таблице.</p><button type="button" id="addRankNumber">＋ Сделать число изменяемым</button><div id="numberRules"></div><div id="rankValueTable"></div>`:`<p class="muted">Этот режим подходит, когда меняются целые предложения.</p><div class="separate-ranks">${Array.from({length:count},(_,i)=>`<label for="rank${i}">РАНГ ${i+1}</label><textarea id="rank${i}" data-description="${i}" maxlength="5000">${esc(texts[i]||'')}</textarea>`).join('')}</div>`}<section class="rank-preview"><label for="rankPreviewSelect">ПРЕДПРОСМОТР</label><select id="rankPreviewSelect">${Array.from({length:count},(_,i)=>`<option value="${i}" ${previewRank===i?'selected':''}>Ранг ${i+1} из ${count}</option>`).join('')}</select><p id="rankPreview" aria-live="polite"></p></section>`;
  for(const button of root.querySelectorAll('[data-mode]'))button.onclick=()=>{
   const target=button.dataset.mode;if(target===mode)return;
   if(mode==='template'){try{texts=renderRankTemplate(model,count);}catch(e){root.querySelector('#rankPreview').textContent=e.message;return;}}
   else{capture();const inferred=inferRankTemplate(Array.from({length:count},(_,i)=>texts[i]||''));if(!inferred&&!confirm('Тексты рангов отличаются словами. В общем режиме будет использован текст первого ранга. Продолжить?'))return;model=inferred||{text:texts[0]||'',variables:[]};}
   mode=target;draw();
  };
  root.querySelector('#rankPreviewSelect').onchange=e=>{previewRank=Number(e.target.value);updatePreview();};
  if(mode==='template'){
   root.querySelector('#rankText').oninput=e=>{model.text=e.target.value;updatePreview();};
   root.querySelector('#addRankNumber').onmousedown=e=>e.preventDefault();
   root.querySelector('#addRankNumber').onclick=()=>{
    if(model.variables.length>=32)return;
    const input=root.querySelector('#rankText'),start=input.selectionStart,end=input.selectionEnd,selected=input.value.slice(start,end);
    if(selected&&!/^[-+]?\d+(?:[.,]\d+)?$/.test(selected)){input.focus();root.querySelector('#rankPreview').textContent='Выдели только число, без знака % и единиц измерения.';return;}
    let n=1;while(model.variables.some(v=>v.key==='число'+n))n++;
    const key='число'+n;model.variables.push({key,label:'Число '+n,values:Array(count).fill(selected||'0'),start:selected||'0',step:'0'});
    model.text=input.value.slice(0,start)+'{'+key+'}'+input.value.slice(end);input.value=model.text;drawNumbers();updatePreview();
   };
   drawNumbers();
  }else for(const input of root.querySelectorAll('[data-description]'))input.oninput=()=>{capture();updatePreview();};
  updatePreview();
 }
 function drawNumbers(){
  const rules=root.querySelector('#numberRules'),table=root.querySelector('#rankValueTable');
  rules.innerHTML=model.variables.map((v,i)=>`<div class="number-rule" data-rule="${i}"><label>НАЗВАНИЕ ЧИСЛА<input data-number-label="${i}" value="${esc(v.label)}" maxlength="60" aria-label="Название числа ${i+1}"></label><label>НАЧАЛО<input data-start="${i}" value="${esc(v.start??v.values[0]??'0')}" inputmode="decimal" aria-label="Начало ${i+1}"></label><label>ШАГ<input data-step="${i}" value="${esc(v.step??'0')}" inputmode="decimal" aria-label="Шаг ${i+1}"></label><button type="button" data-fill="${i}">Заполнить</button><button type="button" data-remove-number="${i}" title="Убрать меняющееся число">×</button></div>`).join('');
  table.innerHTML=model.variables.length?`<p class="muted">«Начало 2, шаг 2» заполнит 2, 4, 6… Любую ячейку можно изменить вручную.</p><div class="values-scroll"><table class="rank-values"><thead><tr><th>Ранг</th>${model.variables.map(v=>`<th>${esc(v.label||v.key)}</th>`).join('')}</tr></thead><tbody>${Array.from({length:count},(_,rank)=>`<tr><th>${rank+1}</th>${model.variables.map((v,col)=>`<td><input data-value="${rank}:${col}" value="${esc(v.values[rank]??'')}" inputmode="decimal" maxlength="32" aria-label="${esc(v.label)}, ранг ${rank+1}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'';
  for(const el of rules.querySelectorAll('[data-number-label]'))el.oninput=e=>{const i=Number(el.dataset.numberLabel);model.variables[i].label=e.target.value;const th=table.querySelectorAll('thead th')[i+1];if(th)th.textContent=e.target.value;};
  for(const el of rules.querySelectorAll('[data-start]'))el.oninput=()=>model.variables[Number(el.dataset.start)].start=el.value;
  for(const el of rules.querySelectorAll('[data-step]'))el.oninput=()=>model.variables[Number(el.dataset.step)].step=el.value;
  for(const el of rules.querySelectorAll('[data-fill]'))el.onclick=()=>{
   const v=model.variables[Number(el.dataset.fill)],start=String(v.start??v.values[0]??'0'),step=String(v.step??'0');
   if(!/^[-+]?\d+(?:[.,]\d+)?$/.test(start)||!/^[-+]?\d+(?:[.,]\d+)?$/.test(step)){root.querySelector('#rankPreview').textContent='Введи числа в поля «Начало» и «Шаг»';return;}
   v.values=Array.from({length:count},(_,i)=>{const value=Number((num(start)+num(step)*i).toFixed(10));return start.includes(',')||step.includes(',')?String(value).replace('.',','):String(value);});drawNumbers();updatePreview();
  };
  for(const el of rules.querySelectorAll('[data-remove-number]'))el.onclick=()=>{const i=Number(el.dataset.removeNumber),v=model.variables[i];model.text=model.text.split('{'+v.key+'}').join(v.values[previewRank]??v.values[0]??'0');model.variables.splice(i,1);draw();};
  for(const el of table.querySelectorAll('[data-value]'))el.oninput=()=>{const [rank,col]=el.dataset.value.split(':').map(Number);model.variables[col].values[rank]=el.value;updatePreview();};
 }
 countInput.oninput=()=>{capture();count=Math.max(1,Math.min(100,Number(countInput.value)||1));previewRank=Math.min(previewRank,count-1);draw();};
 root.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('input')){e.preventDefault();if(e.target.dataset.value){const [rank,col]=e.target.dataset.value.split(':').map(Number);root.querySelector(`[data-value="${rank+1}:${col}"]`)?.focus();}}});
 draw();return{result};
}
