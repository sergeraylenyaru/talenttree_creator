// A saved build is a detached document. Its IDs remain local to that document.
// Snapshots never contain other snapshots, so storage and validation stay bounded.
export function saveBuildSnapshot(document,name,id=crypto.randomUUID()) {
  const snapshot=structuredClone(document);
  snapshot.rpg??={version:1};
  snapshot.rpg.builds=[];
  return {id,name,talents:structuredClone(document.build??{}),
    equipped:structuredClone(document.rpg?.equipped??{}),primaryBranchId:document.primaryBranchId??'',
    combatSnapshot:snapshot};
}

export function restoreBuildSnapshot(document,saved) {
  const next=structuredClone(saved.combatSnapshot??document);
  next.build=structuredClone(saved.talents);
  next.rpg??={version:1};
  next.rpg.equipped=structuredClone(saved.equipped);
  next.rpg.builds=structuredClone(document.rpg?.builds??[]);
  if(saved.primaryBranchId!==undefined)next.primaryBranchId=saved.primaryBranchId;
  return next;
}

// Called once when opening an old document. Old IDs and values are preserved.
export function detachLegacyBuilds(document) {
  for(const saved of document.rpg?.builds??[]) {
    if(saved.combatSnapshot)continue;
    const snapshot=structuredClone(document);
    snapshot.rpg.builds=[];
    snapshot.build=structuredClone(saved.talents);
    snapshot.rpg.equipped=structuredClone(saved.equipped);
    if(saved.primaryBranchId!==undefined)snapshot.primaryBranchId=saved.primaryBranchId;
    saved.combatSnapshot=snapshot;
  }
  return document;
}
