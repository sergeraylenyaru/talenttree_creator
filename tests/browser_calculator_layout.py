"""Clean calculator, tree favorites and profile preference; temporary SQLite only."""
import sys
import tempfile
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server

with tempfile.TemporaryDirectory() as tmp:
    server.DB=str(Path(tmp)/'layout.sqlite');server.initialize()
    http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler)
    threading.Thread(target=http.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{http.server_port}'
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            owner=browser.new_context(viewport={'width':1440,'height':1100})
            owner.route('https://**/*',lambda route:route.abort())
            owner.request.post(base+'/api/register',data={'login':'layout_author','password':'test-password-123'})
            name='Повелитель звёздных клинков'
            d={'version':1,'name':name,'budget':41,'rowCost':5,'build':{},'branches':[{'id':'b','name':'Звёзды','rows':5,'talents':[{'id':'t','name':'Сила','row':0,'col':0,'icon':'inv_sword_04','maxRank':2,'descriptions':['2','4'],'requires':''}]}],'abilities':[{'id':'a','name':'Искра','description':'Наносит урон.','icon':'inv_sword_04','branchId':'b'}]}
            pid=owner.request.post(base+'/api/projects',data={'document':d}).json()['id']
            token=owner.request.post(base+'/api/publish',data={'projectId':pid,'visibility':'public'}).json()['token']
            page=owner.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda dialog:dialog.accept())
            page.goto(base+'/?share='+token);page.wait_for_function("document.querySelector('#publicationBar').textContent.includes('Версия')")
            page.wait_for_function("document.querySelector('#user').textContent==='layout_author'")
            for selector in ['#treeActions','#characterSettings','#undo','#redo','#share','#export','#import','#save','#hint','.tree-section-title']:
                assert not page.locator(selector).is_visible(),selector
            assert page.locator('#focusBranch,#zoomReset,#zoomIn,#zoomOut').count()==0
            assert page.locator('.model-placeholder').count()==0
            assert page.locator('#chooseFavorite').is_visible()
            assert page.locator('#chooseFavorite').evaluate("el=>el.previousElementSibling.id==='playMode'")
            page.locator('#chooseFavorite').click();page.wait_for_function("document.querySelector('#toast').textContent==='Дерево добавлено в избранное'")
            page.locator('#chooseFavorite').click()
            assert len(owner.request.get(base+'/api/favorites').json()['favorites'])==1
            page.locator('#favorites').click();page.wait_for_selector('[data-kind="tree"]');page.locator('[data-kind="tree"]').click();page.locator('[data-use]').click()
            page.wait_for_function("document.querySelector('#library').hidden")
            assert page.locator('#treeTitle').inner_text()==name
            for width in [1440,1024,768,390,320]:
                page.set_viewport_size({'width':width,'height':1100})
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
                assert page.locator('#treeTitle').evaluate('el=>el.clientHeight>=parseFloat(getComputedStyle(el).lineHeight)-1')
                assert page.locator('.abilities-heading').evaluate("el=>{const a=el.querySelector('h2').getBoundingClientRect(),b=el.querySelector('#abilityViewControls').getBoundingClientRect();return Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2)<4}")
            page.set_viewport_size({'width':1440,'height':1100})
            page.locator('#accountMenu').click();page.locator('#profileSettings').click();assert not page.locator('#show3d').is_checked()
            page.locator('#show3d').check();page.locator('#submitModal').click();page.wait_for_selector('.model-placeholder')
            page.reload();page.wait_for_selector('.model-placeholder')
            assert owner.request.get(base+'/api/me').json()['user']['show3d'] is True
            page.locator('#accountMenu').click();page.locator('#profileSettings').click();page.locator('#show3d').uncheck();page.locator('#submitModal').click();page.wait_for_function("!document.querySelector('#modal').open")
            assert page.locator('.model-placeholder').count()==0
            snapshot=dict(d,name='Личная копия')
            fid=owner.request.post(base+'/api/favorites',data={'kind':'tree','item':{'document':snapshot}}).json()['id']
            page.locator('#favorites').click();page.wait_for_selector('[data-use="'+fid+'"]');page.locator('[data-use="'+fid+'"]').click()
            page.locator('[data-talent="t"]').click();assert page.locator('#points').inner_text()=='1 / 41'
            page.locator('#favorites').click();page.wait_for_selector('[data-use="'+fid+'"]');page.locator('[data-use="'+fid+'"]').click()
            assert page.locator('#points').inner_text()=='1 / 41'
            assert '?share=' not in page.url
            page.locator('#editMode').click();assert page.locator('#save').is_visible();assert page.locator('#characterSettings').is_visible()
            assert page.locator('#className').evaluate('el=>el.tagName==="TEXTAREA" && el.rows===1')
            page.locator('#rankings').click();page.wait_for_selector('.publication-title')
            assert page.locator('.publication-title').evaluate('el=>{const s=getComputedStyle(el);return s.whiteSpace!=="nowrap"&&s.webkitLineClamp==="2"&&el.clientHeight>=parseFloat(s.lineHeight)*2-1}')
            guest=browser.new_context(viewport={'width':390,'height':900});g=guest.new_page();g.goto(base+'/?share='+token);g.wait_for_function("document.querySelector('#treeTitle').textContent.includes('Повелитель')")
            assert not g.locator('#chooseFavorite').is_visible();assert g.locator('.model-placeholder').count()==0
            g.locator('[data-talent="t"]').click();assert g.locator('#points').inner_text()=='1 / 41'
            assert not errors,errors
            print('PASS: clean guest/auth calculator; two-line titles; inline ability modes; tree favorite save/open/dedup; 3D default off and persistent profile toggle; editor controls restored; mobile layout.')
            browser.close()
    finally:
        http.shutdown();http.server_close()
