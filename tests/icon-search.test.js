import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesIconSearch} from '../static/icon-search.js';
test('custom icons can be found by independent tags even with an opaque filename',()=>{
 const icon={id:'custom:abc',label:'ico001',tags:'лёд, frost, маг'};
 assert.ok(matchesIconSearch(icon,'лед'));assert.ok(matchesIconSearch(icon,'FRoST'));assert.ok(matchesIconSearch(icon,'маг лед'));
 assert.ok(matchesIconSearch(icon,'#лёд #маг'));assert.ok(matchesIconSearch(icon,'#frost'));
 assert.ok(matchesIconSearch(icon,'ico001 frost'));assert.ok(!matchesIconSearch(icon,'яд'));
});
test('retains name, internal ID and existing catalog keywords with no tags',()=>{
 const icon={id:'spell_fire_fireball02',label:'Огненный шар огонь маг'};
 for(const query of ['','   ','fireball','огонь','ОГНЕННЫЙ ШАР','огонь, маг'])assert.ok(matchesIconSearch(icon,query));
 assert.ok(!matchesIconSearch(icon,'fire лёд'));assert.ok(matchesIconSearch({name:'Legacy name'},'legacy'));
});
test('normalizes Unicode and accepts list tags from catalogs',()=>{
 assert.ok(matchesIconSearch({name:'Test',tags:['ice','маг']},'ＩＣＥ маг'));
 assert.ok(matchesIconSearch({label:'Зелёный',tags:''},'зеленый'));assert.ok(!matchesIconSearch({label:'Test',tags:''},'unknown'));
});
