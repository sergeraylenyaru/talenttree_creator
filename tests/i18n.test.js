import test from 'node:test';
import assert from 'node:assert/strict';
import '../static/translations.js';
import {t,getLanguage,setLanguage} from '../static/i18n.js';
test('English default, complete phrases, dynamic numbers and uppercase labels',()=>{assert.equal(getLanguage(),'en');assert.equal(t('Ресурсы и персонаж'),'Resources & character');assert.equal(t('ЗДОРОВЬЕ'),'HEALTH');assert.equal(t('Версия 2 · Просмотры: 30'),'Version 2 · Views: 30');assert.equal(t('Start 123'),'Start 123');});
test('Russian can be selected and switched back without touching numbers',()=>{globalThis.document={body:null};setLanguage('ru');assert.equal(t('Ресурсы и персонаж'),'Ресурсы и персонаж');setLanguage('en');assert.equal(t('Шаг'),'Step');delete globalThis.document;});
