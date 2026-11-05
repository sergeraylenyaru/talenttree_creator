// Presentation only: application documents and API calls remain in app.js.
const paths={
 spark:'m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z',
 trophy:'M8 3h8v5a4 4 0 0 1-8 0ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 1v7m-4 2h8m-6-2h4',
 eye:'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
 calculator:'M6 3h12v18H6Zm3 4h6m-6 5h1m4 0h1m-6 4h1m4 0h1',
 clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
 layers:'m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5',
 star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
 bell:'M6 9a6 6 0 0 1 12 0v6l2 3H4l2-3Zm4 12h4',
 user:'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a8 8 0 0 1 16 0v2',
 menu:'M4 6h16M4 12h16M4 18h16',
 close:'m6 6 12 12M6 18 18 6',
 chevron:'m8 10 4 4 4-4',
 arrow:'M19 12H5m6-6-6 6 6 6',
 search:'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM16 16l5 5',
 plus:'M12 5v14M5 12h14',
 minus:'M5 12h14',
 upload:'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
 download:'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
 save:'M4 3h13l4 4v14H3V3Zm3 0v6h9V3M7 21v-8h10v8',
 edit:'m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z',
 undo:'M9 4 3 10l6 6M3 10h11a6 6 0 0 1 0 12',
 redo:'m15 4 6 6-6 6m6-6H10a6 6 0 0 0 0 12',
 share:'m3 11 18-8-8 18-3-8Zm7 2L21 3',
 link:'m10 13 4-4m-6 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
 lock:'M6 10h12v11H6Zm3 0V6a3 3 0 0 1 6 0v4',
 globe:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3a20 20 0 0 1 0 18 20 20 0 0 1 0-18',
 check:'m5 12 4 4L19 6',
 trash:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
 copy:'M8 8h13v13H8ZM16 8V3H3v13h5',
 logout:'M9 3H3v18h6m6-15 6 6-6 6M8 12h13',
 info:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 8v6m0-10h.01',
 zoom:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6M7 10h6m-3-3v6'
};
export function glyph(name){return `<svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.spark}"/></svg>`;}
export function decorate(root=document){for(const el of root.querySelectorAll('[data-glyph]')){el.innerHTML=glyph(el.dataset.glyph);}}

let noticeKey='tf-notices:guest',notices=[],seen=0;
const $=id=>document.getElementById(id);
export function notificationUser(login){noticeKey='tf-notices:'+(login||'guest');try{const data=JSON.parse(sessionStorage.getItem(noticeKey));notices=Array.isArray(data?.items)?data.items:[];seen=data?.seen||0;}catch{notices=[];seen=0;}renderNotices();}
function saveNotices(){try{sessionStorage.setItem(noticeKey,JSON.stringify({items:notices,seen}));}catch{}}
export function notify(message){notices.unshift({message:String(message),time:Date.now()});notices=notices.slice(0,50);saveNotices();renderNotices();}
function renderNotices(){
 const list=$('noticeList');if(!list)return;list.replaceChildren();
 if(!notices.length){const p=document.createElement('p');p.className='dropdown-empty';p.textContent='Здесь появятся результаты твоих действий: сохранения, публикации и другие сообщения.';list.append(p);}
 for(const notice of notices){const item=document.createElement('li'),text=document.createElement('span'),time=document.createElement('time');text.textContent=notice.message;time.dateTime=new Date(notice.time).toISOString();time.textContent=new Date(notice.time).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});item.append(text,time);list.append(item);}
 $('noticeDot').hidden=!notices.some(n=>n.time>seen);$('clearNotices').disabled=!notices.length;
}
export function closeMenus(){for(const id of ['accountDropdown','noticeDropdown'])$(id).hidden=true;for(const id of ['accountMenu','notifications'])$(id).setAttribute('aria-expanded','false');$('siteNav').classList.remove('is-open');$('mobileMenu').setAttribute('aria-expanded','false');}
export function initUI(){
 decorate();notificationUser(null);
 function dropdown(trigger,panel){$(trigger).onclick=()=>{const opening=$(panel).hidden;closeMenus();$(panel).hidden=!opening;$(trigger).setAttribute('aria-expanded',String(opening));if(opening&&panel==='noticeDropdown'){seen=Date.now();saveNotices();renderNotices();}};}
 dropdown('accountMenu','accountDropdown');dropdown('notifications','noticeDropdown');
 $('mobileMenu').onclick=()=>{const open=$('mobileMenu').getAttribute('aria-expanded')!=='true';closeMenus();$('siteNav').classList.toggle('is-open',open);$('mobileMenu').setAttribute('aria-expanded',String(open));};
 $('clearNotices').onclick=()=>{notices=[];seen=Date.now();saveNotices();renderNotices();};
 document.addEventListener('click',e=>{if(!e.target.closest('.header-tools,.mobile-menu,#siteNav'))closeMenus();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenus();});
 $('siteNav').addEventListener('click',e=>{if(e.target.closest('button'))closeMenus();});
}
