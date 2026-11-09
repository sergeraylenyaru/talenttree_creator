"""Large continuous icon dialog and primary-tree abilities in custom classes."""
import os, re, sys, tempfile, threading
from pathlib import Path
from unittest.mock import patch
from playwright.sync_api import sync_playwright, expect
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'SMTP_HOST':'', 'SMTP_FROM':'', 'APP_URL':'', 'REQUIRE_EMAIL_VERIFICATION':'0'}):
    server.DB = str(Path(tmp)/'primary.sqlite')
    server.initialize()
    http = server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler)
    threading.Thread(target=http.serve_forever,daemon=True).start()
    base = f'http://127.0.0.1:{http.server_port}'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            ctx = browser.new_context(viewport={'width':1440,'height':900})
            ctx.route('https://**/*',lambda route:route.abort())
            ctx.request.post(base+'/api/register',data={'login':'primary_author','email':'primary@example.test','password':'test-password-123'})
            document = {'version':1,'name':'Primary fixture','budget':41,'rowCost':5,'build':{},'abilities':[], 'branches':[
                {'id':'one','name':'Sun','rows':5,'talents':[{'id':'talent','name':'Light','icon':'spell_holy_holybolt','row':0,'col':0,'maxRank':1,'descriptions':['Light.'],'requires':''}]},
                {'id':'two','name':'Moon','rows':5,'talents':[]}]}
            pid = ctx.request.post(base+'/api/projects',data={'document':document}).json()['id']
            page = ctx.new_page()
            errors = []
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base)
            expect(page.locator('#user')).to_have_text('primary_author')
            page.locator('#projects').click()
            page.locator(f'[data-open="{pid}"]').click()
            page.locator('#addAbility').click()
            page.locator('#abilityName').fill('Solar gift')
            page.locator('#abilityDescription').fill('A gift from the Sun.')
            expect(page.locator('label.ability-branch-only')).to_have_text('Ability exclusive to this tree')
            page.locator('#abilityBranchOnly').check()
            expect(page.locator('#abilityBranch')).to_have_value('one')
            expect(page.locator('#abilityBranch option[value="auto"]')).to_be_disabled()
            expect(page.locator('#abilityLearning')).to_have_value('base')
            page.locator('#toggleIconPicker').click()
            expect(page.locator('#iconDialog')).to_be_visible()
            expect(page.locator('#confirmIconDialog')).to_have_text('Choose')
            page.wait_for_function('Number(document.querySelector("#iconGrid").dataset.total)>33000')
            expect(page.locator('#iconCount')).to_contain_text('Catalog:')
            assert abs(page.locator('#iconDialog').bounding_box()['width']-page.locator('#modal').bounding_box()['width'])<80
            assert page.locator('#moreIcons').count()==0
            assert page.locator('#iconGrid [data-icon]').count()<400
            page.locator('#iconGrid [data-icon]').first.focus()
            page.keyboard.press('End')
            page.wait_for_function('()=>{const g=document.querySelector("#iconGrid");return Number(document.activeElement.dataset.iconIndex)===Number(g.dataset.total)-1;}')
            for width,height in [(1440,900),(768,900),(390,844),(320,700)]:
                page.set_viewport_size({'width':width,'height':height})
                page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                bounds=page.locator('#iconDialog').bounding_box()
                assert bounds['width']<=width and bounds['height']<=height
                assert page.locator('#closeIconDialog').bounding_box()['y']>=0
                assert page.locator('#iconGrid').evaluate('e=>e.scrollWidth<=e.clientWidth')
            page.set_viewport_size({'width':1440,'height':900})
            page.locator('#iconSearch').fill('no_such_icon_fixture_102938')
            expect(page.locator('#iconGrid [data-icon]')).to_have_count(0)
            page.locator('#iconSearch').fill('inv_stegodonprimalmount_blue')
            expect(page.locator('#iconGrid [data-icon]')).to_have_count(1)
            page.screenshot(path='work/large-icon-dialog.png')
            page.locator('#iconName').fill('spell_nature_starfall')
            page.locator('#closeIconDialog').click()
            expect(page.locator('#iconName')).to_have_value('inv_misc_questionmark')
            expect(page.locator('#abilityName')).to_have_value('Solar gift')
            expect(page.locator('#abilityDescription')).to_have_value('A gift from the Sun.')
            expect(page.locator('#abilityBranchOnly')).to_be_checked()
            page.locator('#toggleIconPicker').click()
            page.locator('[data-icon="inv_stegodonprimalmount_blue"]').click()
            expect(page.locator('#iconDialog')).not_to_be_visible()
            for selector in ['#cast','#cooldown','#range']:
                page.locator(selector).fill('0')
            page.locator('#submitModal').click()
            expect(page.locator('#modal')).not_to_be_visible()
            page.locator('#save').click()
            expect(page.locator('#saveState')).to_have_text('Saved to account')
            saved=ctx.request.get(base+'/api/projects/'+pid).json()['document']
            ability=saved['abilities'][0]
            assert ability['branchOnly'] and ability['branchId']=='one' and ability['learningMode']=='base'
            page.locator('#playMode').click()
            expect(page.locator('[data-select-primary]')).to_have_count(2)
            assert page.locator('#specializationChoice').bounding_box()['y']<page.locator('#trees').bounding_box()['y']
            card=page.locator(f'#abilities [data-ability="{ability["id"]}"]')
            expect(card).to_have_class(re.compile('locked'))
            page.locator('[data-select-primary="one"]').click()
            expect(card).not_to_have_class(re.compile('locked'))
            page.locator('[data-talent="talent"]').click()
            page.locator('[data-select-primary="two"]').click()
            expect(card).to_have_class(re.compile('locked'))
            expect(page.locator('#points')).to_have_text('1 / 41')
            page.reload()
            expect(page.locator('[data-select-primary="two"]')).to_have_attribute('aria-pressed','true')
            expect(page.locator('#points')).to_have_text('1 / 41')
            assert 'primaryBranchId' not in ctx.request.get(base+'/api/projects/'+pid).json()['document']
            page.locator('#editMode').click()
            page.once('dialog',lambda dialog:dialog.accept())
            page.locator('.tree[data-branch="one"] [data-action="delete-branch"]').click()
            page.locator('#save').click()
            expect(page.locator('#saveState')).to_have_text('Saved to account')
            remaining=ctx.request.get(base+'/api/projects/'+pid).json()['document']
            assert len(remaining['branches'])==1 and not remaining['abilities'][0]['branchOnly']
            assert remaining['abilities'][0]['branchId']==''
            assert not errors,errors
            print('PASS: full-size continuous icon dialog, keyboard/end/search, cancellation and parent fields, mobile layout; custom primary choice, exclusive abilities, local persistence and branch deletion.')
            browser.close()
    finally:
        http.shutdown()
        http.server_close()
