import test from 'node:test';
import assert from 'node:assert/strict';
import {publicationRow} from '../static/publication-view.js';
const publication={token:'safe',name:'A tree',version:1,published:1,visibility:'public',branches:[{name:'One',icon:'icon'}],author:'Author',views:1,allocated:0,saved:0,likes:2,dislikes:12345,projectId:'project'};
const options={mine:false,index:0,page:0,sort:'likes',image:()=>'<img alt="">',avatarMarkup:()=>'<span></span>'};
test('public presentation never includes author-only dislikes or actions',()=>{
 const html=publicationRow(publication,options);
 assert.ok(!html.includes('12345'));
 assert.ok(!html.includes('data-edit-project'));
 assert.ok(!html.includes('data-visibility='));
 const owned=publicationRow(publication,{...options,mine:true});
 assert.ok(owned.includes('12345'));
 assert.ok(owned.includes('data-edit-project="project"'));
});
test('user-controlled publication metadata is escaped in text and attributes',()=>{
 const html=publicationRow({...publication,token:'"><script>evil()</script>',name:'<img src=x onerror=evil()>',author:'<script>author()</script>',branches:[{name:'" onclick="evil()',icon:'icon'}]},options);
 assert.ok(!html.includes('<script>'));
 assert.ok(!html.includes('<img src=x'));
 assert.ok(html.includes('&lt;img src=x onerror=evil()&gt;'));
 assert.ok(html.includes('&quot; onclick=&quot;evil()'));
});

test('archived publication shows a deadline and restore action without visibility changes',()=>{
 const html=publicationRow({...publication,archived:true,expiresAt:Date.now()/1000+86400},{...options,mine:true});
 assert.ok(html.includes('data-restore-publication="safe"'));assert.ok(html.includes('Удалится'));
 assert.ok(!html.includes('data-visibility='));assert.ok(!html.includes('data-archive-publication='));
});
