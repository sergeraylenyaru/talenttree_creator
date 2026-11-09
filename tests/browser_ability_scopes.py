"""Common/unique columns, reverse icon flow, and a persisted channeled spell."""
import json, os, sys, tempfile, threading
from pathlib import Path
from unittest.mock import patch
from playwright.sync_api import sync_playwright, expect
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server

with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ,{'SMTP_HOST':'','SMTP_FROM':'','APP_URL':'','REQUIRE_EMAIL_VERIFICATION':'0'}):
    server.DB=str(Path(tmp)/'scopes.sqlite');server.initialize()
    http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler)
    threading.Thread(target=http.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{http.server_port}'
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            ctx=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
            ctx.route('https://**/*',lambda route:route.abort())
            ctx.request.post(base+'/api/register',data={'login':'scope_author','email':'scope@example.test','password':'test-password-123'})
            abilities=[]
            for scope,count in [('common',7),('unique',7)]:
                for i in range(count):
                    abilities.append({'id':f'{scope}-{i}','name':f'{scope.title()} skill {i+1}','description':'A long description that should stay readable in the detailed view.','icon':'spell_holy_holybolt','branchId':'one','branchOnly':scope=='unique','kind':'active' if i<5 else 'passive','learningMode':'base','cast':0,'range':0,'cooldown':0})
            abilities.append({'id':'general','name':'Book skill','description':'General ability.','icon':'inv_misc_book_09','branchId':'','kind':'active','learningMode':'base'})
            document={'version':1,'name':'Ability layout','primaryBranchEnabled':True,'budget':41,'rowCost':5,'build':{},'branches':[{'id':'one','name':'Light','rows':5,'talents':[]}],'abilities':abilities}
            pid=ctx.request.post(base+'/api/projects',data={'document':document}).json()['id']
            page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base);expect(page.locator('#user')).to_have_text('scope_author')
            page.locator('#projects').click();page.locator(f'[data-open="{pid}"]').click()
            band=page.locator('[data-ability-band="one"]')
            common=band.locator('[data-ability-scope="common"]');unique=band.locator('[data-ability-scope="unique"]')
            expect(common.locator('h3')).to_contain_text('Common');expect(unique.locator('h3')).to_contain_text('Unique')
            expect(common.locator('[data-ability-kind="active"] [data-ability]')).to_have_count(5)
            expect(unique.locator('[data-ability-kind="passive"] [data-ability]')).to_have_count(2)
            assert band.locator('[data-ability]').count()==14
            assert page.locator('[data-ability-band="general"] [data-ability-scope="common"] [data-ability]').count()==1
            def layout():
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                left,right=common.bounding_box(),unique.bounding_box();assert left['x']+left['width']<=right['x']
                assert abs(common.locator('[data-ability]').first.bounding_box()['x']-left['x'])<2
                items=unique.locator('[data-ability-kind="active"] [data-ability]').evaluate_all('els=>els.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right};})')
                assert abs(items[0]['right']-(right['x']+right['width']))<2
                for a,b in zip(items,items[1:]):
                    assert b['y']>a['y'] or b['x']<a['x']
                assert common.locator('[data-ability-kind="active"]').bounding_box()['y']<common.locator('[data-ability-kind="passive"]').bounding_box()['y']
            for width in [1440,1366,768,390,320]:
                page.set_viewport_size({'width':width,'height':1000});page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');layout()
            page.set_viewport_size({'width':1366,'height':768})
            unique.locator('[data-ability="unique-0"]').click()
            expect(page.locator('#abilityChanneled')).not_to_be_checked()
            page.locator('#abilityChanneled').check();expect(page.locator('label[for="cast"]')).to_have_text('CHANNEL DURATION, SEC')
            page.locator('#cast').fill('4.5')
            assert page.locator('#modalBody').evaluate('e=>e.scrollHeight<=e.clientHeight+2&&e.scrollWidth<=e.clientWidth+1')
            page.locator('#abilityKind').select_option('passive');expect(page.locator('#abilityChanneled')).to_be_disabled()
            page.locator('#abilityKind').select_option('active');expect(page.locator('#abilityChanneled')).to_be_checked()
            page.locator('#submitModal').click();page.locator('#save').click();expect(page.locator('#saveState')).to_have_text('Saved to account')
            saved=ctx.request.get(base+'/api/projects/'+pid).json()['document'];assert saved['abilities'][7]['channeled'] and saved['abilities'][7]['cast']==4.5
            page.locator('[data-ability-view="details"]').click()
            expect(unique.locator('[data-ability="unique-0"]')).to_contain_text('Channeled')
            assert unique.locator('[data-ability="unique-0"]').evaluate('e=>getComputedStyle(e).direction')=='ltr'
            page.screenshot(path='work/ability-scopes-details.png',full_page=True)
            for width in [768,390,320]:
                page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.set_viewport_size({'width':1440,'height':1000});page.locator('[data-ability-view="icons"]').click()
            page.locator('#playMode').click();layout();page.locator('[data-select-primary="one"]').click()
            unique.locator('[data-ability="unique-0"]').hover();expect(page.locator('#tooltip')).to_contain_text('Channeled');expect(page.locator('#tooltip')).to_contain_text('4.5')
            page.screenshot(path='work/ability-scopes-icons.png',full_page=True)
            page.locator('#editMode').click();unique.locator('[data-ability="unique-0"]').click();expect(page.locator('#abilityChanneled')).to_be_checked();page.locator('#closeModal').click()
            with page.expect_download() as download:page.locator('#export').click()
            assert json.loads(Path(download.value.path()).read_text())['abilities'][7]['channeled']
            token=ctx.request.post(base+'/api/publish',data={'projectId':pid,'visibility':'public'}).json()['token']
            guest=browser.new_context();guest.route('https://**/*',lambda route:route.abort());g=guest.new_page();g.goto(base+'/?share='+token)
            expect(g.locator('[data-ability-band="one"] [data-ability-scope="unique"] [data-ability]')).to_have_count(7)
            g.locator('[data-ability-band="one"] [data-ability="unique-0"]').hover();expect(g.locator('#tooltip')).to_contain_text('Channeled')
            assert not errors,errors
            print('PASS: common/unique scopes, right-to-left icon wrapping, active/passive order, icons/details and mobile layout; compact channeled editor, duration labels, saved/exported/published flag and instant tooltips.')
            browser.close()
    finally:
        http.shutdown();http.server_close()
