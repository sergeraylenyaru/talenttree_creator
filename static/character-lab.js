import {wowheadItemImporter,itemSourceDetails} from './wowhead-item-import.js';
import {talentReadiness} from './combat/ability-readiness.js';
import {rollItemStats} from './combat/item-roll.js';
import {saveBuildSnapshot,restoreBuildSnapshot,detachLegacyBuilds} from './combat/build-snapshots.js';
import {configureCataclysmClass} from './combat/class-resources.js';
import {combatClasses,rulesets} from './combat/rulesets.js';
import {iconURL} from './icons.js';
import {classResources} from './resource-costs.js';
import {compileCombatBuild} from './combat/build-compiler.js';
import {deriveCharacterStats} from './combat/character-stats.js';
import {validBuild} from './engine.js';
import {combatSchools} from './combat/effect-validation.js';
import {attributes,primaryStats,secondaryStats,equipmentSlots,itemTypes,itemTypesForSlot,itemEligibility,equippedItems,
  meleeWeapons,rangedWeapons,qualities,hasteSystems,talentModifiers,procEvents,conditions,validateItem,validateRpg,removeRpgReferences,
  level60Primary,level60PrimaryBudget,primaryPointsUsed} from './combat/rpg-profile.js';
import {button,element,field,section,grid,table,tabs,download,format,label} from './rpg-ui.js';
import {comparisonPanel,statRows} from './training-grounds/combat-review.js';
import {addTranslations,t} from './i18n.js';

const tabLabels={Character:'Персонаж',Equipment:'Экипировка',Statistics:'Характеристики',
  'Buffs and Debuffs':'Баффы и дебаффы',Talents:'Таланты',Abilities:'Способности','Combat Analytics':'Боевая аналитика'};
const primaryLabels={strength:'Сила',agility:'Ловкость',intellect:'Интеллект',stamina:'Выносливость',spirit:'Дух'};
addTranslations([
  ...Object.entries(tabLabels).map(([en,ru])=>[ru,en]),
  ...Object.entries(primaryLabels).map(([key,ru])=>[ru,label(key)]),
  ['Персонаж и экипировка','Character Lab'], ['Бюджет базовых характеристик','Primary attribute budget'],
  ['Распределено','Spent'], ['Осталось','Remaining'], ['Сверх бюджета','Over budget'],
  ['Загрузить базовые характеристики 60-го уровня','Load level 60 primary attributes'],
  ['Настроить эффекты предмета','Configure item effects'],['Допустимые классы','Allowed classes'],['Бюджет не задан','No budget set'], ['Недопустимый бюджет характеристик','Invalid attribute budget'],
  ['Распредели характеристики целыми очками','Allocate whole points to primary attributes'],
  ['Превышен бюджет базовых характеристик','Primary attribute budget exceeded']
]);
const pages=Object.keys(tabLabels);
const id=()=>crypto.randomUUID();
const displayTypes={sword1:'One-handed sword',sword2:'Two-handed sword',axe:'One-handed axe',axe2:'Two-handed axe',mace:'One-handed mace',mace2:'Two-handed mace',polearm:'Polearm',fist:'Fist weapon',holdable:'Held in off hand',gun:'Gun'};
const choices=types=>types.map(type=>[type,displayTypes[type]??label(type)]);
const number={number:true};
const percentStats={critChance:{min:0,max:1},critMultiplier:{min:0,max:100},movementSpeed:{min:0,max:10}};

export function characterLab(source,{key,save,library,resourcesEditor,training}){
  const draft=detachLegacyBuilds(structuredClone(source));
  const profile=draft.rpg??={version:1};
  profile.attributes??={};profile.items??=[];profile.equipped??={};profile.formulas??=[];
  profile.resources??={};profile.bonuses??=[];profile.procs??=[];profile.builds??=[];
  profile.restrictions??={};profile.hasteUses??=[];profile.setBonuses??=[];
  const resources=classResources(draft.character).filter(resource=>resource.id!=='health');
  const talents=draft.branches.flatMap(branch=>branch.talents);
  const passive=draft.abilities.filter(ability=>ability.kind==='passive');
  const abilities=draft.abilities;
  const root=element('div',undefined,'rpg-lab');
  const notice=element('p','');notice.setAttribute('role','status');
  const body=element('div');
  root.append(notice,body);
  let page='Character', itemId=profile.items[0]?.id, selectedSlot='mainHand';
  let compare=element('div');
  let pointStatus;
  const change=(object,property,refresh=false)=>value=>{
    if(value==='')delete object[property];
    else object[property]=value;
    if(refresh)render();
    else updatePreview();
  };

  function calculated(profileOverride=profile){
    const doc={...draft,...{rpg:profileOverride}};
    return deriveCharacterStats(compileCombatBuild(doc));
  }

  function attempt(callback){
    return ()=>{
      notice.textContent='';
      try{callback();}
      catch(error){notice.textContent=error.message;}
    };
  }

  function persist(){
    validateRpg(draft,classResources(draft.character));
    if(!validBuild(draft,draft.build))throw Error('Invalid active talent build');
    save(draft);
  }

  const open=callback=>attempt(()=>{persist();callback();});

  function updatePreview(){
    if(page==='Statistics'&&pointStatus){
      const spent=primaryPointsUsed(profile.attributes);
      const remaining=profile.primaryBudget===undefined?null:profile.primaryBudget-spent;
      pointStatus.textContent=remaining===null?`${t('Распределено')}: ${format(spent)} · ${t('Бюджет не задан')}`
        : `${t('Распределено')}: ${format(spent)} / ${format(profile.primaryBudget)} · ${t(remaining<0?'Сверх бюджета':'Осталось')}: ${format(Math.abs(remaining))}`;
    }
    if(!compare.parentElement)return;
    try{
      if(page==='Equipment'){
        const item=profile.items.find(entry=>entry.id===itemId);
        if(!item){compare.replaceChildren();return;}
        const equipped=equippedItems(profile);
        const issue=itemEligibility(item,item.slot,profile,equipped);
        if(issue){compare.replaceChildren(element('p',issue,'rpg-notice'));return;}
        const before=calculated();
        const after=calculated({...profile,equipped:{...profile.equipped,[item.slot]:item.id}});
        const a=Object.fromEntries(statRows(after));
        const rows=statRows(before).filter(([key,value])=>a[key]!==value).map(([key,value])=>[key,value,a[key]]);
        const equippedWeapon=equipped[item.slot];
        if(item.speed)rows.push(['Weapon damage',equippedWeapon?.speed?equippedWeapon.minDamage+'–'+equippedWeapon.maxDamage:'Arena default',
          item.minDamage+'–'+item.maxDamage],['Swing interval',equippedWeapon?.speed??'Arena default',item.speed]);
        compare.replaceChildren(rows.length?table(['Statistic','Equipped','Selected'],rows):element('p','Same derived values.'));
      }else if(page==='Statistics'){
        const sheet=calculated();
        compare.replaceChildren(table(['Statistic','Result'],statRows(sheet)),
          section('Formula and equipment contributions',table(['Source','Statistic','Added'],sheet.contributions.map(row=>[row.source,label(row.key),row.value]))));
      }else if(page==='Character'){
        const sheet=calculated();
        compare.replaceChildren(table(['Resource','Starting','Maximum','Regen / sec','Decay / sec'],
          sheet.resources.map(resource=>[resource.name,resource.current,resource.max,resource.regen??0,resource.decay??0])));
      }
    }catch(error){compare.replaceChildren(element('p',error.message,'rpg-notice'));}
  }

  function rendersCharacter(){
    const incoming=profile.incoming;
    compare=element('div');
    const actions=grid(
      field('Training mode',profile.trainingMode??'normal',value=>{
        profile.trainingMode=value;
        if(value!=='normal')profile.testDuration??=60;
        if(value==='rotation')profile.seed??=13;
        if(['survival','hps'].includes(value))profile.incoming??={school:'physical',amount:200,interval:2};
        render();
      },{
        choices:[['normal','Normal Training'],['dps','DPS Test'],['hps','HPS Test'],['survival','Survival Test'],['rotation','Rotation Test'],['resource','Resource Test'],['ability','Ability Test']]}),
      field('Combat rules',profile.combatRules?.version??'talentforge-v1',value=>{
        if(value==='talentforge-v1')delete profile.combatRules;
        else{profile.level??=85;profile.combatRules={version:value,classId:'mage',targetLevel:profile.level+3};}
        render();
      },{choices:rulesets}),
      ...(profile.combatRules?[field('Combat class',profile.combatRules.classId,change(profile.combatRules,'classId'),{choices:combatClasses}),
        field('Target level',profile.combatRules.targetLevel,change(profile.combatRules,'targetLevel'),{...number,min:1,max:1000,step:1}),
        field('Attack position',profile.combatRules.position??'front',change(profile.combatRules,'position'),{choices:['front','behind']}),
        element('p','Cataclysm: base stats and ratings remain approximations without client build 15595 tables. Other levels require an explicit simulation scale. Arena front/behind uses geometry; this setting applies to headless tests.'),
        field('Rating simulation scale',profile.combatRules.ratingScale??1,change(profile.combatRules,'ratingScale'),{...number,min:.000001,max:1000})
      ]:[]),
      field('Level',profile.level??1,change(profile,'level'),{...number,min:1,max:1000,step:1}),
      field('Primary autoattack slot',profile.autoSlot??'mainHand',change(profile,'autoSlot'),{choices:['mainHand','ranged']}),
      field('Allow dual wield',profile.restrictions.dualWield,change(profile.restrictions,'dualWield'),{check:true}),
      field('Enable controlled incoming damage',Boolean(incoming),value=>{
        if(value)profile.incoming={school:'physical',amount:200};else delete profile.incoming;render();
      },{check:true}),
      field('Test seed',profile.seed??'',change(profile,'seed'),{...number,max:4294967295,step:1}),
      field('Measurement duration, seconds',profile.testDuration??'',change(profile,'testDuration'),{...number,min:1,max:3600})
    );
    const gear=element('details');gear.append(element('summary','Restrict item types for this class'));
    gear.append(element('p','An empty selection allows every item type.'));
    gear.append(grid(...itemTypes.map(type=>field(displayTypes[type]??label(type),profile.restrictions.types?.includes(type),enabled=>{
      const allowed=profile.restrictions.types??=[];
      profile.restrictions.types=enabled?[...new Set([...allowed,type])]:allowed.filter(item=>item!==type);
      updatePreview();
    },{check:true}))));
    const mechanics=section('Haste systems',grid(...hasteSystems.map(name=>field(label(name),profile.hasteUses.includes(name),checked=>{
      profile.hasteUses=checked?[...profile.hasteUses,name]:profile.hasteUses.filter(key=>key!==name);updatePreview();
    },{check:true}))));
    const resourcePanel=section('Resource behavior',button('Open class resource editor',open(resourcesEditor)));
    for(const resource of resources){
      const rules=profile.resources[resource.id]??={};
      resourcePanel.append(grid(
        field(resource.name+' · Resource kind',rules.kind??'',change(rules,'kind'),{choices:[['','Legacy detection'],'mana','energy','rage','focus','combo','rune','custom']}),
        field(resource.name+' · Rune pair',rules.rune??false,change(rules,'rune'),{check:true}),
        field(resource.name+' · Rune recovery seconds',rules.recharge??10,change(rules,'recharge'),{...number,min:.25,max:120})
      ));
      resourcePanel.append(section(resource.name,grid(...[
        ['regen','In-combat regeneration / sec'],['outOfCombatRegen','Out-of-combat regeneration / sec'],['decay','Decay / sec'],['onHit','Generated on hit'],['onCrit','Extra on critical hit']
      ].map(([property,title])=>field(title,rules[property]??0,change(rules,property),{...number,max:1e6})))));
    }
    resourcePanel.append(compare);
    const progression=section('Author-defined level progression',element('p','These growth values belong to this custom class and are not official Blizzard tables.'),
      field('Enable level progression',Boolean(profile.progression),enabled=>{
        if(enabled)profile.progression={baseLevel:profile.level??1,healthPerLevel:0,attributesPerLevel:{},resourcePerLevel:{}};
        else delete profile.progression;render();
      },{check:true}));
    if(profile.progression){
      const growth=profile.progression;growth.attributesPerLevel??={};growth.resourcePerLevel??={};
      progression.append(grid(field('Progression base level',growth.baseLevel,change(growth,'baseLevel'),{...number,min:1,max:1000,step:1}),
        field('Health per level',growth.healthPerLevel??0,change(growth,'healthPerLevel'),{...number,max:1e5}),
        ...primaryStats.map(stat=>field(label(stat)+' per level',growth.attributesPerLevel[stat]??0,change(growth.attributesPerLevel,stat),{...number,max:1e5})),
        ...resources.map(resource=>field(resource.name+' per level',growth.resourcePerLevel[resource.id]??0,change(growth.resourcePerLevel,resource.id),{...number,max:1e5}))));
    }
    const result=element('div');
    result.append(section('Training character',actions,gear,
      ...(profile.combatRules?[button('Apply class resource defaults',()=>{
        const configured=configureCataclysmClass(draft,profile.combatRules.classId);
        Object.assign(draft.character,configured.character);
        Object.assign(profile,configured.rpg);
        resources.splice(0,resources.length,...classResources(draft.character).filter(resource=>resource.id!=='health'));
        render();
      }),element('p','Resource defaults are provisional Talent Forge tuning. Existing resources and costs are preserved.')]:[]),
      button('Open Training Grounds',open(training))));
    if(incoming)result.append(section('Manual dummy strike',grid(
      field('Damage school',incoming.school,change(incoming,'school'),{choices:combatSchools}),
      field('Манекен: подготовка заклинания, сек. / Dummy cast seconds',incoming.castTime??'',change(incoming,'castTime'),{...number,min:.25,max:30}),
      field('Scenario interval, seconds',incoming.interval??2,change(incoming,'interval'),{...number,min:.25,max:120}),
      field('Raw damage',incoming.amount,change(incoming,'amount'),{...number,min:1}),
      field('Can critically strike',incoming.canCrit??false,change(incoming,'canCrit'),{check:true}),
      field('Incoming critical chance',incoming.critChance??0,change(incoming,'critChance'),{...number,max:1}),
      field('Incoming critical multiplier',incoming.critMultiplier??2,change(incoming,'critMultiplier'),{...number,min:1,max:10})
    )));
    result.append(mechanics,resourcePanel,progression);
    return result;
  }

  function rendersStats(){
    compare=element('div');
    pointStatus=element('p',undefined,'rpg-notice');
    pointStatus.setAttribute('role','status');
    const budget=field('Бюджет базовых характеристик',profile.primaryBudget??'',change(profile,'primaryBudget',true),
      {...number,max:5e8,step:1,key:'primary-budget'});
    const baseline=button('Загрузить базовые характеристики 60-го уровня',()=>{
      profile.level??=60;
      profile.primaryBudget=level60PrimaryBudget;
      Object.assign(profile.attributes,level60Primary);
      render();
    });
    const form=grid(...attributes.map(attribute=>{
      const outer=field(primaryLabels[attribute]??label(attribute),profile.attributes[attribute]??'',change(profile.attributes,attribute),
        {...number,...percentStats[attribute],...(profile.primaryBudget!==undefined&&primaryStats.includes(attribute)?{step:1}:{}),key:'stat-'+attribute});
      if(attribute==='critChance')outer.title='Fraction, such as 0.10 for 10%.';
      if(attribute==='critMultiplier')outer.title='Multiplier, such as 2 for twice normal damage.';
      if(attribute==='maxHealth')outer.title='Adds to the class maximum health.';
      return outer;
    }));
    const targets=[...choices(secondaryStats),...resources.map(resource=>['resource:'+resource.id,resource.name+' maximum'])];
    const formulas=section('Scaling formulas');
    for(const [index,formula] of profile.formulas.entries()){
      formulas.append(grid(field('From',formula.from,change(formula,'from'),{choices:primaryStats}),
        field('Adds to',formula.to,change(formula,'to'),{choices:targets}),
        field('Per point',formula.factor,change(formula,'factor'),{...number,min:-10000,max:10000}),
        button('Remove formula',()=>{profile.formulas.splice(index,1);render();})));
    }
    formulas.append(button('Add formula',()=>{profile.formulas.push({from:'strength',to:'attackPower',factor:2});render();}));
    return grid(section('Base attributes',grid(budget,baseline),pointStatus,form,formulas),section('Derived statistics',compare));
  }

  function unequipItem(id){
    for(const map of [profile.equipped,...profile.builds.filter(build=>!build.combatSnapshot).map(build=>build.equipped)]){
      for(const [slot,value] of Object.entries(map))if(value===id)delete map[slot];
    }
  }
  function configureType(item,type){
    item.type=type;
    if([...meleeWeapons,...rangedWeapons].includes(type)){
      item.minDamage??=35;item.maxDamage??=55;item.speed??=2;
    }else for(const key of ['minDamage','maxDamage','speed'])delete item[key];
  }
  function makeItem(){
    const item={id:id(),name:'New item',description:'',icon:'forge-steel',level:1,quality:'common',slot:selectedSlot,stats:{}};
    configureType(item,itemTypesForSlot(selectedSlot)[0]);
    profile.items.push(item);itemId=item.id;render();
  }
  const wowheadImport=wowheadItemImporter(item=>{if(profile.items.length>=128)throw Error('Equipment library limit: 128');profile.items.push(item);itemId=item.id;render();});
  function rendersEquipment(){
    compare=element('div');
    const library=section('Equipment library',grid(
      field('New item slot',selectedSlot,value=>selectedSlot=value,{choices:equipmentSlots}),
      button('Create item',makeItem)));
    const uploaded=element('input');uploaded.type='file';uploaded.accept='.json,application/json';uploaded.hidden=true;
    uploaded.onchange=async()=>{
      const file=uploaded.files[0];if(!file)return;
      try{
        if(file.size>100000)throw Error('Item file is too large');
        const payload=JSON.parse(await file.text());
        if(payload.type!=='talentforge-item'||payload.version!==1)throw Error('Invalid item file');
        validateItem(payload.item);
        const item={...payload.item,id:id()};
        profile.items.push(item);itemId=item.id;render();
      }catch(error){notice.textContent=error.message;}
    };
    library.append(uploaded,button('Import item',()=>uploaded.click()),wowheadImport);
    const equipped=equippedItems(profile);
    const slots=section('Equipment slots',table(['Slot','Equipped item'],equipmentSlots.map(slot=>{
      const holder=element('div');
      const item=equipped[slot];
      const select=field(label(slot),item?.id??'',attempt(()=>{}),{choices:[['','Empty'],
        ...profile.items.filter(entry=>(entry.allowedSlots??[entry.slot]).includes(slot)&&!entry.disabled).map(entry=>[entry.id,entry.name])]});
      select.querySelector('select').setAttribute('aria-label',label(slot));
      select.querySelector('select').onchange=event=>{
        const value=event.target.value;
        attempt(()=>{
          if(!value)delete profile.equipped[slot];
          else{
            const next=profile.items.find(entry=>entry.id===value);
            const issue=itemEligibility(next,slot,profile,equipped);
            if(issue){event.target.value=item?.id??'';throw Error(issue);}
            profile.equipped[slot]=value;itemId=value;
          }
          render();
        })();
      };
      if(item){
        const url=iconURL(item.icon);
        if(url){const img=element('img');img.src=url;img.alt='';img.className='rpg-item-icon';img.onerror=()=>img.remove();holder.append(img);}
        holder.title=item.name+' · '+label(item.quality)+' · '+item.description;
      }
      holder.append(select);return [label(slot),holder];
    })));
    const selector=field('Edit item',itemId??'',value=>{itemId=value;render();},{choices:[['','Select item'],...profile.items.map(item=>[item.id,item.name])]});
    selector.querySelector('select').setAttribute('aria-label','Edit item');
    library.append(selector);
    const item=profile.items.find(entry=>entry.id===itemId);
    if(item){
      item.stats??={};
      const icon=element('img');icon.alt='';icon.className='rpg-item-icon';icon.src=iconURL(item.icon);
      icon.onerror=()=>icon.hidden=true;
      library.append(icon,grid(
        field('Set identifier',item.setId??'',change(item,'setId')),
        field('Required class',item.requiredClass??'',change(item,'requiredClass'),{choices:[['','Any class'],...combatClasses]}),
        field('Item name',item.name,change(item,'name'),{key:'item-name'}),
        field('Quality',item.quality,change(item,'quality'),{choices:qualities}),
        field('Item level',item.level,change(item,'level'),{...number,min:1,max:1000,step:1}),
        field('Required hero level',item.requiredLevel??1,change(item,'requiredLevel'),{...number,min:1,max:1000,step:1}),
        field('Item slot',item.slot,value=>{unequipItem(item.id);item.slot=value;if(!item.allowedSlots)configureType(item,itemTypesForSlot(value)[0]);render();},{choices:item.allowedSlots??equipmentSlots}),
        field('Item type',item.type,value=>{configureType(item,value);render();},{choices:choices(itemTypesForSlot(item.slot).filter(type=>(item.allowedSlots??[item.slot]).every(slot=>itemTypesForSlot(slot).includes(type))))}),
        field('Item icon',item.icon,value=>{item.icon=value;icon.hidden=false;icon.src=iconURL(value);},{choices:[
          ...new Map([['forge-steel','Sword'],['forge-light','Light'],['forge-frost','Frost'],['forge-ember','Fire'],
            ['forge-nature','Nature'],['forge-arcane','Arcane'],[item.icon,item.icon]])]}),
        field('Armor value',item.armor??0,change(item,'armor'),number),
        field('Disabled',item.disabled,value=>{item.disabled=value;if(value)unequipItem(item.id);render();},{check:true})
      ));
      if(item.source)library.append(itemSourceDetails(item),button(t('Настроить эффекты предмета'),()=>{page='Buffs and Debuffs';render();}));
      if(item.requiredClasses){const classes=section(t('Допустимые классы'));classes.append(grid(...combatClasses.map(key=>field(label(key),item.requiredClasses.includes(key),checked=>{item.requiredClasses=checked?[...item.requiredClasses,key]:item.requiredClasses.filter(value=>value!==key);if(!item.requiredClasses.length)delete item.requiredClasses;render();},{check:true}))));library.append(classes);}
      if(item.speed!==undefined)library.append(grid(
        field('Minimum weapon damage',item.minDamage,change(item,'minDamage'),number),
        field('Maximum weapon damage',item.maxDamage,change(item,'maxDamage'),number),
        field('Weapon speed, seconds',item.speed,change(item,'speed'),{...number,min:.4,max:30})
      ));
      library.append(field('Description',item.description,change(item,'description'),{multiline:true}));
      const bonuses=element('details');bonuses.append(element('summary','Item stat bonuses'));
      bonuses.append(grid(...attributes.map(stat=>field(label(stat),item.stats[stat]??'',value=>{delete item.roll;change(item.stats,stat)(value);},
        {...number,min:stat==='critChance'?-1:-1e8,max:stat==='critChance'?1:1e8,key:'item-stat-'+stat}))));
      let rollSeed=item.roll?.seed??13;
      library.append(section('Authored random statistics',element('p','Roll existing stat bonuses within ±20%. This is simulator tuning, not an official random-affix table.'),
        field('Item roll seed',rollSeed,value=>rollSeed=value,{...number,max:4294967295,step:1}),
        button('Roll item statistics',attempt(()=>{Object.assign(item,rollItemStats(item,rollSeed));render();})),
        ...(item.roll?[button('Restore unrolled statistics',()=>{item.stats=structuredClone(item.roll.baseStats);delete item.roll;render();})]:[])));
      library.append(bonuses,grid(
        button('Equip selected item',attempt(()=>{
          validateItem(item);
          const issue=itemEligibility(item,item.slot,profile,equipped);
          if(issue)throw Error(issue);
          profile.equipped[item.slot]=item.id;render();
        })),
        button('Duplicate item',()=>{
          const copy={...structuredClone(item),id:id(),name:item.name.slice(0,90)+' (copy)'};
          profile.items.push(copy);itemId=copy.id;render();
        }),
        button('Export item',attempt(()=>{
          validateItem(item);download('talentforge-item.json',JSON.stringify({type:'talentforge-item',version:1,item},null,2));
        })),
        button('Delete item',()=>{
          if(!window.confirm('Delete this item from the class library and its builds?'))return;
          removeRpgReferences(profile,'item',item.id);profile.items=profile.items.filter(entry=>entry.id!==item.id);
          itemId=profile.items[0]?.id;render();
        })
      ),section('Stat comparison',compare));
    }
    const sets=section('Equipment set bonuses',button('Create set bonus',()=>{
      profile.setBonuses.push({id:id(),name:'Set bonus',setId:'training-set',pieces:2,stats:{attackPower:20}});render();
    }));
    for(const bonus of profile.setBonuses){
      sets.append(section(bonus.name,grid(
        field('Set name',bonus.name,change(bonus,'name')),
        field('Set identifier',bonus.setId,change(bonus,'setId')),
        field('Required pieces',bonus.pieces,change(bonus,'pieces'),{...number,min:1,max:17,step:1}),
        ...secondaryStats.map(key=>field(label(key),bonus.stats[key]??0,change(bonus.stats,key),{...number,min:key==='critChance'?-1:-1e8,max:key==='critChance'?1:1e8}))
      ),button('Remove set bonus',()=>{removeRpgReferences(profile,'set',bonus.id);profile.setBonuses=profile.setBonuses.filter(entry=>entry!==bonus);render();})));
    }
    const result=element('div');result.append(grid(slots,library),sets);return result;
  }

  function sources(kind){
    return kind==='talent'?talents:kind==='passive'?passive:kind==='ability'?abilities:kind==='set'?profile.setBonuses:profile.items;
  }
  function ownerFields(rule){
    return grid(field('Source type',rule.owner.kind,value=>{rule.owner={kind:value,id:sources(value)[0]?.id??''};render();},
      {choices:['talent','passive','ability','item','set']}),
      field('Source',rule.owner.id,change(rule.owner,'id'),{choices:[['','Choose source'],...sources(rule.owner.kind).map(item=>[item.id,item.name])]}),
      field('Only in class state',rule.state?.key??'',value=>{if(value)rule.state={key:value,value:rule.state?.value??'battle'};else delete rule.state;render();},{choices:[['','Any state'],...['form','stance','aspect','seal','mode']]}),
      ...(rule.state?[field('Required state value',rule.state.value,change(rule.state,'value'))]:[]),
      ...(rule.owner.kind==='talent'?[field('Minimum talent rank',rule.owner.rank??1,change(rule.owner,'rank'),{...number,min:1,max:100,step:1})]:[]));
  }
  function newOwner(){
    const kind=page==='Talents'?'talent':page==='Abilities'?'passive':profile.items.length?'item':passive.length?'passive':'talent';
    return {kind,id:kind==='item'?(itemId??sources(kind)[0]?.id??''):sources(kind)[0]?.id??''};
  }
  function conditionFields(holder,key='condition',depth=0){
    const c=holder[key];
    const root=section('Условие / Condition');
    const options=conditions.filter(type=>depth<2||!['all','any','not'].includes(type));
    root.append(field('Condition type',c?.type??'',value=>{
      if(!value)delete holder[key];
      else if(['all','any'].includes(value))holder[key]={type:value,conditions:[{type:'playerBelow',value:50}]};
      else if(value==='not')holder[key]={type:value,condition:{type:'playerBelow',value:50}};
      else holder[key]={type:value,value:value==='critical'?true:['playerBelow','dummyBelow','resourceAbove','resourceBelow'].includes(value)?35:value==='weapon'?'sword1':value==='school'?'fire':value==='previousEvent'?'damage':value==='talentRank'?talents[0]?.id??'':value==='state'?'battle':'',
        ...['resourceAbove','resourceBelow'].includes(value)?{resource:resources[0]?.id??''}:{},
        ...value==='state'?{key:'stance'}:{},...value==='auraStacks'?{target:'player',stacks:1}:{},...value==='talentRank'?{rank:1}:{},...value==='previousEvent'?{window:5}:{}};
      render();
    },{choices:[['','Без условия / Any'],...options]}));
    if(!c)return root;
    if(['all','any'].includes(c.type)){
      c.conditions.forEach((child,index)=>root.append(conditionFields(c.conditions,index,depth+1),button('Remove condition',()=>{c.conditions.splice(index,1);render();})));
      if(c.conditions.length<8)root.append(button('Add condition',()=>{c.conditions.push({type:'playerBelow',value:50});render();}));
    }else if(c.type==='not')root.append(conditionFields(c,'condition',depth+1));
    else{
      if(['playerBelow','dummyBelow','resourceAbove','resourceBelow'].includes(c.type))root.append(field('Threshold',c.value,change(c,'value'),{...number,max:['resourceAbove','resourceBelow'].includes(c.type)?1e8:100}));
      if(['resourceAbove','resourceBelow'].includes(c.type))root.append(field('Condition resource',c.resource,change(c,'resource'),{choices:resources.map(resource=>[resource.id,resource.name])}));
      if(['playerStatus','dummyStatus','auraStacks'].includes(c.type))root.append(field('Aura ID or name',c.value,change(c,'value')));
      if(c.type==='auraStacks')root.append(field('Aura target',c.target,change(c,'target'),{choices:['player','dummy']}),field('Minimum stacks',c.stacks,change(c,'stacks'),{...number,min:1,max:10,step:1}));
      if(c.type==='state')root.append(field('State key',c.key,change(c,'key'),{choices:['form','stance','aspect','seal','mode']}),field('State value',c.value,change(c,'value')));
      if(c.type==='talentRank')root.append(field('Talent',c.value,change(c,'value'),{choices:talents.map(t=>[t.id,t.name])}),field('Talent rank',c.rank,change(c,'rank'),{...number,min:1,max:100,step:1}));
      if(c.type==='previousEvent')root.append(field('Previous event',c.value,change(c,'value'),{choices:procEvents}),field('Within seconds',c.window,change(c,'window'),{...number,min:.01,max:300}),field('Previous ability',c.abilityId??'',change(c,'abilityId'),{choices:[['','Any'],...abilities.map(a=>[a.id,a.name])]}));
      if(['school','weapon'].includes(c.type))root.append(field('Condition value',c.value,change(c,'value'),{choices:c.type==='school'?combatSchools:itemTypes}));
    }
    return root;
  }

  function rendersRules(){
    const root=element('div');
    const type=page==='Talents'?'talent':page==='Abilities'?'passive':null;
    const matches=rule=>!type||rule.owner.kind===type||page==='Abilities'&&rule.owner.kind==='ability';
    const bonuses=section('Passive and talent bonuses',
      element('p','Attribute bonuses are added as written. Ability modifiers are percent changes. A passive ability can also contain permanent player stat effects.'));
    for(const rule of profile.bonuses.filter(matches)){
      bonuses.append(section('Bonus',ownerFields(rule),grid(
        field('Statistic or modifier',rule.stat,value=>{rule.stat=value;if(!talentModifiers.includes(value)){delete rule.spell;delete rule.condition;delete rule.masteryScale;}render();},
          {choices:[...attributes,...talentModifiers]}),
        field('Amount',rule.amount,change(rule,'amount'),{...number,min:-100,max:10000}),
        ...(talentModifiers.includes(rule.stat)?[field('Affects',rule.spell??'',change(rule,'spell'),
          {choices:[['','All abilities'],...abilities.map(ability=>[ability.id,ability.name])]})]:[])
      ),...(talentModifiers.includes(rule.stat)?[field('Процент за очко искусности / % per mastery point',rule.masteryScale??'',change(rule,'masteryScale'),{...number,max:100}),conditionFields(rule)]:[]),button('Remove bonus',()=>{profile.bonuses=profile.bonuses.filter(entry=>entry!==rule);render();})));
    }
    bonuses.append(button('Add bonus',()=>{profile.bonuses.push({id:id(),owner:newOwner(),stat:'attackPower',amount:10});render();}));
    const procs=section('Combat triggers',element('p','Choose an existing effect as payload. Harmful payloads require a confirmed hostile hit.'));
    const spells=abilities.filter(ability=>ability.combatEffects?.length);
    for(const proc of profile.procs.filter(matches)){
      const spell=spells.find(ability=>ability.id===proc.spell);
      procs.append(section(proc.name,ownerFields(proc),grid(
        field('Proc name',proc.name,change(proc,'name')),
        field('Event',proc.event,change(proc,'event'),{choices:procEvents}),
        field('Priority',proc.priority??0,change(proc,'priority'),{...number,min:0,max:1000,step:1}),
        field('Maximum triggers',proc.charges??'',change(proc,'charges'),{...number,min:1,max:1000,step:1}),
        field('Consecutive critical events',proc.consecutive??false,change(proc,'consecutive'),{check:true}),
        field('Allow proc chain',proc.chain??false,change(proc,'chain'),{check:true}),
        field('Source ability',proc.sourceAbilityId??'',change(proc,'sourceAbilityId'),{choices:[['','Any ability'],...abilities.map(item=>[item.id,item.name])]}),
        field('School filter',proc.school??'',change(proc,'school'),{choices:[['','Any school'],...combatSchools]}),
        field('Attack filter',proc.attackType??'',change(proc,'attackType'),{choices:[['','Any attack'],'auto','direct','periodic']}),
        field('PPM (autoattack only)',proc.ppm??'',change(proc,'ppm'),{...number,min:.01,max:60}),
        field('Chance, 0–1',proc.chance,change(proc,'chance'),{...number,max:1}),
        field('Internal cooldown, sec.',proc.cooldown,change(proc,'cooldown'),{...number,max:3600}),
        field('Every qualifying event',proc.every??1,change(proc,'every'),{...number,min:1,max:100,step:1}),
        field('Effect ability',proc.spell,value=>{
          proc.spell=value;proc.effect=spells.find(ability=>ability.id===value)?.combatEffects[0]?.id??'';render();
        },{choices:[['','Choose ability'],...spells.map(ability=>[ability.id,ability.name])]}),
        field('Payload effect',proc.effect,change(proc,'effect'),{
          choices:(spell?.combatEffects??[]).map(effect=>[effect.id,(effect.name??label(effect.type))+' · '+effect.id])}),
        field('Spend resource',proc.cost?.resourceId??'',value=>{
          if(value)proc.cost={resourceId:value,amount:0,unit:'points'};else delete proc.cost;render();
        },{choices:[['','Free'],...resources.map(resource=>[resource.id,resource.name])]}),
        ...proc.cost?[field('Cost amount',proc.cost.amount,change(proc.cost,'amount'),number),
          field('Cost unit',proc.cost.unit,change(proc.cost,'unit'),{choices:['points','percent','count']})]:[]
      ),conditionFields(proc),button('Remove trigger',()=>{profile.procs=profile.procs.filter(entry=>entry!==proc);render();})));
    }
    procs.append(button('Add trigger',attempt(()=>{
      if(!spells.length)throw Error('Create an ability with a combat effect first.');
      profile.procs.push({id:id(),name:'New trigger',owner:newOwner(),event:'damage',chance:.2,cooldown:2,
        spell:spells[0].id,effect:spells[0].combatEffects[0].id});render();
    })));
    if(page==='Abilities')root.append(section('Spell Workshop',button('Open ability library',open(library))));
    if(page==='Buffs and Debuffs')root.append(section('Status definitions',table(['Ability','Effect','Target','Duration','Stacks'],
      abilities.flatMap(ability=>(ability.combatEffects??[]).filter(effect=>effect.duration).map(effect=>[
        ability.name,effect.name??label(effect.type),effect.target??(effect.type==='damage'?'Dummy':'Player'),effect.duration,effect.stacks??1
      ]))),button('Edit effects in the Spell Workshop',open(library))));
    if(page==='Talents')root.append(section('Selected talent ranks',table(['Talent','Rank','Combat status'],talents.map(talent=>[
      talent.name,(draft.build[talent.id]??0)+' / '+talent.maxRank,talentReadiness(draft,talent).message
    ]))));
    root.append(bonuses,procs);
    return root;
  }

  function rendersAnalytics(){
    const builds=section('Saved builds',element('p','Each saved build keeps independent abilities, rules, equipment and talent tree. Loading restores that snapshot.'));
    let name='';
    builds.append(grid(field('Build name','',value=>name=value),
      button('Save current build',attempt(()=>{
        if(!name.trim())throw Error('Enter a build name');
        if(profile.builds.length>=24)throw Error('Remove a build before saving another');
        profile.builds.push(saveBuildSnapshot(draft,name.trim()));render();
      }))));
    for(const snapshot of profile.builds)builds.append(grid(element('strong',snapshot.name),
      button('Load build',attempt(()=>{
        const restored=restoreBuildSnapshot(draft,snapshot);
        if(!validBuild(restored,restored.build))throw Error('This build no longer satisfies its saved talent tree.');
        const savedAbilities=restored.abilities,savedProfile=restored.rpg;
        for(const property of Object.keys(draft))delete draft[property];
        Object.assign(draft,restored);
        abilities.splice(0,abilities.length,...savedAbilities);
        for(const property of Object.keys(profile))delete profile[property];
        Object.assign(profile,savedProfile);
        draft.rpg=profile;draft.abilities=abilities;
        resources.splice(0,resources.length,...classResources(draft.character).filter(resource=>resource.id!=='health'));
        talents.splice(0,talents.length,...draft.branches.flatMap(branch=>branch.talents));
        passive.splice(0,passive.length,...abilities.filter(ability=>ability.kind==='passive'));
        render();
      })),button('Remove saved build',()=>{profile.builds=profile.builds.filter(item=>item!==snapshot);render();})));
    return section('Build testing',builds,section('Saved measurements',comparisonPanel(key)));
  }

  function render(){
    compare=element('div');
    const panel=page==='Character'?rendersCharacter():page==='Equipment'?rendersEquipment():page==='Statistics'?rendersStats()
      :page==='Combat Analytics'?rendersAnalytics():rendersRules();
    body.replaceChildren(tabs(page,value=>{page=value;render();},pages,title=>tabLabels[title]),panel);
    updatePreview();
  }
  render();
  return {root,save:persist};
}
