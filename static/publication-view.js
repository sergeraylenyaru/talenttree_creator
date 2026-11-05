import {classEmblem} from './class-emblem.js';
import {glyph} from './ui.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function publicationRow(p,{mine,index,page,sort,image,avatarMarkup}){
 const metric=sort==='likes'?p.likes:sort==='usage'?p.allocated:sort==='views'?p.views:0;
 const leading=!mine&&page===0&&index===0&&metric>0;
 const badge=p.visibility==='public'?`${glyph('globe')}Общедоступное`:p.visibility==='private'?`${glyph('lock')}Только мне`:`${glyph('link')}По ссылке`;
 return `<article class="publication-card publication-row ${leading?'is-leading':''}" data-publication-row="${esc(p.token)}">
 <div class="publication-row-main">${classEmblem(p.classIcon,p.branches[0]?.icon)}
 <button class="publication-title" data-open-publication="${esc(p.token)}" title="Открыть ${esc(p.name)}">${esc(p.name)}</button><span class="publication-version" title="Опубликовано ${esc(new Date(p.published*1000).toLocaleString('ru-RU'))}">v${p.version}</span>
 ${leading?`<span class="leader-badge" title="Первое место в выбранном рейтинге">${glyph('trophy')}<span>Лидер</span></span>`:''}
 <div class="publication-branches">${p.branches.map(b=>`<span class="publication-branch" title="${esc(b.name)}">${image(b.icon)}<span>${esc(b.name)}</span></span>`).join('')}</div>
 ${mine?`<span class="visibility-badge ${p.visibility}">${badge}</span>`:''}</div>
 <div class="publication-row-bottom"><p class="publication-metrics"><span title="Уникальные просмотры">${glyph('eye')}<span class="metric-label">Просмотры:</span> ${p.views}</span><span title="Пользователи калькулятора">${glyph('calculator')}<span class="metric-label">Калькулятор:</span> ${p.allocated}</span><span title="Сохранили себе">${glyph('save')}<span class="metric-label">Сохранили:</span> ${p.saved}</span><span title="Лайки">👍 ${p.likes}</span>${mine?`<span title="Дизлайки — видны только автору">👎 ${p.dislikes??0}<span class="private-vote-note"> · только тебе</span></span>`:''}</p><div class="publication-author"><span title="${esc(p.author||'Автор не указан')}">${esc(p.author||'Автор не указан')}</span>${avatarMarkup(p.avatar,p.author)}</div></div>
 ${mine?`<div class="publication-owner-actions"><label>Видимость <select aria-label="Видимость ${esc(p.name)}" data-visibility="${esc(p.token)}"><option value="private" ${p.visibility==='private'?'selected':''}>Только мне</option><option value="unlisted" ${p.visibility==='unlisted'?'selected':''}>Только по ссылке</option><option value="public" ${p.visibility==='public'?'selected':''}>Общедоступное</option></select></label><button data-copy-link="${esc(p.token)}" ${p.visibility==='private'?'title="Эта ссылка открывается только в аккаунте автора"':''}>${glyph('link')}Скопировать ссылку</button>${p.projectId?`<button data-edit-project="${esc(p.projectId)}">${glyph('edit')}Открыть рабочее дерево</button>`:'<span class="muted">Рабочее дерево удалено</span>'}<button data-open-publication="${esc(p.token)}">${glyph('eye')}Просмотреть</button></div>`:''}
 </article>`;
}
