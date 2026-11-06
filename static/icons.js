// Curated starter catalog, not a full 3.3.5a icon database.
export const icons = [
['spell_fire_fireball02','Огненный шар огонь маг'],['spell_fire_flamebolt','Пламя огонь'],['spell_fire_flameshock','Огненный шок шаман'],['spell_fire_sealoffire','Печать огня'],['spell_fire_burnout','Огонь взрыв'],
['spell_frost_frostbolt02','Ледяная стрела лед маг'],['spell_frost_frostnova','Кольцо льда'],['spell_frost_icestorm','Снежная буря лед'],['spell_frost_frostarmor02','Ледяная броня'],['spell_frost_manarecharge','Мана лед'],
['spell_nature_lightning','Молния шаман'],['spell_nature_chainlightning','Цепная молния'],['spell_nature_healingtouch','Целительное прикосновение друид'],['spell_nature_rejuvenation','Омоложение лечение'],['spell_nature_starfall','Звездопад друид'],['spell_nature_thorns','Шипы природа'],['spell_nature_lightningshield','Щит молний'],['spell_nature_earthbind','Земля тотем'],
['spell_holy_holybolt','Свет священник паладин'],['spell_holy_flashheal','Быстрое исцеление'],['spell_holy_powerwordshield','Слово силы щит'],['spell_holy_renew','Обновление лечение'],['spell_holy_sealofmight','Мощь паладин'],['spell_holy_divineintervention','Божественное вмешательство'],
['spell_shadow_shadowbolt','Стрела тьмы чернокнижник'],['spell_shadow_shadowwordpain','Слово тьмы боль'],['spell_shadow_deathcoil','Лик смерти'],['spell_shadow_summonvoidwalker','Демон бездна'],['spell_shadow_curseofsargeras','Проклятие'],['spell_shadow_psychicscream','Страх крик'],
['spell_arcane_blast','Чародейская вспышка маг'],['spell_arcane_arcanetorrent','Чародейский поток'],['spell_arcane_arcane01','Тайная магия'],
['ability_warrior_charge','Рывок воин'],['ability_warrior_battleShout','Боевой крик воин'],['ability_warrior_savageblow','Смертельный удар'],['ability_warrior_defensivestance','Защитная стойка'],['ability_warrior_cleave','Рассекающий удар'],['ability_warrior_shieldbash','Удар щитом'],
['ability_rogue_eviscerate','Потрошение разбойник'],['ability_stealth','Незаметность'],['ability_backstab','Удар в спину'],['ability_rogue_sprint','Спринт'],['ability_rogue_ambush','Внезапный удар'],['ability_hunter_aimedshot','Прицельный выстрел охотник'],['ability_hunter_beasttaming','Питомец зверь'],['ability_hunter_markedfordeath','Метка охотника'],
['spell_deathknight_frostpresence','Власть льда рыцарь смерти'],['spell_deathknight_bloodpresence','Власть крови'],['spell_deathknight_unholypresence','Власть нечестивости'],['spell_deathknight_deathstrike','Удар смерти'],['inv_sword_04','Меч оружие'],['inv_axe_09','Топор оружие'],['inv_shield_04','Щит'],['inv_staff_13','Посох'],['inv_misc_questionmark','Вопрос неизвестно']
].map(([id,label])=>({id:id.toLowerCase(),label}));
export function iconURL(id) {
 if(/^custom:[a-f0-9]{32}$/.test(id||''))return '/media/icons/'+id.slice(7)+'.png';
 if(/^wotlk:shared\/global\/talents\/[a-z]+\/images\/[a-z]+\/[a-z0-9'_,.\-]+\.jpg$/.test(id||'')) return 'https://raw.githubusercontent.com/CraftedRO/Offline-talent-calculator-for-WotLK-3.3.5a/master/'+id.slice(6).split('/').map(encodeURIComponent).join('/');
 if(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(id||'') && id.length<=350000)return id;
 return /^[a-z0-9_]+$/i.test(id||'')?`https://wow.zamimg.com/images/wow/icons/large/${id.toLowerCase()}.jpg`:'';
}
