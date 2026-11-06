"""Avatar composer, branch tints and navigation; temporary database only."""
import json
import sys
import tempfile
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server

with tempfile.TemporaryDirectory() as tmp:
    server.DB=str(Path(tmp)/'custom.sqlite');server.initialize()
    http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler)
    threading.Thread(target=http.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{http.server_port}'
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            ctx=browser.new_context(viewport={'width':1440,'height':1100})
            ctx.route('https://**/*',lambda r:r.abort())
            ctx.request.post(base+'/api/register',data={'login':'custom_author', 'email': 'custom_author@example.test','password':'test-password-123'});ctx.request.post(base+'/api/profile/settings',data={'language':'ru'})
            images=[i for i in server.builtin_images() if i.startswith('data:')][:2]
            ctx.request.post(base+'/api/profile/avatar',data={'avatar':images[0]})
            d={'version':1,'name':'Звёздный страж','budget':41,'rowCost':5,'build':{},'abilities':[{'id':'a','name':'Щит','description':'Поглощает урон.','icon':images[1],'branchId':'b0'}],
               'branches':[{'id':'b'+str(i),'name':['Свет','Тень','Сталь','Пламя'][i],'rows':5,'talents':[]} for i in range(4)],
               'classIcon':{'glow':{'color':'#ffffff','radius':100,'strength':100},'layers':[{'icon':images[1],'opacity':1}]}}
            pid=ctx.request.post(base+'/api/projects',data={'document':d}).json()['id']
            page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda dialog:dialog.accept())
            page.goto(base);page.wait_for_function("document.querySelector('#user').textContent==='custom_author'")
            page.locator('#projects').click();page.wait_for_selector('[data-open]')
            assert page.locator('#new').inner_text()=='Создать'
            assert page.locator('#new').evaluate("el=>el.nextElementSibling.id==='returnEditor'")
            assert page.locator('#closeLibrary').count()==0
            page.locator('#returnEditor').click();assert page.locator('#treeHero').is_visible()
            page.locator('#projects').click();page.locator('[data-open]').first.click()
            page.wait_for_function("document.querySelector('#className').value==='Звёздный страж'")
            assert page.locator('.emblem-glow').count()==0
            page.locator('#classIcon').click();assert page.locator('#emblemGlowColor').count()==0;page.locator('#closeModal').click()
            page.locator('#profileAvatar').click();assert page.locator('#modalTitle').inner_text()=='Аватар профиля'
            page.locator('#emblemOpacity').fill('70');page.locator('#emblemScale').fill('150');page.locator('#emblemX').fill('12')
            page.locator('#toggleEmblemLayer').click();page.locator('#emblemOpacity').fill('40');page.locator('#emblemRotation').fill('45')
            page.locator('[data-emblem-layer="1"]').click();page.wait_for_selector('#iconCategory');page.locator('#iconCategory').select_option('weapons');page.locator('[data-icon="inv_axe_01"]').click();page.locator('#submitModal').click()
            page.wait_for_selector('#emblemRotation');assert page.locator('#emblemRotation').input_value()=='45'
            page.locator('[data-active-emblem="0"]').click();assert page.locator('#emblemX').input_value()=='12'
            page.set_viewport_size({'width':320,'height':900});assert page.locator('#modal').evaluate('el=>el.scrollWidth<=el.clientWidth+1')
            page.locator('#submitModal').click();page.wait_for_function("!document.querySelector('#modal').open")
            avatar=ctx.request.get(base+'/api/me').json()['user']['avatar']
            assert len(avatar['layers'])==2 and avatar['layers'][0]['scale']==1.5 and avatar['layers'][1]['rotation']==45
            assert page.locator('#profileAvatar img').count()==2
            page.set_viewport_size({'width':1440,'height':1100})
            page.locator('[data-action="branch-color"]').first.click();page.locator('#branchColor').fill('#437b96')
            assert '67, 123, 150' in page.locator('#branchColorPreview').evaluate('el=>getComputedStyle(el).backgroundImage')
            page.locator('#submitModal').click();page.locator('#save').click();page.wait_for_function("document.querySelector('#saveState').textContent==='Сохранено в аккаунте'")
            saved=ctx.request.get(base+'/api/projects/'+pid).json()['document']
            assert saved['branches'][0]['color']=='#437b96' and saved['classIcon']==d['classIcon']
            assert '67, 123, 150' in page.locator('[data-ability-band="b0"]').evaluate('el=>getComputedStyle(el).backgroundImage')
            for width in [1440,1024,768,390,320]:
                page.set_viewport_size({'width':width,'height':1000})
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
                assert page.locator('#trees').evaluate('el=>el.scrollWidth<=el.clientWidth+1'),width
            page.set_viewport_size({'width':1440,'height':1100})
            token=ctx.request.post(base+'/api/publish',data={'projectId':pid,'visibility':'public'}).json()['token']
            page.locator('#rankings').click();page.wait_for_selector('.publication-author')
            assert page.locator('.publication-author .user-avatar img').count()==2
            assert page.locator('.publication-author .class-emblem').evaluate('el=>el.clientWidth===el.parentElement.clientWidth')
            assert page.locator('#closeCommunity').count()==0
            for width in [1440,1024,768,390,320]:
                page.set_viewport_size({'width':width,'height':1000});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
            guest=browser.new_context();g=guest.new_page();g.goto(base+'/?share='+token);g.wait_for_function("document.querySelector('#treeTitle').textContent==='Звёздный страж'")
            assert '67, 123, 150' in g.locator('.tree').first.evaluate('el=>getComputedStyle(el).backgroundImage')
            page.reload();page.wait_for_function("document.querySelector('#profileAvatar img')!==null")
            assert page.locator('#profileAvatar img').count()==2
            assert not errors,errors
            print('PASS: shared avatar composer, independent layers and reload; no glow; return beside Create; branch tints in editor, abilities and public calculator; mobile layout.')
            browser.close()
    finally:
        http.shutdown();http.server_close()
