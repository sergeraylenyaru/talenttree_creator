"""Build and preview a spell, then run the saved ability in the real GLB arena."""
import json
import os
from pathlib import Path
import sys
from unittest.mock import patch

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server
from server_lifecycle import start_server, stop_server, temporary_database

expect.set_options(timeout=30000)


def exercise(page, context, base, shots):
    fixture = json.loads((ROOT / 'tests/fixtures/training-grounds.json').read_text())
    fixture['abilities'] = []
    fixture['build'] = {}
    for branch in fixture['branches']:
        for talent in branch['talents']:
            talent.pop('grantedAbilityId', None)
    response = context.request.post(base + '/api/register',
        data={'login':'spell-author','email':'spell-author@example.test','password':'test-password-123'})
    assert response.ok, response.text()
    response = context.request.post(base + '/api/projects', data={'document': fixture})
    assert response.ok, response.text()
    pid = response.json()['id']
    errors, assets = [], set()
    page.on('pageerror', lambda error: errors.append(error.stack))
    page.on('response', lambda res: assets.add(res.url.split('/local-world-assets/')[-1])
            if '/local-world-assets/' in res.url and res.status == 200 else None)
    page.add_init_script("""localStorage.setItem('talentforge-language','en');
      localStorage.setItem('talentforge-training-grounds-v1',JSON.stringify({stats:{critChance:1}}));""")
    page.goto(base)
    page.locator('#projects').click()
    page.locator(f'[data-open="{pid}"]').click()
    page.locator('#spellLibrary').click()
    page.locator('#libraryCreate').click()
    page.get_by_text('Ability templates',exact=True).click()
    page.locator('#workshopTemplate').select_option(label='Fireball')
    page.locator('#applySpellTemplate').click()
    page.locator('#abilityName').fill('Ember of Renewal')
    page.locator('#abilityDescription').fill('A flare of fire and a brief healing pulse.')
    page.locator('#toggleIconPicker').click()
    page.locator('#iconCategory').select_option('category:workshop')
    page.locator('#iconSearch').fill('fire')
    page.locator('[data-icon="forge-ember"]').click()
    expect(page.locator('#iconPreview')).to_have_attribute('src','/art/spells/ember.png')
    page.locator('[data-add]').click()
    effects = page.locator('[data-combat-row]')
    effects.nth(1).locator('[data-key=type]').select_option('healing')
    effects.nth(1).get_by_text('Modifiers',exact=True).click()
    effects.nth(1).locator('[data-key=trigger]').select_option('onCast')
    effects.nth(1).locator('[data-key=baseAmount]').fill('32')
    effects.nth(1).locator('[data-periodic]').check()
    page.locator('summary').filter(has_text='Combat presentation').click()
    casting = page.locator('[data-presentation=castingAnimation]')
    expect(casting.locator('optgroup[label=GLB]')).to_be_attached(timeout=120000)
    casting.select_option('clip:SpellCastDirected (ID 53 variation 0)')
    page.locator('summary').filter(has_text='Advanced settings').click()
    page.locator('summary').filter(has_text='Animation and effects').click()
    page.locator('[data-workshop=casterEffect]').select_option('fire')
    page.locator('[data-workshop=effectScale]').fill('1.2')
    page.locator('summary').filter(has_text='Advanced settings').click()
    page.locator('#modalBody').evaluate('(body) => body.scrollTop = 0')
    page.screenshot(path=shots/'01-spell-workshop.png')
    saved = page.evaluate("JSON.parse(localStorage.getItem('talentforge-draft')).abilities")
    assert saved == []
    page.locator('#previewSpell').click()
    arena = page.locator('#trainingGrounds')
    expect(arena.locator('[data-role=scene]')).to_have_text('Scene · Ready',timeout=140000)
    canvas = arena.locator('canvas')
    assert canvas.evaluate("el => Boolean(el.getContext('webgl2'))")
    required = {'character/hero.glb','targets/Training-dummy.glb','weapons/sword-one-hand.glb','world/guildhouseb.glb'}
    assert required <= assets, assets
    assert canvas.evaluate("""async el => {
      const {worldSnapshot}=await import('/world/generated/world.js');
      return worldSnapshot(el).weaponGripError<1e-8;
    }""")
    page.get_by_role('button',name='Play preview').click()
    expect(arena.locator('#tg-cast')).to_be_visible()
    page.screenshot(path=shots/'02-live-preview.png')
    expect(arena.locator('[data-event=projectileHit]')).to_have_count(1)
    expect(arena.locator('[data-event=damage]')).to_contain_text('Ember of Renewal')
    expect(arena.locator('[data-event=healing]').first).to_contain_text('Ember of Renewal')
    page.get_by_role('button',name='Stop preview').click()
    assert page.evaluate("JSON.parse(localStorage.getItem('talentforge-draft')).abilities") == saved
    page.locator('#tg-return').click()
    page.locator('#submitModal').click()
    row = page.locator('[data-spell-id]').filter(has_text='Ember of Renewal')
    expect(row).to_have_count(1)
    page.locator('#spellSearch').fill('not present')
    expect(row).to_have_count(0)
    page.locator('#spellSearch').fill('ember')
    expect(row).to_have_count(1)
    with page.expect_download() as downloaded:
        row.locator('[data-spell-action=export]').click()
    payload = json.loads(Path(downloaded.value.path()).read_text())
    spell = payload['ability']
    assert spell['presentation']['castingAnimation'].startswith('clip:')
    assert spell['combatEffects'][1]['interval'] == 2
    row.locator('[data-spell-action=duplicate]').click()
    page.locator('#submitModal').click()
    expect(page.locator('[data-spell-id]')).to_have_count(2)
    copy = page.locator('[data-spell-id]').filter(has_text='copy')
    copy.locator('[data-spell-action=rename]').click()
    page.locator('#newSpellName').fill('Spare spell')
    page.locator('#submitModal').click()
    page.once('dialog',lambda dialog:dialog.accept())
    page.locator('[data-spell-id]').filter(has_text='Spare spell').locator('[data-spell-action=delete]').click()
    expect(page.locator('[data-spell-id]')).to_have_count(1)
    page.locator('#libraryFile').set_input_files({'name':'spell.json','mimeType':'application/json',
        'buffer':json.dumps(payload).encode()})
    expect(page.locator('#abilityLearning')).to_have_value('talent')
    page.locator('#closeModal').click()
    expect(row).to_have_count(1)
    page.locator('#closeModal').click()
    page.locator('#save').click()
    expect(page.locator('#saveState')).to_have_text('Saved to account')
    document = context.request.get(base+f'/api/projects/{pid}').json()['document']
    assert document['abilities'][0]['combatEffects'] == spell['combatEffects']
    page.locator('#openTrainingGrounds').click()
    expect(arena.locator('[data-role=scene]')).to_have_text('Scene · Ready',timeout=140000)
    arena.locator('.tg-world-target').click()
    arena.locator('.tg-world-actions summary').click()
    palette = arena.locator('[data-drag-ability]').filter(has_text='Ember of Renewal')
    slot = arena.locator('[data-world-slot="11"]')
    transfer = page.evaluate_handle('new DataTransfer()')
    palette.dispatch_event('dragstart',{'dataTransfer':transfer})
    slot.dispatch_event('drop',{'dataTransfer':transfer})
    expect(slot).to_have_attribute('data-world-ability',spell['id'])
    arena.locator('.tg-world-actions summary').click()
    arena.locator('.tg-world-meter').click()
    page.keyboard.press('Shift+2')
    expect(arena.locator('[data-event=projectileHit]')).to_have_count(1)
    expect(arena.locator('.tg-meter-player')).to_contain_text('300')
    expect(arena.locator('.tg-buffs .tg-status-effect')).to_have_count(1)
    expect(arena.locator('.tg-world-combat-text [data-school=fire]:visible')).to_contain_text('300')
    page.screenshot(path=shots/'03-saved-spell-combat.png')
    page.locator('#tg-return').click()
    page.locator('#openTrainingGrounds').click()
    expect(arena.locator('[data-world-slot="11"]')).to_have_attribute('data-world-ability',spell['id'])
    arena.locator('.tg-world-actions summary').click()
    arena.locator('.tg-slot-settings select').nth(10).select_option('')
    expect(arena.locator('[data-world-slot="11"]')).to_have_attribute('data-world-ability','')
    assert not errors,errors


if __name__ == '__main__':
    shots = Path(sys.argv[1])
    shots.mkdir(parents=True,exist_ok=True)
    with temporary_database() as folder, patch.dict(os.environ, {'TALENT_LOCAL_WOW_ASSETS':'1','REQUIRE_EMAIL_VERIFICATION':'0'}), sync_playwright() as pw:
        server.DB = str(Path(folder)/'workshop.sqlite')
        server.initialize()
        http = server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler)
        start_server(http)
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium',args=[
            '--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        try:
            context = browser.new_context(viewport={'width':1280,'height':850},accept_downloads=True)
            context.route('https://**/*',lambda route:route.abort())
            exercise(context.new_page(),context,f'http://127.0.0.1:{http.server_port}',shots)
        finally:
            browser.close()
            stop_server(http)
    print('Workshop library, persistence, isolated preview, real GLBs, WebGL2, combat and action bar passed')
