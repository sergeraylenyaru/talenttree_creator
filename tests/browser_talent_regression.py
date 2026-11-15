"""Regular talent saves must not access the ability-only combat effect editor."""
import os
from pathlib import Path
import sys
import tempfile
import threading
from unittest.mock import patch
from playwright.sync_api import sync_playwright, expect

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {
        'SMTP_HOST':'', 'SMTP_FROM':'', 'APP_URL':'', 'REQUIRE_EMAIL_VERIFICATION':'0'}):
    server.DB = str(Path(tmp) / 'talent-regression.sqlite')
    server.initialize()
    http = server.ArchiveHTTPServer(('127.0.0.1', 0), server.Handler)
    threading.Thread(target=http.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{http.server_port}'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
            ctx = browser.new_context(viewport={'width':1366, 'height':1000})
            ctx.route('https://**/*', lambda route: route.abort())
            response = ctx.request.post(base+'/api/register', data={
                'login':'talent-regression', 'email':'talent-regression@example.test', 'password':'test-password-123'})
            assert response.ok, response.text()
            parent = {'id':'parent', 'name':'Parent talent', 'icon':'inv_misc_book_09',
                      'row':0, 'col':0, 'maxRank':1, 'descriptions':['Parent description'], 'requires':''}
            document = {'version':1, 'name':'Talent regression', 'budget':41, 'rowCost':5, 'build':{},
                        'branches':[{'id':'one', 'name':'Tree', 'rows':5, 'talents':[parent]}], 'abilities':[]}
            response = ctx.request.post(base+'/api/projects', data={'document':document})
            assert response.ok, response.text()
            pid = response.json()['id']
            page = ctx.new_page()
            # pageerror records uncaught JavaScript exceptions, including ReferenceError.
            # Network diagnostics for blocked external icons are not script exceptions.
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(base)
            expect(page.locator('#user')).to_have_text('talent-regression')
            page.locator('#projects').click()
            page.locator(f'[data-open="{pid}"]').click()
            expect(page.locator('[data-talent="parent"]')).to_be_visible()

            def submit():
                page.locator('#submitModal').click()
                expect(page.locator('#formError')).to_be_empty()
                expect(page.locator('#modal')).not_to_be_visible()

            def saved_document():
                page.locator('#save').click()
                expect(page.locator('#saveState')).to_have_text('Saved to account')
                response = ctx.request.get(base+'/api/projects/'+pid)
                assert response.ok, response.text()
                return response.json()['document']

            # Create a regular two-rank talent with a dependency through the real modal.
            page.locator('[data-row="1"][data-col="0"]').click()
            page.locator('#talentName').fill('New regular talent')
            page.locator('#maxRank').fill('2')
            page.locator('[data-mode="separate"]').click()
            page.locator('#rank0').fill('First rank description')
            page.locator('#editRankIndex').select_option('1')
            page.locator('#rank1').fill('Second rank description')
            page.locator('#requires').select_option('parent')
            submit()
            saved = saved_document()
            talent = next(t for t in saved['branches'][0]['talents'] if t['id']!='parent')
            tid = talent['id']
            assert talent['name']=='New regular talent'
            assert talent['descriptions']==['First rank description', 'Second rank description']
            assert talent['requires']=='parent' and 'combatEffects' not in talent

            # Edit, persist and reopen; untouched ranks and dependencies must survive.
            page.locator(f'[data-talent="{tid}"]').click()
            expect(page.locator('#requires')).to_have_value('parent')
            expect(page.locator('#rank0')).to_have_value('First rank description')
            page.locator('#talentName').fill('Edited regular talent')
            page.locator('#editRankIndex').select_option('1')
            expect(page.locator('#rank1')).to_have_value('Second rank description')
            page.locator('#rank1').fill('Edited second rank')
            submit()
            saved = saved_document()
            talent = next(t for t in saved['branches'][0]['talents'] if t['id']==tid)
            assert talent['name']=='Edited regular talent'
            assert talent['descriptions']==['First rank description', 'Edited second rank']
            assert talent['requires']=='parent' and 'combatEffects' not in talent
            assert next(t for t in saved['branches'][0]['talents'] if t['id']=='parent')==parent
            page.locator(f'[data-talent="{tid}"]').click()
            expect(page.locator('#talentName')).to_have_value(talent['name'])
            expect(page.locator('#requires')).to_have_value('parent')
            page.locator('#editRankIndex').select_option('1')
            expect(page.locator('#rank1')).to_have_value('Edited second rank')
            page.locator('#closeModal').click()

            # Create an ability with two effects and then place it as an ability talent.
            page.locator('#addAbility').click()
            page.locator('#abilityName').fill('Combat ability')
            page.locator('#abilityDescription').fill('Ability description')
            page.locator('#abilityBranch').select_option('one')
            page.locator('[data-add]').click()
            rows = page.locator('[data-combat-row]')
            rows.nth(0).locator('[data-key="baseAmount"]').fill('120')
            rows.nth(0).locator('[data-key="school"]').select_option('fire')
            page.locator('[data-add]').click()
            rows.nth(1).locator('[data-key="type"]').select_option('healing')
            rows.nth(1).locator('[data-key="baseAmount"]').fill('80')
            submit()
            ability = saved_document()['abilities'][0]
            aid, effects = ability['id'], ability['combatEffects']
            assert len(effects)==2 and [e['type'] for e in effects]==['damage','healing']
            page.locator('[data-row="0"][data-col="3"]').click()
            page.locator('#pickAbility').click()
            page.locator(f'[data-pick-ability="{aid}"]').click()
            submit()
            saved = saved_document()
            linked = next(t for t in saved['branches'][0]['talents'] if t.get('grantedAbilityId')==aid)
            assert linked['name']==ability['name'] and linked['descriptions']==[ability['description']]
            assert saved['abilities'][0]['combatEffects']==effects

            # Edit an existing ability; synchronization must update its talent without dropping effects.
            page.locator(f'[data-ability="{aid}"]').click()
            expect(rows).to_have_count(2)
            page.locator('#abilityName').fill('Edited combat ability')
            page.locator('#abilityDescription').fill('Edited ability description')
            rows.nth(0).locator('[data-key="baseAmount"]').fill('150')
            submit()
            effects[0]['baseAmount'] = 150
            saved = saved_document()
            assert saved['abilities'][0]['combatEffects']==effects
            linked = next(t for t in saved['branches'][0]['talents'] if t.get('grantedAbilityId')==aid)
            assert linked['name']=='Edited combat ability' and linked['descriptions']==['Edited ability description']
            assert 'combatEffects' not in linked
            # Reopen from the server, rather than relying only on the in-memory editor.
            page.reload()
            page.locator('#projects').click()
            page.locator(f'[data-open="{pid}"]').click()
            expect(page.locator('[data-talent="parent"]')).to_be_visible()
            page.locator(f'[data-ability="{aid}"]').click()
            expect(rows).to_have_count(2)
            expect(rows.nth(0).locator('[data-key="baseAmount"]')).to_have_value('150')
            expect(rows.nth(1).locator('[data-key="baseAmount"]')).to_have_value('80')
            assert not errors, errors
            browser.close()
    finally:
        http.shutdown()
        http.server_close()
print('PASS: regular talent create/edit/save, ranks/dependencies, ability create/edit, multiple effects, synchronization, no browser errors')
