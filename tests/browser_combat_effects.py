"""Exercise the bilingual combat editor, persistence and conditional fields."""
import json, os, sys, tempfile, threading
from pathlib import Path
from unittest.mock import patch
from playwright.sync_api import sync_playwright, expect
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from server_lifecycle import temporary_database, start_server, stop_server

with temporary_database() as tmp, patch.dict(os.environ, {'SMTP_HOST':'','SMTP_FROM':'','APP_URL':'','REQUIRE_EMAIL_VERIFICATION':'0'}):
    server.DB=str(Path(tmp)/'combat.sqlite');server.initialize()
    http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler)
    start_server(http)
    base=f'http://127.0.0.1:{http.server_port}'
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            ctx=browser.new_context(viewport={'width':1366,'height':900},accept_downloads=True)
            ctx.route('https://**/*',lambda route:route.abort())
            ctx.request.post(base+'/api/register',data={'login':'combat-ui','email':'combat-ui@example.test','password':'test-password-123'})
            document={'version':1,'name':'Combat test','budget':41,'rowCost':5,'build':{},'branches':[{'id':'one','name':'Fire','rows':5,'talents':[]}],'abilities':[{'id':'fireball','name':'Fireball','description':'Legacy ability','icon':'spell_fire_flamebolt','kind':'active','learningMode':'base','branchId':'one','requirements':'Keep me','cast':0,'cooldown':0,'range':0}]}
            pid=ctx.request.post(base+'/api/projects',data={'document':document}).json()['id']
            page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base);expect(page.locator('#user')).to_have_text('combat-ui')
            page.locator('#projects').click();page.locator(f'[data-open="{pid}"]').click()
            page.locator('[data-ability="fireball"]').click()
            expect(page.locator('.combat-effects h3')).to_have_text('COMBAT EFFECTS')
            page.locator('[data-add]').click()
            rows=page.locator('[data-combat-row]');expect(rows).to_have_count(1)
            rows.nth(0).locator('[data-key="school"]').select_option('fire')
            rows.nth(0).locator('[data-key="baseAmount"]').fill('120')
            rows.nth(0).locator('[data-key="scalingStat"]').select_option('spellPower')
            rows.nth(0).locator('[data-key="coefficient"]').fill('0.65')
            rows.nth(0).locator('[data-key="canCrit"]').check()
            page.locator('[data-add]').click()
            rows.nth(1).locator('[data-key="type"]').select_option('healing')
            expect(rows.nth(1).locator('[data-key="school"]')).to_have_count(0)
            expect(rows.nth(1)).to_contain_text('Can critically heal')
            rows.nth(1).locator('[data-key="trigger"]').select_option('onCast')
            rows.nth(1).locator('[data-key="baseAmount"]').fill('80')
            page.locator('summary').filter(has_text='Combat presentation').click()
            page.locator('[data-presentation="preset"]').select_option('fire')
            page.locator('[data-presentation="channelDuration"]').fill('2.5')
            expect(page.locator('[data-presentation="projectile"]')).to_have_value('straight')
            page.locator('#submitModal').click();expect(page.locator('#modal')).not_to_be_visible()
            page.locator('#save').click();expect(page.locator('#saveState')).to_have_text('Saved to account')
            ability=ctx.request.get(base+'/api/projects/'+pid).json()['document']['abilities'][0]
            assert ability['requirements']=='Keep me' and ability['resourceCosts']==[]
            assert len(ability['combatEffects'])==2
            assert ability['presentation']['channelDuration']==2.5
            assert ability['presentation']['impact']=='fire'
            damage,heal=ability['combatEffects']
            assert damage['school']=='fire' and damage['baseAmount']==120 and damage['coefficient']==0.65 and damage['canCrit'] is True
            assert heal['type']=='healing' and heal['trigger']=='onCast' and 'school' not in heal
            page.locator('[data-ability="fireball"]').click()
            assert rows.nth(0).locator('[data-key="baseAmount"]').input_value()=='120'
            page.locator('[data-add]').click();rows.nth(2).locator('[data-remove]').click();expect(rows).to_have_count(2)
            page.evaluate("async()=>{const {setLanguage}=await import('/i18n.js');setLanguage('ru');}")
            expect(page.locator('.combat-effects h3')).to_have_text('БОЕВЫЕ ЭФФЕКТЫ')
            expect(rows.nth(1)).to_contain_text('Может критически исцелить')
            for width in [1366,768,390]:
                page.set_viewport_size({'width':width,'height':900})
                assert page.locator('#modalBody').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
            page.locator('#submitModal').click();page.locator('#save').click()
            with page.expect_download() as download:page.locator('#export').click()
            exported=json.loads(Path(download.value.path()).read_text())
            assert exported['abilities'][0]['combatEffects']==ability['combatEffects']
            assert exported['abilities'][0]['presentation']==ability['presentation']
            assert not errors,errors
            browser.close()
    finally:
        stop_server(http)
print('Combat editor: EN/RU, add/edit/delete, conditional fields, widths, save/load and export passed')
