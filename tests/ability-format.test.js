import test from 'node:test';
import assert from 'node:assert/strict';
import {abilityStatLines,abilityRequirementsText} from '../static/ability-format.js';
import {blank,normalize,groupedAbilities,abilityUnlocked,placeAbilityTalent} from '../static/engine.js';
test('zero range/cast show melee and instant, and requirements are shown',()=>{
 const lines=abilityStatLines({range:0,cast:0,cooldown:12,requirements:['Кинжалы','Латы']},'20 Кровь');
 assert.ok(lines.includes('Дальность: Ближний бой'));assert.ok(lines.includes('Применение: Мгновенное'));assert.ok(lines.includes('Требуется: Кинжалы, Латы'));
 assert.ok(abilityStatLines({range:30,cast:1.5},'10').includes('Дальность: 30 м'));
});
test('free and zero-cost abilities omit cost while keeping all other spell details',()=>{
 for(const cost of [undefined,'',0,'0','0%','0 Мана']){const lines=abilityStatLines({range:0,cast:0,cooldown:5},cost);assert.ok(!lines.some(s=>s.startsWith('Стоимость:')));assert.ok(lines.includes('Применение: Мгновенное'));assert.ok(lines.includes('Восстановление: 5 сек.'));}
 assert.ok(abilityStatLines({},'25% Мана').includes('Стоимость: 25% Мана'));
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

test('free-text requirements preserve arbitrary prose and support legacy choices',()=>{
 const requirement='Щит и свободная рука; стойка Стража (уровень 20)';
 const d=blank();d.abilities=[{id:'a',name:'Удар',icon:'inv_misc_book_09',description:'Урон',requirements:requirement}];
 assert.equal(normalize(structuredClone(d)).abilities[0].requirements,requirement);
 assert.ok(abilityStatLines(d.abilities[0]).includes('Требуется: '+requirement));
 assert.equal(abilityRequirementsText({requirements:['Латы','Кинжалы']}),'Латы, Кинжалы');
 assert.equal(abilityRequirementsText({requirements:''}),'');
 d.abilities[0].requirements='x'.repeat(1001);assert.throws(()=>normalize(d),/требования/);
});
test('common and unique abilities each contain active then passive without changing branch grouping',()=>{
 const d=blank(),branchId=d.branches[0].id;
 d.abilities=[{id:'ca',branchId},{id:'cp',branchId,kind:'passive'},{id:'ua',branchId,branchOnly:true},{id:'up',branchId,branchOnly:true,kind:'passive'},{id:'legacy',branchId,learningMode:'specialization'},{id:'general',branchId:''}];
 const rows=groupedAbilities(d),first=rows[0];
 assert.deepEqual(first.common.active.map(a=>a.id),['ca']);assert.deepEqual(first.common.passive.map(a=>a.id),['cp']);
 assert.deepEqual(first.unique.active.map(a=>a.id),['ua','legacy']);assert.deepEqual(first.unique.passive.map(a=>a.id),['up']);
 assert.deepEqual(rows.at(-1).common.active.map(a=>a.id),['general']);assert.equal(rows.at(-1).unique.active.length,0);
 assert.equal(d.abilities.length,6);
});
test('channeled spells show channel duration instead of instant and preserve their flag in JSON',()=>{
 assert.ok(abilityStatLines({channeled:true,cast:4.5}).includes('Применение: Поддерживаемое (4.5 сек.)'));
 assert.ok(abilityStatLines({channeled:true,cast:0}).includes('Применение: Поддерживаемое'));
 assert.ok(!abilityStatLines({channeled:true,cast:0}).some(s=>s.includes('Мгновенное')));
 assert.deepEqual(abilityStatLines({channeled:true,kind:'passive'}),['Пассивная способность']);
 const d=blank();d.abilities=[{id:'channel',name:'Луч',description:'Описание',icon:'spell_holy_holybolt',channeled:true}];
 assert.equal(normalize(JSON.parse(JSON.stringify(d))).abilities[0].channeled,true);
 for(const flag of [1,'true',null]){d.abilities[0].channeled=flag;assert.throws(()=>normalize(d),/поддерживаемого/);}
});
