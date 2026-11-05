import {validateClassIcon} from './class-emblem.js';
import {renderRankTemplate} from './rank-template.js';
export function blank() {
  return {version:1,name:'Новый класс',budget:41,budgetAuto:true,rowCost:5,branches:[branch('Ветка 1'),branch('Ветка 2')],abilities:[],build:{}};
}
export function branch(name) { return {id:crypto.randomUUID(),name,rows:5,talents:[]}; }
export function total(doc, build=doc.build) { return Object.values(build).reduce((sum,n)=>sum+n,0); }
export function validBuild(doc, build) {
  if (total(doc,build)>doc.budget) return false;
  const known=new Set();
  for(const b of doc.branches) {
    const talents=new Map(b.talents.map(t=>[t.id,t]));
    for(const t of b.talents) {
      known.add(t.id);
      const rank=build[t.id]||0;
      if(!Number.isInteger(rank)||rank<0||rank>t.maxRank) return false;
      if(!rank) continue;
      const earlier=b.talents.filter(x=>x.row<t.row).reduce((n,x)=>n+(build[x.id]||0),0);
      if(earlier<t.row*doc.rowCost) return false;
      if(t.requires && (!talents.has(t.requires)||(build[t.requires]||0)!==talents.get(t.requires).maxRank)) return false;
    }
  }
  return Object.entries(build).every(([id,n])=>known.has(id)&&Number.isInteger(n)&&n>=0);
}
export function changeRank(doc, id, delta) {
  const next={...doc.build,[id]:(doc.build[id]||0)+delta};
  if(!validBuild(doc,next)) return false;
  doc.build=next; return true;
}
export function normalize(doc,{allowLegacy=false}={}) {
  if(!doc || doc.version!==1 || typeof doc.name!=='string' || !doc.name.trim() || doc.name.length>100 || !Array.isArray(doc.branches) || doc.branches.length<1 || doc.branches.length>(allowLegacy?5:4)) throw Error('Неверный формат класса Talent Forge v1');
  if(doc.classIcon!==undefined)validateClassIcon(doc.classIcon);
  for(const key of ['budget','rowCost']) if(!Number.isInteger(doc[key])||doc[key]<0||doc[key]>100000) throw Error('Неверные правила очков');
  synchronizeAbilityTalents(doc);
  const ids=new Set(),branchIds=new Set();
  for(const b of doc.branches) {
    if(typeof b.id!=='string'||!b.id||branchIds.has(b.id)||typeof b.name!=='string'||!Number.isInteger(b.rows)||b.rows<1||b.rows>1000||!Array.isArray(b.talents)) throw Error('Неверный формат ветки');
    branchIds.add(b.id);if(b.icon!==undefined&&typeof b.icon!=='string')throw Error('Неверная иконка ветки');
    const positions=new Set();
    for(const t of b.talents) {
      const pos=`${t.row}:${t.col}`;
      if(typeof t.id!=='string'||ids.has(t.id)||positions.has(pos)||!Number.isInteger(t.row)||t.row<0||t.row>=b.rows||!Number.isInteger(t.col)||t.col<0||t.col>3||typeof t.name!=='string'||!Number.isInteger(t.maxRank)||t.maxRank<1||t.maxRank>100||!Array.isArray(t.descriptions)||t.descriptions.length!==t.maxRank||t.descriptions.some(d=>typeof d!=='string')) throw Error('Неверный формат таланта');
      if(t.rankTemplate){const rendered=renderRankTemplate(t.rankTemplate,t.maxRank);if(JSON.stringify(rendered)!==JSON.stringify(t.descriptions))throw Error('Описание рангов не совпадает с общим текстом');}
      ids.add(t.id);positions.add(pos);
    }
    for(const t of b.talents) {
      const seen=new Set([t.id]);let current=t;
      while(current.requires){
        const parent=b.talents.find(p=>p.id===current.requires);
        if(!parent||parent.row>current.row||seen.has(parent.id))throw Error('Зависимость должна вести к таланту в этом или предыдущем ряду, без циклов');
        seen.add(parent.id);current=parent;
      }
    }
  }
  if(!allowLegacy)for(const b of doc.branches)if([...dependencyRoutes(b).values()].some(path=>!path))throw Error('Стрелки зависимостей пересекаются или нет свободного пути. Убери или измени зависимость.');
  if(!Array.isArray(doc.abilities)||doc.abilities.some(a=>!a||typeof a.id!=='string'||typeof a.name!=='string'||typeof a.description!=='string')) throw Error('Неверный список способностей');
  for(const a of doc.abilities){if(a.kind!==undefined&&!['active','passive'].includes(a.kind))throw Error('Неверный тип способности');if(a.branchId!==undefined&&!['','auto'].includes(a.branchId)&&!branchIds.has(a.branchId))throw Error('Ветка способности не найдена');}
  for(const a of doc.abilities)if(a.resourceType!==undefined){if(typeof a.resourceType!=='string'||!a.resourceType||a.resourceType.length>100||['resource','cast','cooldown','range'].some(k=>!Number.isFinite(a[k])||a[k]<0||a[k]>1e9))throw Error('Неверные числовые параметры способности');}
  if(doc.character){
    const c=doc.character;
    if(!Number.isInteger(c.hp)||c.hp<1||c.hp>100000000||typeof c.race!=='string'||typeof c.gender!=='string'||typeof c.armory!=='string'||!Array.isArray(c.resources))throw Error('Неверные настройки персонажа');
    for(const r of c.resources)if(typeof r.name!=='string'||!r.name.trim()||!Number.isInteger(r.max)||r.max<1||r.max>100000000||!Number.isInteger(r.current)||r.current<0||r.current>r.max||!['bar','icons'].includes(r.display)||!['circle','diamond','triangle','crystal','gem','orb','flame','star'].includes(r.shape)||!/^#[0-9a-f]{6}$/i.test(r.color)||(r.display==='icons'&&r.max>100))throw Error('Неверный ресурс');
  }
  doc.build=doc.build&&typeof doc.build==='object'&&!Array.isArray(doc.build)?doc.build:{};
  if(!validBuild(doc,doc.build)) doc.build={};
  return doc;
}

// Plan all dependencies together: no shared cells or segments outside talent icons.
function findRoute(branch,parent,child,usedCells,usedEdges){
 if(!parent||!child||parent.id===child.id)return null;
 const key=(r,c)=>`${r},${c}`,edge=(a,b)=>[a,b].sort().join('|');
 const occupied=new Set(branch.talents.filter(t=>t.id!==parent.id&&t.id!==child.id).map(t=>key(t.row,t.col)));
 const start=key(parent.row,parent.col),target=key(child.row,child.col),queue=[[parent.row,parent.col]],previous=new Map([[start,null]]);
 for(let i=0;i<queue.length;i++){
  const [r,c]=queue[i],current=key(r,c);
  if(current===target){const path=[];for(let at=current;at!==null;at=previous.get(at))path.push(at.split(',').map(Number));return path.reverse();}
  for(const [nr,nc] of [[r+1,c],[r,c+1],[r,c-1],[r-1,c]]){
   const next=key(nr,nc);if(nr<0||nr>=branch.rows||nc<0||nc>=4||occupied.has(next)||previous.has(next)||usedCells.has(next)||usedEdges.has(edge(current,next)))continue;
   previous.set(next,current);queue.push([nr,nc]);
  }
 }
 return null;
}
function planRoutes(branch,order=0){
 const byId=new Map(branch.talents.map(t=>[t.id,t]));
 const children=branch.talents.filter(t=>t.requires).sort((a,b)=>a.row-b.row||a.col-b.col||a.id.localeCompare(b.id));
 if(order===1)children.reverse();if(order===2)children.sort((a,b)=>{const pa=byId.get(a.requires),pb=byId.get(b.requires);return (Math.abs(a.row-pa.row)+Math.abs(a.col-pa.col))-(Math.abs(b.row-pb.row)+Math.abs(b.col-pb.col))||a.id.localeCompare(b.id);});if(order===3)children.sort((a,b)=>{const pa=byId.get(a.requires),pb=byId.get(b.requires);return (Math.abs(b.row-pb.row)+Math.abs(b.col-pb.col))-(Math.abs(a.row-pa.row)+Math.abs(a.col-pa.col))||a.id.localeCompare(b.id);});
 const planned=new Map(),cells=new Set(),edges=new Set();
 for(const child of children){const path=findRoute(branch,byId.get(child.requires),child,cells,edges);planned.set(child.id,path);if(!path)continue;for(const [r,c] of path.slice(1,-1))cells.add(`${r},${c}`);for(let i=1;i<path.length;i++)edges.add([path[i-1].join(','),path[i].join(',')].sort().join('|'));}
 return planned;
}
export function dependencyRoutes(branch){let best=null,missing=Infinity;for(let order=0;order<4;order++){const planned=planRoutes(branch,order),count=[...planned.values()].filter(p=>!p).length;if(count<missing){best=planned;missing=count;}if(!count)break;}return best;}
export function route(branch,parent,child){
 if(!parent||!child)return null;
 const candidate={...child,requires:parent.id},copy={...branch,talents:branch.talents.filter(t=>t.id!==child.id).concat(candidate)};
 const planned=dependencyRoutes(copy);return [...planned.values()].every(Boolean)?planned.get(child.id)||null:null;
}
export function reserved(branch,row,col){return [...dependencyRoutes(branch).values()].some(path=>path?.slice(1,-1).some(([r,c])=>r===row&&c===col));}
export function talentState(doc,talent){const rank=doc.build[talent.id]||0;if(rank===talent.maxRank)return 'maxed';if(rank>0)return 'partial';return validBuild(doc,{...doc.build,[talent.id]:1})?'available':'locked';}

export function moveTalent(document,id,branchId,row,col){
 const next=structuredClone(document),source=next.branches.find(b=>b.talents.some(t=>t.id===id)),dest=next.branches.find(b=>b.id===branchId);
 if(!source||!dest||!Number.isInteger(row)||row<0||row>=dest.rows||!Number.isInteger(col)||col<0||col>3)throw Error('Неверная ячейка');
 const t=source.talents.find(t=>t.id===id),other=dest.talents.find(t=>t.row===row&&t.col===col);
 if(other===t)return next;
 if(!other&&reserved(dest,row,col))throw Error('Здесь проходит стрелка. Сначала убери зависимость.');
 const old={row:t.row,col:t.col};source.talents=source.talents.filter(x=>x!==t);
 if(other){dest.talents=dest.talents.filter(x=>x!==other);Object.assign(other,old);source.talents.push(other);}
 Object.assign(t,{row,col});dest.talents.push(t);
 try{normalize(next);}catch{throw Error('Перемещение нарушает зависимости. Сначала убери зависимость.');}
 for(const b of next.branches)for(const child of b.talents)if(child.requires&&!route(b,b.talents.find(p=>p.id===child.requires),child))throw Error('Нет свободного пути для стрелки. Сначала убери зависимость.');
 return next;
}

export function defaultBudget(doc){return Math.max(0,41+(Math.max(...doc.branches.map(b=>b.rows))-5)*5);}

export function abilityTalentDraft(ability,existing={}){
 const descriptions=[ability.description||''];
 const talent={...existing,id:existing.id||crypto.randomUUID(),name:ability.name,icon:ability.icon,maxRank:1,descriptions,grantedAbilityId:ability.id};delete talent.rankTemplate;return talent;
}
export function placeAbilityTalent(document,abilityId,branchId,row,col,replace=false){
 const next=structuredClone(document),branch=next.branches.find(b=>b.id===branchId),ability=next.abilities.find(a=>a.id===abilityId);
 if(!branch||!ability||!Number.isInteger(row)||row<0||row>=branch.rows||!Number.isInteger(col)||col<0||col>3)throw Error('Неверная ячейка или способность');
 const existing=branch.talents.find(t=>t.row===row&&t.col===col);
 if(existing&&!replace)throw Error('Ячейка занята талантом');if(!existing&&reserved(branch,row,col))throw Error('Здесь проходит стрелка. Сначала убери зависимость.');
 const talent=abilityTalentDraft(ability,{...(existing||{}),row,col,requires:existing?.requires||''});

 if(existing)branch.talents[branch.talents.indexOf(existing)]=talent;else branch.talents.push(talent);
 if(!validBuild(next,next.build))next.build={};return normalize(next);
}

// Display fields are a compatibility cache. The ability is the source of truth.
export function synchronizeAbilityTalents(doc){
 if(!Array.isArray(doc.abilities))throw Error('Неверный список способностей');
 const nodes=doc.branches.flatMap(b=>b.talents||[]),referenced=new Set(nodes.map(t=>t.grantedAbilityId).filter(Boolean)),signatures=new Map(),aliases=new Map();
 for(const a of doc.abilities){if(!referenced.has(a.id))continue;const fields=Object.keys(a).filter(k=>!['id','talentId'].includes(k)).sort();const signature=JSON.stringify(fields.map(k=>[k,a[k]]));if(signatures.has(signature))aliases.set(a.id,signatures.get(signature));else signatures.set(signature,a.id);}
 if(aliases.size){for(const t of nodes)if(aliases.has(t.grantedAbilityId))t.grantedAbilityId=aliases.get(t.grantedAbilityId);doc.abilities=doc.abilities.filter(a=>!aliases.has(a.id));}
 for(const t of nodes)if(t.grantedAbilityId){const a=doc.abilities.find(a=>a.id===t.grantedAbilityId);if(!a)throw Error('Способность таланта не найдена');Object.assign(t,{name:a.name,icon:a.icon,maxRank:1,descriptions:[a.description]});delete t.rankTemplate;}
 return doc;
}
export function abilityUnlocked(doc,ability){const ids=new Set(doc.branches.flatMap(b=>b.talents).filter(t=>t.grantedAbilityId===ability.id).map(t=>t.id));if(ability.talentId)ids.add(ability.talentId);return !ids.size||[...ids].some(id=>(doc.build[id]||0)>0);}
export function removeAbility(document,id){const next=structuredClone(document),removed=new Set();next.abilities=next.abilities.filter(a=>a.id!==id);for(const b of next.branches){for(const t of b.talents)if(t.grantedAbilityId===id)removed.add(t.id);b.talents=b.talents.filter(t=>!removed.has(t.id));}for(const b of next.branches)for(const t of b.talents)if(removed.has(t.requires))t.requires='';for(const a of next.abilities)if(removed.has(a.talentId))a.talentId='';next.build={};return next;}

export function branchIcon(branch){return branch.icon||branch.talents[0]?.icon||'inv_misc_questionmark';}
export function abilityBranchIds(doc,ability){
 if(ability.branchId!==undefined&&ability.branchId!=='auto')return ability.branchId?[ability.branchId]:[];
 return doc.branches.filter(b=>b.talents.some(t=>t.grantedAbilityId===ability.id||t.id===ability.talentId)).map(b=>b.id);
}
export function groupedAbilities(doc){
 const rows=doc.branches.map(b=>({id:b.id,name:b.name,icon:branchIcon(b),abilities:doc.abilities.filter(a=>abilityBranchIds(doc,a).includes(b.id))}));
 const general=doc.abilities.filter(a=>!abilityBranchIds(doc,a).length);if(general.length)rows.push({id:'general',name:'Общие способности',icon:'inv_misc_questionmark',abilities:general});
 return rows.map(row=>({...row,active:row.abilities.filter(a=>a.kind!=='passive'),passive:row.abilities.filter(a=>a.kind==='passive')}));
}
