"""Build the named retail icon index from the pinned wowdev interface.csv.

Place the file in work/sources/retail-interface.csv; source hash is verified.
Run from the repository root. Images remain on the configured CDN.
"""
import re,json,hashlib
from pathlib import Path
p=Path('work/sources/retail-interface.csv');raw=p.read_bytes();blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest();assert blob=='c3c322ee9915eb86784bb70b2253b82ab29a93cb'
icons={};aliases={}
for line in raw.decode().splitlines():
 fid,path=line.split(';',1);match=re.fullmatch(r'interface[/\\]icons[/\\]([^/\\]+)\.blp',path,re.I)
 if not match:continue
 name=match[1].lower();ident=name if re.fullmatch(r'[a-z0-9_]{1,100}',name) else 'retail:'+fid
 if ident.startswith('retail:'):aliases[ident]=name
 kind='weapon' if re.match(r'inv[_-](?:sword|axe|mace|hammer|staff|wand|weapon|bow|crossbow|musket|spear|throwing|knife|shield|polearm)',name) else 'armor' if re.match(r'inv[_-](?:chest|helmet|shoulder|pants|belt|boots|bracer)',name) else None
 entry={'id':ident,'label':re.sub(r'[_-]+',' ',name),'fileDataId':int(fid)}
 if kind:entry['categoryKind']=kind
 icons[ident]=entry
out=Path('static');(out/'retail-icons.json').write_text(json.dumps(list(icons.values()),ensure_ascii=False,separators=(',',':'))+'\n');(out/'retail-icon-aliases.js').write_text('export const retailIconNames='+json.dumps(aliases,ensure_ascii=False,separators=(',',':'))+';\n')
(out/'retail-icons-source.json').write_text(json.dumps({'url':'https://github.com/wowdev/wow-listfile/blob/master/parts/interface.csv','gitBlob':blob,'snapshotDate':'2026-11-08','entries':len(icons),'aliases':len(aliases),'images':'Wowhead CDN; filenames only are bundled'},indent=2)+'\n')
print({'icons':len(icons),'aliases':len(aliases),'bytes':(out/'retail-icons.json').stat().st_size})
