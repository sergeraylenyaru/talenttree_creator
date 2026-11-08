"""Draft dialog cancellation, real dirty state, free-text requirements and title hierarchy."""
import copy,os,sys,tempfile,threading
from pathlib import Path
from unittest.mock import patch
from playwright.sync_api import sync_playwright,expect
sys.path.insert(0,str(Path(__file__).resolve().parents[1]));import server

with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'SMTP_HOST':'','SMTP_FROM':'','APP_URL':'','REQUIRE_EMAIL_VERIFICATION':'0'}):
    server.DB=str(Path(tmp)/'draft-navigation.sqlite');server.initialize()
    http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);threading.Thread(target=http.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{http.server_port}'
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':1440,'height':1000});ctx.route('https://**/*',lambda route:route.abort())
            ctx.request.post(base+'/api/register',data={'login':'draft_author','email':'draft@example.test','password':'test-password-123'});ctx.request.post(base+'/api/profile/settings',data={'language':'ru'})
            a={'version':1,'name':'Паладин','subtitle':'Воин света','budget':41,'rowCost':5,'build':{},'branches':[{'id':'b','name':'Свет','rows':5,'talents':[{'id':'t','name':'Сила','row':0,'col':0,'icon':'inv_misc_book_09','maxRank':2,'descriptions':['Урон 5','Урон 10'],'requires':''}]}],'abilities':[{'id':'a','name':'Удар','icon':'inv_misc_book_09','description':'Урон','requirements':['Латы','Кинжалы']}]}
            b=copy.deepcopy(a);b.update(name='Охотник',subtitle='Следопыт');aid=ctx.request.post(base+'/api/projects',data={'document':a}).json()['id'];bid=ctx.request.post(base+'/api/projects',data={'document':b}).json()['id']
            page=ctx.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)));page.goto(base);expect(page.locator('#user')).to_have_text('draft_author');page.locator('#projects').click();page.locator('[data-open="'+aid+'"]').click()
            expect(page.locator('#classSubtitle')).to_have_attribute('placeholder','Необязательная заметка')
            # Opening a legacy ability and cancelling must not add default character data.
            page.locator('[data-ability="a"]').click();expect(page.locator('#abilityRequirements')).to_have_value('Латы, Кинжалы');assert page.locator('[data-ability-requirement]').count()==0;page.locator('#closeModal').click()
            page.locator('#save').click();expect(page.locator('#saveState')).to_have_text('Сохранено в аккаунте')
            # Repeated change events and reverted input are not new structural changes.
            page.locator('#className').dispatch_event('change');page.locator('#classSubtitle').dispatch_event('change');page.locator('#classSubtitle').fill('Промежуточная заметка');page.locator('#classSubtitle').blur();page.locator('#classSubtitle').fill('Воин света');page.locator('#classSubtitle').blur()
            page.locator('#playMode').click();page.locator('[data-talent="t"]').click();page.locator('#projects').click();page.locator('[data-open="'+bid+'"]').click();expect(page.locator('#className')).to_have_value('Охотник');expect(page.locator('#draftDialog')).not_to_be_visible()
            # A real edit still prompts; X and Escape retain the draft list and its search.
            page.locator('#classSubtitle').fill('Новый следопыт');page.locator('#classSubtitle').blur();page.locator('#projects').click();page.locator('#librarySearch').fill('Паладин');page.locator('[data-open="'+aid+'"]').click();expect(page.locator('#draftDialog')).to_be_visible();page.locator('#closeDraft').click();expect(page.locator('#draftDialog')).not_to_be_visible();expect(page.locator('#library')).to_be_visible();expect(page.locator('#librarySearch')).to_have_value('Паладин');expect(page.locator('.workspace')).not_to_be_visible()
            page.locator('[data-open="'+aid+'"]').click();expect(page.locator('#draftDialog')).to_be_visible();page.keyboard.press('Escape');expect(page.locator('#draftDialog')).not_to_be_visible();expect(page.locator('#library')).to_be_visible()
            page.locator('[data-open="'+aid+'"]').click();page.locator('#stayDraft').click();expect(page.locator('#className')).to_have_value('Охотник');expect(page.locator('#classSubtitle')).to_have_value('Новый следопыт');expect(page.locator('.workspace')).to_be_visible()
            # Saving from the prompt opens the requested tree and does not prompt again.
            page.locator('#projects').click();page.locator('[data-open="'+aid+'"]').click();page.locator('#saveDraft').click();expect(page.locator('#className')).to_have_value('Паладин');assert ctx.request.get(base+'/api/projects/'+bid).json()['document']['subtitle']=='Новый следопыт'
            page.locator('#projects').click();page.locator('[data-open="'+bid+'"]').click();expect(page.locator('#className')).to_have_value('Охотник');expect(page.locator('#draftDialog')).not_to_be_visible()
            # Text requirements survive save/reopen and appear verbatim in the tooltip.
            requirement='Щит и свободная рука; стойка Стража (уровень 20)'
            page.locator('[data-ability="a"]').click();page.locator('#abilityRequirements').fill(requirement);page.locator('#submitModal').click();page.locator('#save').click();expect(page.locator('#saveState')).to_have_text('Сохранено в аккаунте');assert ctx.request.get(base+'/api/projects/'+bid).json()['document']['abilities'][0]['requirements']==requirement
            page.locator('#playMode').click();page.locator('[data-ability="a"]').hover();expect(page.locator('#tooltip')).to_contain_text('Требуется: '+requirement)
            token=ctx.request.post(base+'/api/publish',data={'projectId':bid,'visibility':'public'}).json()['token'];guest=browser.new_context();guest.route('https://**/*',lambda route:route.abort());g=guest.new_page();g.goto(base+'/?share='+token);expect(g.locator('#classSubtitle')).to_have_attribute('placeholder','Optional note');g.locator('[data-ability="a"]').hover();expect(g.locator('#tooltip')).to_contain_text('Requires: '+requirement);guest.close()
            title=page.locator('#treeTitle').evaluate('el=>({weight:Number(getComputedStyle(el).fontWeight),size:parseFloat(getComputedStyle(el).fontSize)})');note=page.locator('#treeSubtitle').evaluate('el=>({weight:Number(getComputedStyle(el).fontWeight),size:parseFloat(getComputedStyle(el).fontSize)})');assert title['weight']>=700 and note['weight']==400 and title['size']>note['size'] and 14<=note['size']<=22
            # Changes made during an in-flight save remain dirty after its response.
            page.locator('#editMode').click();page.locator('#classSubtitle').fill('Отправлено');page.locator('#classSubtitle').blur();pending=[]
            def defer(route):
                if route.request.method=='POST':pending.append(route)
                else:route.continue_()
            page.route('**/api/projects',defer)
            with page.expect_request(lambda request:request.url==base+'/api/projects' and request.method=='POST'):page.locator('#save').click()
            assert pending;page.locator('#classSubtitle').fill('Правка во время сохранения');page.locator('#classSubtitle').blur();response=pending[0].fetch();pending[0].fulfill(response=response);expect(page.locator('#saveState')).to_have_text('Есть несохранённые изменения');page.unroute('**/api/projects',defer)
            assert ctx.request.get(base+'/api/projects/'+bid).json()['document']['subtitle']=='Отправлено'
            page.locator('#projects').click();page.locator('[data-open="'+aid+'"]').click();expect(page.locator('#draftDialog')).to_be_visible();page.locator('#closeDraft').click();expect(page.locator('#library')).to_be_visible();page.locator('#returnEditor').click();expect(page.locator('#classSubtitle')).to_have_value('Правка во время сохранения')
            page.locator('#save').click();expect(page.locator('#saveState')).to_have_text('Сохранено в аккаунте');page.evaluate('localStorage.setItem("talentforge-draft-dirty","1")');page.reload();expect(page.locator('#user')).to_have_text('draft_author');page.locator('#projects').click();page.locator('[data-open="'+aid+'"]').click();expect(page.locator('#className')).to_have_value('Паладин');expect(page.locator('#draftDialog')).not_to_be_visible()
            # X from a prompt opened in the editor also returns to the draft list.
            page.locator('#classSubtitle').fill('Несохранённая заметка');page.locator('#classSubtitle').blur();page.locator('#treeActions summary').click();page.locator('#createTreeFromEditor').click();expect(page.locator('#draftDialog')).to_be_visible();page.locator('#closeDraft').click();expect(page.locator('#library')).to_be_visible()
            for width in [1440,768,390,320]:page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.screenshot(path='work/draft-navigation-list.png',full_page=True);assert not errors,errors
            print('PASS: X/Escape preserve the draft list, save/no-op/revert/build do not falsely warn, real and in-flight edits stay protected, text requirements and title hierarchy persist.');browser.close()
    finally:http.shutdown();http.server_close()
