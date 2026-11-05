// Templates are plain text plus numeric substitutions; never executable code.
export function renderRankTemplate(model,count){
 if(!model||typeof model.text!=='string'||model.text.length>5000||!Array.isArray(model.variables)||model.variables.length>32)throw Error('Проверь общее описание');
 const keys=new Set();
 for(const v of model.variables){
  if(typeof v.key!=='string'||!/^число\d+$/.test(v.key)||keys.has(v.key)||typeof v.label!=='string'||v.label.length>60||!Array.isArray(v.values)||v.values.length<count)throw Error('Проверь меняющиеся числа');keys.add(v.key);
  for(const value of v.values.slice(0,count))if(typeof value!=='string'||value.length>32||!/^[-+]?\d+(?:[.,]\d+)?$/.test(value)||!Number.isFinite(Number(value.replace(',','.'))))throw Error(`Заполни все ранги для «${v.label||v.key}» числами`);
 }
 for(const match of model.text.matchAll(/\{([^{}]+)\}/g))if(!keys.has(match[1]))throw Error(`Неизвестное число {${match[1]}}. Добавь его кнопкой под описанием.`);
 return Array.from({length:count},(_,i)=>model.text.replace(/\{([^{}]+)\}/g,(_,key)=>model.variables.find(v=>v.key===key).values[i]));
}
export function inferRankTemplate(descriptions){
 const pattern=/-?\d+(?:[.,]\d+)?/g;
 if(!descriptions.length)return {text:'',variables:[]};
 const chunks=descriptions.map(s=>s.split(pattern)),numbers=descriptions.map(s=>s.match(pattern)||[]);
 if(chunks.some(c=>JSON.stringify(c)!==JSON.stringify(chunks[0])))return null;
 const variables=[];let text=chunks[0][0];
 for(let i=0;i<numbers[0].length;i++){
  const values=numbers.map(n=>n[i]);
  if(values.some(v=>v!==values[0])){const key='число'+(variables.length+1);variables.push({key,label:'Число '+(variables.length+1),values});text+='{'+key+'}';}else text+=values[0];
  text+=chunks[0][i+1];
 }
 return {text,variables};
}
