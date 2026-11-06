"""Working-tree trash and independent foreign-tree copies, temporary DB only."""
import copy,sys,tempfile,threading,os
from pathlib import Path
from unittest.mock import patch
from playwright.sync_api import sync_playwright,expect
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server

with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'SMTP_HOST':'','SMTP_FROM':'','APP_URL':'','REQUIRE_EMAIL_VERIFICATION':'0'}):
    server.DB=str(Path(tmp)/'archive.sqlite');server.initialize()
    http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler)
    threading.Thread(target=http.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{http.server_port}'
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            owner=browser.new_context(viewport={'width':1440,'height':1000});owner.route('https://**/*',lambda route:route.abort())
            owner.request.post(base+'/api/register',data={'login':'tree_owner','email':'owner@example.test','password':'test-password-123'})
            owner.request.post(base+'/api/profile/settings',data={'language':'ru'})
            document={'version':1,'name':'Хранитель архива','budget':41,'rowCost':5,'build':{},'abilities':[],'branches':[{'id':'one','name':'Рассвет','rows':5,'talents':[]},{'id':'two','name':'Закат','rows':5,'talents':[]}]}
            pid=owner.request.post(base+'/api/projects',data={'document':document}).json()['id']
            token=owner.request.post(base+'/api/publish',data={'projectId':pid,'visibility':'public'}).json()['token']
            draft=copy.deepcopy(document);draft['name']='Идея в черновиках'
            draftid=owner.request.post(base+'/api/projects',data={'document':draft}).json()['id']
            page=owner.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base);expect(page.locator('#user')).to_have_text('tree_owner');page.locator('#projects').click()
            expect(page.locator('.community-heading .muted')).to_have_text('Сохраняй идеи в черновиках и возвращайся к своим деревьям.')
            expect(page.locator(f'[data-open="{draftid}"]')).to_contain_text('Черновик')
            expect(page.locator('#libraryItems button[data-open]')).to_have_count(0)
            # Click a part of the card that used to be inert.
            page.locator(f'[data-open="{pid}"] .muted').click();expect(page.locator('#className')).to_have_value(document['name'])
            page.locator('#projects').click();page.locator(f'[data-remove="{pid}"]').click()
            expect(page.locator('#modalBody')).to_contain_text('недоступно по ссылке')
            expect(page.locator('#modalBody')).to_contain_text('30 дней')
            page.locator('#cancelArchive').click();expect(page.locator('#modal')).not_to_be_visible()
            page.locator(f'[data-remove="{pid}"]').click();page.keyboard.press('Escape');expect(page.locator('#modal')).not_to_be_visible()
            assert owner.request.get(base+'/api/shared/'+token).status==200
            page.locator(f'[data-remove="{pid}"]').click();page.locator('#submitModal').click()
            expect(page.locator(f'[data-open="{pid}"]')).to_have_count(0)
            page.locator('#toggleTreeArchive').click();expect(page.locator('#toggleTreeArchive')).to_have_text('Вернуться в активные')
            search_box=page.locator('.search-field').bounding_box();toggle_box=page.locator('#toggleTreeArchive').bounding_box()
            assert 0 <= toggle_box['x']-(search_box['x']+search_box['width']) <= 16
            expect(page.locator('[data-archive-expires]')).to_contain_text('До удаления: 30 дн.')
            assert owner.request.get(base+'/api/rankings').json()['publications']==[]
            # The archive remains usable without page overflow at small widths.
            for width in [1440,768,390,320]:
                page.set_viewport_size({'width':width,'height':1000})
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
            page.set_viewport_size({'width':1440,'height':1000})
            page.screenshot(path='work/tree-archive-desktop.png',full_page=True)
            page.locator('[data-restore-tree]').click();expect(page.locator('[data-restore-tree]')).to_have_count(0)
            page.locator('#toggleTreeArchive').click();expect(page.locator(f'[data-open="{pid}"]')).to_be_visible()
            # Keyboard opens the same whole-card target.
            page.locator(f'[data-open="{pid}"]').focus();page.keyboard.press('Enter');expect(page.locator('#className')).to_have_value(document['name'])
            page.locator('#publications').click();page.locator('[data-archive-publication]').click();page.locator('#submitModal').click()
            expect(page.locator('[data-archive-publication]')).to_have_count(0)
            page.locator('#archivedPublications').click();expect(page.locator('[data-archive-expires]')).to_contain_text('До удаления:')
            page.locator('[data-restore-publication]').click();expect(page.locator('[data-restore-publication]')).to_have_count(0)
            # A visitor must copy before entering the editor; original and metadata are untouched.
            viewer=browser.new_context(viewport={'width':1440,'height':1000});viewer.route('https://**/*',lambda route:route.abort())
            viewer.request.post(base+'/api/register',data={'login':'tree_copier','email':'copy@example.test','password':'test-password-123'})
            v=viewer.new_page();v.on('pageerror',lambda e:errors.append(str(e)));v.goto(base+'/?share='+token)
            expect(v.locator('#copyToSelf')).to_have_text('Copy to my trees');expect(v.locator('#editMode')).not_to_be_visible()
            original=owner.request.get(base+'/api/projects/'+pid).json()['document']
            v.locator('#copyToSelf').click();expect(v.locator('#editMode')).to_be_visible();expect(v.locator('#copyToSelf')).not_to_be_visible()
            copies=viewer.request.get(base+'/api/projects').json()['projects'];assert len(copies)==1;assert copies[0]['name'].endswith('— copy');assert copies[0]['id']!=pid
            v.locator('#className').fill('Independent changed draft');v.locator('#className').dispatch_event('change');v.locator('#save').click()
            expect(v.locator('#saveState')).to_have_text('Saved to account')
            assert owner.request.get(base+'/api/projects/'+pid).json()['document']==original
            assert owner.request.get(base+'/api/shared/'+token).json()['publication']['saved']==1
            # Guest gets authentication and resumes the same copy action after login.
            guest=browser.new_context(viewport={'width':390,'height':1000});guest.route('https://**/*',lambda route:route.abort())
            g=guest.new_page();g.on('pageerror',lambda e:errors.append(str(e)));g.goto(base+'/?share='+token)
            expect(g.locator('#copyToSelf')).to_be_visible();g.locator('#copyToSelf').click()
            g.locator('#login').fill('copy@example.test');g.locator('#password').fill('test-password-123');g.locator('#submitModal').click()
            expect(g.locator('#copyToSelf')).not_to_be_visible();expect(g.locator('#editMode')).to_be_visible()
            assert len(viewer.request.get(base+'/api/projects').json()['projects'])==2
            assert not errors,errors
            browser.close();print('PASS: card/keyboard opening, draft labels, archive warning/cancel/deadline/restoration, publication deletion, mobile layout, foreign copy and guest login continuation; original unchanged.')
    finally:
        http.shutdown();http.server_close()
