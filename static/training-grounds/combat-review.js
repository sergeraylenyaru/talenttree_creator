import {button,element,table,section,grid,tabs,download,format,label} from '../rpg-ui.js';
import {reportCsv,compareReports} from '../combat/session-report.js';
import {iconURL} from '../icons.js';

export function statRows(sheet){
  return [
    ...Object.entries(sheet.primary).map(([key,value])=>[label(key),value]),
    ['Attack power',sheet.source.attackPower],['Spell power',sheet.source.spellPower],['Healing power',sheet.healingPower],
    ['Critical chance',format(sheet.source.critChance*100)+'%'],['Critical damage',format(sheet.source.critMultiplier*100)+'%'],
    ['Haste',format(sheet.haste*100)+'%'],['Mastery',format(sheet.mastery*100)+'%'],['Versatility',format(sheet.versatility*100)+'%'],
    ['Maximum health',sheet.maxHealth],['Health regeneration per second',sheet.healthRegen],
    ['Movement speed',format(sheet.movementSpeed*100)+'%'],['Armor and physical resistance',sheet.armor],
    ...Object.entries(sheet.resistance).map(([school,value])=>[label(school)+' resistance',value]),
    ...Object.entries(sheet.mitigation).map(([school,value])=>[label(school)+' mitigation',format(value*100)+'%']),
    ['Melee bonus',sheet.meleePower],['Ranged bonus',sheet.rangedPower],['Spell damage bonus',sheet.spellDamage],
    ['Cast speed',format(sheet.castSpeed*100)+'%'],['Channel speed',format(sheet.channelSpeed*100)+'%'],
    ['Cooldown speed',format(sheet.cooldownSpeed*100)+'%'],['Global cooldown speed',format(sheet.gcdSpeed*100)+'%'],
    ['Attack speed',format(sheet.swingSpeed*100)+'%'],
    ['Equipped weapon swing interval',sheet.weapon ? format(sheet.weapon.speed/sheet.swingSpeed)+' s' : 'Arena default'],
    ...sheet.resources.map(resource=>[resource.name+' maximum',resource.max])
  ];
}
function metrics(report){
  const m=report.metrics;
  return table(['Metric','Result'],[
    ['Elapsed',format(report.duration)+' s'],['Total damage',m.damage],['DPS',m.dps],['Highest hit',m.highest],['Average hit',m.average],
    ['Hits',m.hits],['Misses',m.misses],['Critical hits',m.crits],
    ['Observed critical rate',m.criticalChance===null?'—':format(m.criticalChance*100)+'%'],
    ['Autoattack damage',m.auto],['Direct damage',m.direct],['Periodic damage',m.periodic],['Critical damage',m.critical],
    ['Total healing',m.healing],['Effective healing',m.effective],['Overhealing',m.overhealing],['HPS',m.hps],
    ['Resource spent',m.spent],['Resource generated',m.gained],['Damage per resource spent',m.efficiency],
    ['Incoming damage',m.incoming],['Absorbed by shields',m.absorbed]
  ]);
}
export function readMeasurements(key){
  try {
    const data=JSON.parse(localStorage.getItem('talentforge-combat-measurements-v1:'+key));
    return Array.isArray(data)?data.filter(item=>item?.report?.version===1&&Array.isArray(item.report.abilities)&&item.report.metrics):[];
  }catch{return [];}
}
export function comparisonPanel(key){
  const root=element('div');
  const data=readMeasurements(key);
  let left=0,right=Math.max(0,data.length-1);
  const body=element('div');
  const choices=data.map((item,index)=>[index,item.name]);
  function render(){
    const a=data[left]?.report,b=data[right]?.report;
    if(!a||!b){body.textContent='Save combat measurements from the arena to compare them here.';return;}
    const comparison=compareReports(a,b);
    const keys=['dps','damage','hps','efficiency','crits','criticalChance','spent','gained','absorbed'];
    const abilityIds=new Set([...a.abilities,...b.abilities].map(row=>row.id));
    const effectNames=new Set([...a.effects,...b.effects].map(row=>row.name));
    body.replaceChildren(element('p',comparison.comparable
      ?'Same duration, seed and dummy settings across both measurements.'
      :'Different duration, seed or dummy settings. Compare with care.','rpg-notice'),
      table(['Metric',data[left].name,data[right].name],keys.map(key=>[label(key),a.metrics[key],b.metrics[key]])),
      section('Ability damage', table(['Ability','Left','Right'],[...abilityIds].map(id=>{
        const x=a.abilities.find(row=>row.id===id),y=b.abilities.find(row=>row.id===id);
        return [x?.name??y?.name,x?.damage??0,y?.damage??0];
      }))),
      section('Buff uptime',table(['Effect','Left %','Right %'],[...effectNames].map(name=>[
        name,a.effects.find(row=>row.name===name)?.uptimePercent??0,b.effects.find(row=>row.name===name)?.uptimePercent??0
      ]))),
      section('Stat differences',table(['Stat','Left','Right'],comparison.stats.map(row=>[label(row.key),row.left,row.right]))),
      section('Equipment differences',table(['Slot','Left','Right'],comparison.gear.map(row=>[label(row.slot),row.left,row.right]))));
  }
  if(data.length)root.append(grid(
    fieldSelect('Left measurement',choices,left,value=>{left=Number(value);render();}),
    fieldSelect('Right measurement',choices,right,value=>{right=Number(value);render();})
  ));
  root.append(body);render();
  return root;
}
function fieldSelect(name,choices,value,callback){
  const label=element('label',name);
  const select=element('select');
  for(const [id,text] of choices)select.append(new Option(text,id));
  select.value=value;select.onchange=()=>callback(select.value);label.append(select);return label;
}

export function openCombatReview({runtime,portrait,weaponBone,key,incoming,onIncoming,pause,reset}){
  const dialog=element('dialog',undefined,'rpg-review');
  const title=element('h2','Combat analysis');
  const toolbar=element('div',undefined,'rpg-review-toolbar');
  const body=element('div',undefined,'rpg-review-body');
  const message=element('p','');
  message.setAttribute('role','status');
  let page='Summary', report=runtime().report();
  const pages=['Summary','Abilities','Effects','Timeline','Character','Compare'];
  function refresh(){
    report=runtime().report();
    render();
  }
  function render(){
    body.replaceChildren(tabs(page,value=>{page=value;render();},pages));
    switch(page){
      case 'Summary':
        body.append(grid(section('Session metrics',metrics(report)),
          section('Damage by school',table(['School','Damage'],Object.entries(report.schools).map(([school,value])=>[label(school),value])))));
        break;
      case 'Abilities':
        body.append(table(['Ability','Damage','Share %','DPS','Casts','Hits','Misses','Crits','Average','Highest','Spent','Cooldowns',
          'Healing','Effective','Overhealing','Avg heal','Heal crits'],report.abilities.map(row=>[row.name,row.damage,row.percentage,row.dps,
          row.casts,row.hits,row.misses,row.crits,row.average,row.highest,row.spent,row.cooldowns,
          row.healing,row.effective,row.overhealing,row.averageHealing,row.healingCrits])));
        break;
      case 'Effects':
        body.append(section('Buffs, debuffs and periodic effects',table(['Effect','Uptime %','Average active time','Applications','Peak stacks','Damage','Healing'],
          report.effects.map(row=>[row.name,row.uptimePercent,row.averageDuration,row.applications,row.stacks,row.damage,row.healing]))),
          section('Procs',table(['Proc','Triggers','Triggers / second'],report.procs.map(row=>[row.name,row.count,row.frequency]))));
        break;
      case 'Timeline': {
        const details=element('pre','Select an event to inspect.');
        const rows=report.timeline.slice(-400).map(event=>[event.time,label(event.type),event.abilityName,event.amount,
          button('Inspect',()=>{details.textContent=JSON.stringify(event,null,2);})]);
        const count=report.droppedTimelineEvents+Math.max(0,report.timeline.length-400);
        body.append(element('p',count?count+' earlier events omitted from this view.':'All session events.', 'rpg-notice'),
          details,table(['Time','Event','Ability','Amount','Details'],rows));
        break;
      }
      case 'Character': {
        const art=portrait?.();
        const sheet=runtime().sheet();
        const equipment=report.build.equipment;
        const gear=section('Equipped items',table(['Slot','Item','Type','Level'],Object.entries(equipment).map(([slot,item])=>{
          const name=element('span',item.name);
          const url=iconURL(item.icon);
          if(url){const img=element('img');img.src=url;img.alt='';img.className='rpg-item-icon';img.onerror=()=>img.remove();name.prepend(img);}
          return [label(slot),name,label(item.type),item.level];
        })));
        if(art){const img=element('img');img.src=art;img.alt='Hero';img.className='rpg-hero-portrait';gear.prepend(img);}
        if(equipment.mainHand&&equipment.mainHand.speed&&!weaponBone?.()){
          gear.append(element('p','The weapon visual has no attachment. The equipped weapon still controls damage and swing timing.','rpg-notice'));
        }
        if(equipment.offHand||equipment.ranged||equipment.mainHand&&equipment.mainHand.type!=='sword1'){
          gear.append(element('p','The arena uses the loaded local sword model. Other slots and weapon types use their equipped gameplay values.','rpg-notice'));
        }
        body.append(grid(section('Live derived statistics',table(['Statistic','Value'],statRows(sheet))),gear));
        if(incoming)body.append(button('Test dummy strike',()=>{onIncoming?.();refresh();}));
        break;
      }
      case 'Compare':body.append(comparisonPanel(key));break;
    }
  }
  const pauseLabel=()=>runtime().paused?'Resume session':'Stop session';
  const pauseButton=button(pauseLabel(),()=>{pause();pauseButton.textContent=pauseLabel();refresh();});
  toolbar.append(button('Refresh',()=>{pauseButton.textContent=pauseLabel();refresh();}),
    button('New session',()=>{reset();pauseButton.textContent=pauseLabel();refresh();}),pauseButton,
    button('Export JSON',()=>{report=runtime().report();download('talentforge-combat.json',JSON.stringify(report,null,2));}),
    button('Export CSV',()=>{report=runtime().report();download('talentforge-combat.csv',reportCsv(report),'text/csv');}),
    button('Save measurement',()=>{
      report=runtime().report();
      const saved=readMeasurements(key);
      const name=dialog.querySelector('input').value.trim()||'Test '+(saved.length+1);
      try{
        localStorage.setItem('talentforge-combat-measurements-v1:'+key,JSON.stringify(
          [...saved,{name,report:{...report,timeline:[]}}].slice(-12)));
        message.textContent='Measurement saved.';
        if(page==='Compare')render();
      }catch{message.textContent='Could not save the measurement in this browser.';}
    }),
    button('Close',()=>dialog.close()));
  const input=element('input');input.placeholder='Measurement name';input.maxLength=60;input.setAttribute('aria-label','Measurement name');toolbar.prepend(input);
  dialog.append(title,toolbar,message,body);
  document.body.append(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  render();dialog.showModal();
}
