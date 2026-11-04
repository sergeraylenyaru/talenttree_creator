export function blank() {
  return {version:1,name:'Новый класс',budget:71,rowCost:5,branches:[branch('Ветка 1'),branch('Ветка 2')],abilities:[],build:{}};
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
export function normalize(doc) {
  if(!doc || doc.version!==1 || typeof doc.name!=='string' || !doc.name.trim() || doc.name.length>100 || !Array.isArray(doc.branches) || doc.branches.length<1 || doc.branches.length>5) throw Error('Неверный формат класса Talent Forge v1');
  for(const key of ['budget','rowCost']) if(!Number.isInteger(doc[key])||doc[key]<0||doc[key]>100000) throw Error('Неверные правила очков');
  const ids=new Set(),branchIds=new Set();
  for(const b of doc.branches) {
    if(typeof b.id!=='string'||!b.id||branchIds.has(b.id)||typeof b.name!=='string'||!Number.isInteger(b.rows)||b.rows<1||b.rows>1000||!Array.isArray(b.talents)) throw Error('Неверный формат ветки');
    branchIds.add(b.id);
    const positions=new Set();
    for(const t of b.talents) {
      const pos=`${t.row}:${t.col}`;
      if(typeof t.id!=='string'||ids.has(t.id)||positions.has(pos)||!Number.isInteger(t.row)||t.row<0||t.row>=b.rows||!Number.isInteger(t.col)||t.col<0||t.col>3||typeof t.name!=='string'||!Number.isInteger(t.maxRank)||t.maxRank<1||t.maxRank>100||!Array.isArray(t.descriptions)||t.descriptions.length!==t.maxRank||t.descriptions.some(d=>typeof d!=='string')) throw Error('Неверный формат таланта');
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
  if(!Array.isArray(doc.abilities)||doc.abilities.some(a=>!a||typeof a.id!=='string'||typeof a.name!=='string'||typeof a.description!=='string')) throw Error('Неверный список способностей');
  doc.build=doc.build&&typeof doc.build==='object'&&!Array.isArray(doc.build)?doc.build:{};
  if(!validBuild(doc,doc.build)) doc.build={};
  return doc;
}
