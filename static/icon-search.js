function normalized(value){return String(value??'').normalize('NFKC').toLocaleLowerCase().replace(/ё/g,'е');}
export function matchesIconSearch(icon,query){
 const tags=Array.isArray(icon.tags)?icon.tags.join(' '):icon.tags||'';
 const text=normalized([icon.id,icon.label,icon.name,tags].filter(Boolean).join(' '));
 return normalized(query).trim().split(/[\s,;]+/u).map(term=>term.replace(/^#+/u,'')).filter(Boolean).every(term=>text.includes(term));
}
