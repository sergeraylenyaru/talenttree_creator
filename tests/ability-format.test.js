import test from 'node:test';
import assert from 'node:assert/strict';
import {abilityStatLines} from '../static/ability-format.js';
import {blank,normalize,groupedAbilities,abilityUnlocked,placeAbilityTalent} from '../static/engine.js';
test('zero range/cast show melee and instant, and requirements are shown',()=>{
 const lines=abilityStatLines({range:0,cast:0,cooldown:12,requirements:['Кинжалы','Латы']},'20 Кровь');
 assert.ok(lines.includes('Дальность: Ближний бой'));assert.ok(lines.includes('Применение: Мгновенное'));assert.ok(lines.includes('Требуется: Кинжалы, Латы'));
 assert.ok(abilityStatLines({range:30,cast:1.5},'10').includes('Дальность: 30 м'));
});
test('class metadata, resource descriptions and ability requirements round-trip',()=>{
 const d=blank();d.subtitle='v1 воин света';d.description='История';d.character={hp:100,hpDescription:'Сила жизни',race:'Человек',gender:'Мужской',armory:'',resources:[{name:'Кровь',description:'За удары',max:100,current:0,unit:'points',display:'bar',shape:'circle',color:'#ff0000'}]};d.abilities=[{id:'a',name:'Удар',icon:'inv_misc_book_09',description:'Текст',requirements:['Кинжалы']}];
 assert.equal(normalize(structuredClone(d)).character.resources[0].description,'За удары');assert.equal(groupedAbilities(d).at(-1).icon,'inv_misc_book_09');
 const invalid=structuredClone(d);invalid.abilities[0].requirements=['Кинжалы','Кинжалы'];assert.throws(()=>normalize(invalid),/требования/);
});

test('branch grouping and learning requirements are independent',()=>{
 const d=blank(),a={id:'skill',name:'Удар',icon:'inv_misc_book_09',description:'Урон',branchId:d.branches[0].id,learningMode:'base'};d.abilities=[a];
 assert.equal(groupedAbilities(d)[0].active[0].id,a.id);assert.equal(abilityUnlocked(d,a),true);
 const placed=placeAbilityTalent(d,a.id,d.branches[0].id,0,0);assert.equal(placed.abilities[0].learningMode,'talent');assert.equal(abilityUnlocked(placed,placed.abilities[0]),false);
 placed.build[placed.branches[0].talents[0].id]=1;assert.equal(abilityUnlocked(placed,placed.abilities[0]),true);
 placed.abilities[0].learningMode='base';placed.build={};assert.equal(abilityUnlocked(placed,placed.abilities[0]),true);
});
