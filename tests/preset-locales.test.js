import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyPresetLocale,presetClassName} from '../static/preset-locales.js';
import {normalize} from '../static/engine.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../static/'+p,import.meta.url)));
const numbers=s=>(s.match(/\d+(?:[.,]\d+)?/g)||[]).map(s=>Number(s.replace(',','.'))).sort((a,b)=>a-b);
function expressions(text){const result=[];for(let i=0;i<text.length;i++)if(text.slice(i,i+2)==='${'){let end=i+2,depth=1;while(end<text.length&&depth){if(text[end]==='{')depth++;if(text[end]==='}')depth--;end++;}if(!depth)result.push(text.slice(i,end));}return result;}
test('all 38 presets load in English and Russian without changing talents, numbers or formulas',()=>{
 const index=read('presets/index.json');assert.equal(index.length,38);
 for(const entry of index){const original=read('presets/'+entry.id+'.json'),before=JSON.stringify(original),locale=read('preset-locales/ru/'+entry.id+'.json');
  for(const language of ['en','ru']){const d=normalize(applyPresetLocale(original,entry.id,language,locale));assert.equal(d.source.language,language);assert.equal(d.name,presetClassName(entry.id,language)+' · '+original.source.version);assert.equal(d.budget,original.budget);assert.equal(d.rowCost,original.rowCost);
   for(const [i,b] of d.branches.entries()){const src=original.branches[i];assert.equal(b.id,src.id);assert.equal(b.rows,src.rows);assert.equal(b.talents.length,src.talents.length);
    for(const [j,t] of b.talents.entries()){const base=src.talents[j];for(const key of ['id','row','col','maxRank','requires','icon','grantedAbilityId'])assert.deepEqual(t[key],base[key],entry.id+' '+key);if(language==='ru')assert.match(t.name,/[А-Яа-яЁё]/);
     for(const [rank,text] of t.descriptions.entries()){assert.deepEqual(numbers(text),numbers(base.descriptions[rank]),entry.id+' '+t.id+' rank '+rank);for(const expression of expressions(base.descriptions[rank]))assert.ok(text.includes(expression),entry.id+' '+t.id+' '+expression);}
    }
   }
   for(const [i,a] of d.abilities.entries()){const base=original.abilities[i];assert.equal(a.id,base.id);assert.deepEqual(numbers(a.description),numbers(base.description));if(language==='ru')assert.match(a.name,/[А-Яа-яЁё]/);}
  }
  assert.equal(JSON.stringify(original),before);
 }
});
test('missing or mismatched Russian data is reported and never silently copies an English tree',()=>{
 const d=read('presets/druid.json'),locale=read('preset-locales/ru/druid.json');assert.throws(()=>applyPresetLocale(d,'druid','ru'),/русский/);assert.throws(()=>applyPresetLocale(d,'mage','ru',locale),/русский/);
 const bad=structuredClone(locale);bad.branches[0].talents[0].descriptions=[];assert.throws(()=>applyPresetLocale(d,'druid','ru',bad),/соответствует/);
 const authored=applyPresetLocale(d,'druid','ru',locale);authored.name='Мой друид';assert.equal(presetClassName('druid','en'),'Druid');assert.equal(authored.name,'Мой друид');
});
