import {button,element,field,section,grid,table,label} from './rpg-ui.js';
import {validateItem} from './combat/rpg-profile.js';
import {addTranslations,t} from './i18n.js';

const captions=[
 ['Источник описывает импорт; ручные изменения предмета могут отличаться.','Source details describe the import; manual item changes may differ.'],
 ['Импорт из Wowhead','Import from Wowhead'],['Версия данных','Data version'],['Ссылка или ID предмета','Item link or ID'],['Загрузить предпросмотр','Load preview'],['Загрузка Wowhead…','Loading Wowhead…'],
 ['Добавить независимую копию','Add independent copy'],['Отменить предпросмотр','Cancel preview'],['Предпросмотр не меняет библиотеку и экипировку.','Preview does not change the library or equipped items.'],
 ['Подтверждённые поля','Imported fields'],['Не реализовано автоматически','Not implemented automatically'],['Описание Wowhead (обычный текст)','Wowhead description (plain text)'],['Источник предмета','Item source'],
 ['Проки, use-эффекты, комплекты, сокеты, чары и случайные свойства требуют отдельной настройки.','Procs, use effects, sets, sockets, enchants and random properties require separate configuration.'],
 ['Wowhead Cataclysm (/cata); соответствие оригинальному клиенту 4.3.4 отдельно не подтверждено.','Wowhead Cataclysm (/cata); original client 4.3.4 accuracy is not independently verified.'],
 ['Сохраните изменения персонажа и проект обычным способом. Предмет не надевается автоматически.','Save the character and project normally. The item is not equipped automatically.'],
 ['Неверная ссылка или ID. Нужна HTTPS-ссылка Wowhead Cataclysm.','Invalid link or ID. Use an HTTPS Wowhead Cataclysm link.'],['Поддерживается только версия Cataclysm (/cata).','Only Cataclysm (/cata) is supported.'],
 ['Предмет не найден.','Item not found.'],['Этот тип предмета нельзя точно представить в конструкторе.','This item type cannot be represented accurately in the constructor.'],
 ['Требования или характеристики этого предмета пока не поддерживаются.','This item has requirements or statistics that are not supported yet.'],['Wowhead блокирует загрузку или ограничивает запросы.','Wowhead blocked the request or rate limited the source.'],
 ['Не удалось загрузить Wowhead. Проверьте сеть и повторите.','Could not load Wowhead. Check the connection and retry.'],['Wowhead не ответил вовремя.','Wowhead timed out.'],['Формат ответа Wowhead изменился или не поддерживается.','The Wowhead response format changed or is unsupported.'],['Ответ источника слишком велик.','The source response is too large.'],
 ['Параметры вариантов предмета не поддерживаются. Используйте базовый ID.','Item variant parameters are unsupported. Use the base item ID.'],['Для импорта войдите в аккаунт.','Sign in to import items.'],['Описание и эффекты','Description and effects'],['Сокеты','Sockets'],['Бонусы комплекта','Set bonuses'],['Случайные свойства','Random properties'],['Дополнительный урон другой школы','Additional damage from another school'],['Допустимые слоты','Allowed slots'],['Классы','Classes'],['Без классового ограничения','No class restriction']
];
addTranslations(captions);
const errors={
 invalid_reference:'Неверная ссылка или ID. Нужна HTTPS-ссылка Wowhead Cataclysm.',wrong_version:'Поддерживается только версия Cataclysm (/cata).',not_found:'Предмет не найден.',unsupported_type:'Этот тип предмета нельзя точно представить в конструкторе.',
 unsupported_requirement:'Требования или характеристики этого предмета пока не поддерживаются.',unsupported_stats:'Требования или характеристики этого предмета пока не поддерживаются.',unsupported_variant:'Параметры вариантов предмета не поддерживаются. Используйте базовый ID.',
 source_blocked:'Wowhead блокирует загрузку или ограничивает запросы.',source_timeout:'Wowhead не ответил вовремя.',source_format:'Формат ответа Wowhead изменился или не поддерживается.',source_too_large:'Ответ источника слишком велик.',source_unavailable:'Не удалось загрузить Wowhead. Проверьте сеть и повторите.'
};
const omissions={tooltipEffects:'Описание и эффекты',sockets:'Сокеты',setBonus:'Бонусы комплекта',randomProperties:'Случайные свойства',additionalDamage:'Дополнительный урон другой школы'};
const metadataLabels={
 'metadata:displayid':['ID внешнего вида (не характеристика)','Appearance ID (not a statistic)'],
 'metadata:dmgrange':['Служебный разброс урона (используется готовый диапазон оружия)','Source damage spread (explicit weapon bounds are used)'],
 'metadata:dura':['Прочность (износ не моделируется)','Durability (wear is not simulated)'],
 'metadata:sheathtype':['Положение оружия в ножнах (не меняет экипировку)','Sheath placement (does not change equipment)'],
 'metadata:slotbak':['Служебный слот (используется inventorySlot XML)','Source slot bookkeeping (XML inventorySlot is used)']
};
addTranslations([...Object.values(metadataLabels),
 ['Лимит предметов в сумках не моделируется; лимит 1 запрещает надевать две копии.','Bag ownership is not simulated; a limit of 1 prevents equipping two copies.'],
 ['Эффекты jsonUse требуют ручной настройки; это не характеристики экипировки.','jsonUse effects require manual setup; these are not equipment statistics.']]);
Object.assign(omissions,{
 inventoryOwnership:'Лимит предметов в сумках не моделируется; лимит 1 запрещает надевать две копии.',
 useEffects:'Эффекты jsonUse требуют ручной настройки; это не характеристики экипировки.'
});


export function importedItemCopy(item){validateItem(item);return {...structuredClone(item),id:crypto.randomUUID()};}
export function itemSourceDetails(item){
 const source=item.source;if(!source)return element('span');
 const root=element('details',undefined,'wowhead-source');root.append(element('summary',t('Источник предмета')));
 const link=element('a',source.url);link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';
 root.append(element('p','Wowhead · Cataclysm (/cata) · ID '+source.itemId),link,element('p',t('Источник описывает импорт; ручные изменения предмета могут отличаться.')),element('p',t('Wowhead Cataclysm (/cata); соответствие оригинальному клиенту 4.3.4 отдельно не подтверждено.')),
  element('p',t('Подтверждённые поля')+': '+source.imported.map(key=>label(key.replace(/^stats\./,''))).join(', ')),element('p',t('Не реализовано автоматически')+': '+source.unmodeled.map(key=>t(metadataLabels[key]?.[0]??omissions[key]??key)).join(', ')),
  element('p',t('Проки, use-эффекты, комплекты, сокеты, чары и случайные свойства требуют отдельной настройки.')));
 const tooltip=element('details'),plain=element('pre',source.tooltipText);plain.dataset.userContent='';tooltip.append(element('summary',t('Описание Wowhead (обычный текст)')),plain);root.append(tooltip);
 return root;
}

export function wowheadItemImporter(onImport){
 const root=element('details',undefined,'wowhead-import');root.append(element('summary',t('Импорт из Wowhead')));
 const version=field(t('Версия данных'),'cataclysm',()=>{},{choices:[['cataclysm','Wowhead Cataclysm (/cata)']]});
 const input=element('input');input.type='text';input.maxLength=2048;input.placeholder='https://www.wowhead.com/cata/item=19019';input.setAttribute('aria-label',t('Ссылка или ID предмета'));
 const state=element('p');state.setAttribute('role','status');const preview=element('div');preview.className='wowhead-preview';
 let controller,loaded,generation=0;
 const reset=()=>{generation++;controller?.abort();loaded=undefined;preview.replaceChildren();state.textContent='';load.disabled=false;};
 const cancel=button(t('Отменить предпросмотр'),reset);
 const load=button(t('Загрузить предпросмотр'),async()=>{
  reset();const request=++generation;controller=new AbortController();load.disabled=true;state.textContent=t('Загрузка Wowhead…');
  try{
   const response=await fetch('/api/items/wowhead/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:input.value,version:'cataclysm'}),signal:controller.signal});
   const body=await response.json();if(request!==generation)return;
   if(!response.ok){state.textContent=t(response.status===401?'Для импорта войдите в аккаунт.':errors[body.code]??'Не удалось загрузить Wowhead. Проверьте сеть и повторите.');if(body.error)preview.append(element('p',body.error));return;}
   validateItem(body.item);if(body.version!=='cataclysm'||body.item.source?.version!=='cataclysm')throw Error('Version mismatch');loaded=structuredClone(body.item);
   const rows=[['ID',String(loaded.source.itemId)],[t('Версия данных'),'Cataclysm (/cata)'],['Item',loaded.name],['Icon',loaded.icon],['Quality',loaded.quality],['Item level',loaded.level],['Required level',loaded.requiredLevel??'—'],
    [t('Допустимые слоты'),loaded.allowedSlots.map(label).join(', ')],['Type',loaded.type],[t('Классы'),loaded.requiredClasses?.join(', ')??t('Без классового ограничения')],...Object.entries(loaded.stats).map(([key,value])=>[label(key),value])];
   for(const key of ['armor','minDamage','maxDamage','speed'])if(loaded[key]!==undefined)rows.push([label(key),loaded[key]]);
   state.textContent=t('Предпросмотр не меняет библиотеку и экипировку.');
   const source=itemSourceDetails(loaded);source.open=true;
   const confirm=button(t('Добавить независимую копию'),()=>{if(!loaded)return;const copy=importedItemCopy(loaded);try{onImport(copy);}catch(error){state.textContent=error.message;return;}loaded=undefined;preview.replaceChildren();state.textContent=t('Сохраните изменения персонажа и проект обычным способом. Предмет не надевается автоматически.');});
   const content=section(loaded.name,table(['Field','Value'],rows),source,confirm);content.querySelector('h3').dataset.userContent='';content.querySelectorAll('td').forEach(cell=>cell.dataset.userContent='');preview.append(content);
  }catch(error){if(error.name!=='AbortError'&&request===generation)state.textContent=t('Не удалось загрузить Wowhead. Проверьте сеть и повторите.');}
  finally{if(request===generation)load.disabled=false;}
 });
 input.addEventListener('input',()=>{if(loaded||controller)reset();});
 input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();if(!load.disabled)load.click();}});
 root.append(version,input,grid(load,cancel),state,preview);return root;
}
