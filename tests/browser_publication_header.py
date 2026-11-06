"""Publication metadata, private dislike counts and ability band layout."""
import sys
import tempfile
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server

with tempfile.TemporaryDirectory() as tmp:
    server.DB=str(Path(tmp)/'header.sqlite');server.initialize()
    http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler)
    threading.Thread(target=http.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{http.server_port}'
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            owner=browser.new_context(viewport={'width':1440,'height':1100})
            owner.request.post(base+'/api/register',data={'login':'header_owner', 'email': 'header_owner@example.test','password':'test-password-123'});owner.request.post(base+'/api/profile/settings',data={'language':'ru'})
            images=[i for i in server.builtin_images() if i.startswith('data:')][:2]
            d={'version':1,'name':'Хранитель небесного огня','budget':41,'rowCost':5,'build':{},
               'classIcon':{'layers':[{'icon':images[0],'opacity':1}]},
               'branches':[{'id':'b'+str(i),'name':['Рассвет','Пламя','Небеса','Защита'][i],'icon':images[i%2],'rows':5,'talents':[]} for i in range(4)],
               'abilities':[{'id':str(i),'name':'Умение '+str(i),'description':'Пример описания способности.','icon':images[i%2],'branchId':'b'+str(i//2),'kind':'active' if i%2 else 'passive'} for i in range(8)]}
            pid=owner.request.post(base+'/api/projects',data={'document':d}).json()['id']
            token=owner.request.post(base+'/api/publish',data={'projectId':pid,'visibility':'public'}).json()['token']
            reviewer=browser.new_context(viewport={'width':1440,'height':1100})
            reviewer.request.post(base+'/api/register',data={'login':'header_reviewer', 'email': 'header_reviewer@example.test','password':'test-password-123'});reviewer.request.post(base+'/api/profile/settings',data={'language':'ru'})
            reviewer.request.post(base+'/api/shared/'+token+'/vote',data={'vote':-1})
            page=owner.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base+'/?share='+token);page.wait_for_function("document.querySelector('#dislikePublication')?.textContent.includes('1')")
            assert page.locator('#publicationBar').evaluate("el=>el.closest('.tree-hero-content')!==null")
            assert page.locator('#publicationVotes').evaluate("el=>el.previousElementSibling.id==='classIcon'")
            assert d['name'] not in page.locator('#publicationBar').inner_text()
            assert d['name'] not in page.locator('#characterPanel').inner_text()
            assert page.locator('#dislikePublication').get_attribute('title')=='Видно только создателю дерева'
            assert 'Видно только' not in page.locator('#treeHero').inner_text()
            assert page.locator('#likePublication').is_disabled()
            assert page.locator('#shareStats').evaluate("el=>el.previousElementSibling.id==='publicationBar'")
            assert page.locator('.ability-band-label strong').count()==0
            for mode in ['icons','details']:
                page.locator('[data-ability-view="'+mode+'"]').click()
                for width in [1440,1024,768,390,320]:
                    page.set_viewport_size({'width':width,'height':1100})
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(mode,width)
                    large=page.locator('.ability-band-label img').first.bounding_box()['width']
                    small=page.locator('.ability-card' if mode=='icons' else '.ability-card img').first.bounding_box()['width']
                    assert abs(large/small-3)<.01,(mode,width,large,small)
                    assert page.locator('#publicationVotes').evaluate("el=>el.getBoundingClientRect().top>=document.querySelector('#classIcon').getBoundingClientRect().bottom")
                    assert page.locator('.ability-band-label').first.evaluate("el=>{const s=getComputedStyle(el);return s.borderRightStyle==='solid'||s.borderBottomStyle==='solid'}")
                    assert page.locator('#publicationBar').evaluate("el=>{const a=el.getBoundingClientRect(),b=document.querySelector('.tree-hero-emblem').getBoundingClientRect();const r=document.createRange();r.selectNodeContents(el.firstElementChild);return [...r.getClientRects()].every(c=>c.right<=b.left+1||c.bottom<=b.top||c.top>=b.bottom)}")
            v=reviewer.new_page();v.on('pageerror',lambda e:errors.append(str(e)));v.goto(base+'/?share='+token)
            v.wait_for_function("document.querySelector('#user').textContent==='header_reviewer'&&document.querySelector('#dislikePublication')?.getAttribute('aria-pressed')==='true'")
            assert v.locator('#dislikePublication').inner_text()=='👎'
            assert v.locator('#dislikePublication').get_attribute('title') is None
            v.locator('#likePublication').click();v.wait_for_function("document.querySelector('#likePublication').getAttribute('aria-pressed')==='true'")
            assert v.locator('#likePublication').inner_text()=='👍 1'
            assert v.locator('#dislikePublication').inner_text()=='👎'
            assert 'dislikes' not in reviewer.request.get(base+'/api/shared/'+token).json()['publication']
            page.reload();page.wait_for_function("document.querySelector('#dislikePublication')?.textContent==='👎 0'")
            page.set_viewport_size({'width':1440,'height':1100})
            page.locator('#accountMenu').click();page.locator('#logout').click();page.wait_for_function("document.querySelector('#user').textContent===''")
            page.wait_for_function("document.querySelector('#dislikePublication')?.textContent==='👎'")
            page.locator('#likePublication').click();page.wait_for_selector('#login');page.locator('#closeModal').click()
            page.locator('#rankings').click();assert not page.locator('#publicationVotes').is_visible()
            assert not errors,errors
            print('PASS: metadata under one class title; votes below emblem; owner-only dislike count/hover hint; working votes/auth; no resource title duplicate; 3:1 branch icons and separators at 320–1440 px in both ability views.')
            browser.close()
    finally:
        http.shutdown();http.server_close()
