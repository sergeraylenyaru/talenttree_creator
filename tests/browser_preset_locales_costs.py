"""Preset copies use profile language; resource rows fit; free spells omit cost."""
import os,re,sys,tempfile,threading
from pathlib import Path
from unittest.mock import patch
from playwright.sync_api import sync_playwright,expect
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server

with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'SMTP_HOST':'','SMTP_FROM':'','APP_URL':'','REQUIRE_EMAIL_VERIFICATION':'0'}):
    server.DB=str(Path(tmp)/'locales.sqlite');server.initialize()
    http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);threading.Thread(target=http.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{http.server_port}'
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            contexts=[];errors=[]
            for language in ['ru','en']:
                ctx=browser.new_context(viewport={'width':1440,'height':1000});contexts.append(ctx);ctx.route('https://**/*',lambda route:route.abort())
                login='locale_'+language;ctx.request.post(base+'/api/register',data={'login':login,'email':login+'@example.test','password':'test-password-123'});ctx.request.post(base+'/api/profile/settings',data={'language':language})
                page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base);expect(page.locator('#user')).to_have_text(login)
                for version,prefix in [('3.3.5a',''),('2.4.3','tbc-'),('Forever','forever-'),('4.3.4','cata-')]:
                    page.locator('#treeActions summary').click();page.locator('#loadPresetFromEditor').click();page.locator('[data-version="'+version+'"]').click()
                    choice=page.locator('[data-class="'+prefix+'druid"]');expect(choice).to_contain_text('Друид' if language=='ru' else 'Druid');choice.click();page.locator('#submitModal').click()
                    expected=('Друид' if language=='ru' else 'Druid')+' · '+version
                    expect(page.locator('#className')).to_have_value(expected);expect(page.locator('.tree-header input').first).to_have_value('Баланс' if language=='ru' else 'Balance')
                    page.locator('[data-talent]').first.hover();expect(page.locator('#tooltip')).to_be_visible()
                    title=page.locator('#tooltip strong').first.inner_text();assert bool(re.search('[А-Яа-яЁё]',title))==(language=='ru'),(version,title)
                    page.locator('#save').click();expect(page.locator('#saveState')).to_have_text('Сохранено в аккаунте' if language=='ru' else 'Saved to account')
                    item=next(x for x in ctx.request.get(base+'/api/projects').json()['projects'] if x['name']==expected);doc=ctx.request.get(base+'/api/projects/'+item['id']).json()['document'];assert doc['source']['language']==language
                if language=='ru':
                    # UI language changes never rewrite an authored/saved tree.
                    ctx.request.post(base+'/api/profile/settings',data={'language':'en'});page.reload();expect(page.locator('#editMode')).to_have_attribute('aria-pressed','true');expect(page.locator('#className')).to_have_value('Друид · 4.3.4');expect(page.locator('.tree-header input').first).to_have_value('Баланс')
            ctx=contexts[1];page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
            resources=[{'id':'r'+str(i),'name':'Mana' if i==0 else ('Very long custom resource '+str(i)+' '+('a'*55)),'max':100,'current':100,'unit':'percent','display':'bar','shape':'circle','color':'#3377cc'} for i in range(4)]
            doc={'version':1,'name':'Free abilities','budget':41,'rowCost':5,'build':{},'branches':[{'id':'one','name':'One','rows':5,'talents':[]}],'character':{'hp':1000,'race':'Human','gender':'Male','armory':'','resources':resources},'abilities':[
                {'id':'free','name':'Free modern','icon':'inv_misc_book_09','description':'No cost.','cast':0,'range':0,'cooldown':5,'resourceCosts':[{'resourceId':'health','amount':0,'unit':'percent'},{'resourceId':'r0','amount':0,'unit':'percent'}]},
                {'id':'legacy','name':'Free legacy','icon':'inv_misc_book_09','description':'Legacy no cost.','cast':0,'range':0,'cooldown':0,'resourceType':'Mana','resource':0,'resourceUnit':'percent'}]}
            pid=ctx.request.post(base+'/api/projects',data={'document':doc}).json()['id'];page.goto(base);expect(page.locator('#user')).to_have_text('locale_en');page.locator('#projects').click();page.locator('[data-open="'+pid+'"]').click()
            page.locator('#abilities [data-ability="free"]').click()
            while not page.locator('#addResourceCost').is_disabled():page.locator('#addResourceCost').click()
            expect(page.locator('.resource-cost-row')).to_have_count(5)
            for width,height in [(1440,1000),(1366,768),(768,900),(390,844),(320,700)]:
                page.set_viewport_size({'width':width,'height':height});page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                assert page.locator('.resource-cost-list').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
                assert page.locator('.resource-cost-row').evaluate_all('rows=>rows.every(row=>{const r=row.getBoundingClientRect();return [...row.children].every(c=>{const b=c.getBoundingClientRect();return b.x>=r.x-1&&b.right<=r.right+1;});})')
                assert page.locator('#modalBody').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
            page.set_viewport_size({'width':1366,'height':768});page.screenshot(path='work/resource-cost-no-horizontal-scroll.png');page.locator('#submitModal').click()
            page.locator('[data-ability-view="details"]').click()
            for aid in ['free','legacy']:
                card=page.locator('#abilities [data-ability="'+aid+'"]');expect(card.locator('.interface-text')).not_to_contain_text('Cost:');card.hover();expect(page.locator('#tooltip')).not_to_contain_text('Cost:')
            page.locator('#playMode').click();page.locator('#abilities [data-ability="free"]').click();expect(page.locator('#modal .spell-stats')).not_to_contain_text('Cost:');expect(page.locator('#modal .spell-stats')).to_contain_text('Instant');page.locator('#closeModal').click()
            page.locator('#editMode').click();page.locator('#abilities [data-ability="free"]').click();page.locator('[data-cost-amount]').first.fill('5');page.locator('#submitModal').click()
            card=page.locator('#abilities [data-ability="free"]');expect(card.locator('.interface-text')).to_contain_text('5% Health');expect(card.locator('.interface-text')).not_to_contain_text('0%');expect(card.locator('.interface-text')).not_to_contain_text('Mana')
            assert not errors,errors
            print('PASS: Russian/English copies in all four editions, saved language and authored text preserved; five long resource rows fit at 320–1440px; zero/legacy/mixed costs in details, tooltips and read-only dialogs.')
            browser.close()
    finally:http.shutdown();http.server_close()
