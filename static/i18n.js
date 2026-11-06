// Interface localization only. Authored names/descriptions and form values are excluded.
let language='en';try{language=localStorage.getItem('talentforge-language')==='ru'?'ru':'en';}catch{}
const dictionary=new Map(),cache=new Map();let patterns=[];
export function addTranslations(pairs){for(const [ru,en] of pairs)dictionary.set(ru,en);cache.clear();patterns=[...dictionary].sort((a,b)=>b[0].length-a[0].length).map(([ru,en])=>[new RegExp('(?<![\\p{L}\\p{N}])'+ru.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![\\p{L}\\p{N}])','giu'),en]);}
export const getLanguage=()=>language;
export function t(value){const source=String(value);if(language==='ru'||!/[А-Яа-яЁё]/.test(source))return source;if(cache.has(source))return cache.get(source);const trim=source.trim();let result=dictionary.has(trim)?source.replace(trim,dictionary.get(trim)):source; if(result===source)for(const [pattern,en] of patterns)result=result.replace(pattern,match=>match===match.toUpperCase()?en.toUpperCase():en);cache.set(source,result);return result;}
const textState=new WeakMap(),attributeState=new WeakMap();
const excluded='[data-user-content],#treeTitle,#className,#rankPreview,#previewTalentName,.publication-title,.publication-author,.library-title,.library-copy strong,.tooltip-description,.readonly-talent-heading strong,.ability-card strong,.ability-card p:not(.interface-text),.rank-description,.effect,input,textarea,script,style';
function translate(root){
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
 while((node=walker.nextNode())){if(node.parentElement?.closest(excluded))continue;let state=textState.get(node);if(!state||node.nodeValue!==state.output)state={source:node.nodeValue};state.output=t(state.source);textState.set(node,state);if(node.nodeValue!==state.output)node.nodeValue=state.output;}
 for(const element of [root,...root.querySelectorAll('*')]){if(element.closest?.('[data-user-content]')||element.matches?.('[data-talent],#treeTitle,.publication-title,.library-title'))continue;for(const attr of ['title','aria-label','placeholder']){if(!element.hasAttribute?.(attr))continue;let states=attributeState.get(element)||{};let state=states[attr];const current=element.getAttribute(attr);if(!state||current!==state.output)state={source:current};state.output=t(state.source);states[attr]=state;attributeState.set(element,states);if(current!==state.output)element.setAttribute(attr,state.output);}
 if(element.tagName==='OPTION'&&!element.hasAttribute('value')){const source=textState.get(element.firstChild)?.source;if(source)element.value=source;}}
}
let observer,titleSource;
export function localize(){if(!document.body)return;observer?.disconnect();translate(document.body);titleSource??=document.title;document.title=t(titleSource);document.documentElement.lang=language;observer?.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','placeholder']});}
export function setLanguage(value){language=value==='ru'?'ru':'en';try{localStorage.setItem('talentforge-language',language);}catch{}localize();}
export function initLanguage(){observer=new MutationObserver(()=>localize());localize();observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','placeholder']});}
