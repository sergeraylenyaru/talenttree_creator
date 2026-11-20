"""Create, learn, bind and execute a spell using the real local arena."""
import json
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server
from server_lifecycle import start_server, stop_server, temporary_database

expect.set_options(timeout=25000)


def exercise(page, context, url, shots):
    assets, errors = set(), []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('response', lambda response: assets.add(response.url.split('/local-world-assets/')[-1])
            if '/local-world-assets/' in response.url and response.status == 200 else None)
    page.route('https://**/*', lambda route: route.abort())
    fixture = json.loads((ROOT/'tests/fixtures/training-grounds.json').read_text())
    fixture['abilities'] = []
    fixture['build'] = {}
    for branch in fixture['branches']:
        for node in branch['talents']:
            node.pop('grantedAbilityId', None)
    manifest = json.loads((ROOT/'local-assets/wow/manifest.json').read_text())
    manifest['playerSpawn'] = {'x':-25,'z':-20}
    manifest['target']['position'] = {'x':-25,'z':-26}
    page.route('**/local-world-assets/manifest.json', lambda route: route.fulfill(json=manifest))
    assert context.request.post(url+'/api/register',data={
        'login':'linked-test','email':'linked-test@example.test','password':'test-password-123'}).ok
    response = context.request.post(url+'/api/projects',data={'document':fixture})
    assert response.ok, response.text()
    pid = response.json()['id']
    page.add_init_script("localStorage.setItem('talentforge-language','en');")
    page.goto(url)
    page.locator('#projects').click()
    page.locator(f'[data-open="{pid}"]').click()
    node = page.locator('[data-talent="fire-talent"]')
    node.click()
    page.locator('#pickAbility').click()
    page.locator('#newPickerAbility').click()
    page.get_by_text('Ability templates',exact=True).click()
    page.locator('#workshopTemplate').select_option(label='Fireball')
    page.locator('#applySpellTemplate').click()
    page.locator('#abilityName').fill('Lantern Bolt')
    if not page.locator('[data-cost-type]').count():
        page.locator('#addResourceCost').click()
    page.locator('[data-cost-type]').select_option('mana')
    page.locator('[data-cost-amount]').fill('20')
    page.locator('[data-cost-unit]').select_option('points')
    page.locator('#submitModal').click()
    expect(node).to_have_attribute('aria-label', re.compile('Lantern Bolt'))
    node.click()
    expect(page.locator('.spell-readiness')).to_contain_text('Locked by current build')
    page.locator('#editLinkedAbility').click()
    expect(page.locator('#abilityName')).to_have_value('Lantern Bolt')
    expect(page.locator('[data-combat-row]')).to_have_count(1)
    expect(page.locator('[data-cost-amount]')).to_have_value('20')
    page.screenshot(path=shots/'01-linked-spell-editor.png',animations='disabled')
    page.locator('#submitModal').click()
    page.locator('#save').click()
    expect(page.locator('#saveState')).to_have_text('Saved to account')
    saved = context.request.get(url+f'/api/projects/{pid}').json()['document']
    spell = saved['abilities'][0]
    assert len(saved['abilities']) == 1
    assert saved['branches'][0]['talents'][0]['grantedAbilityId'] == spell['id']
    assert spell['combatEffects'][0]['school'] == 'fire'
    page.evaluate("""key => {
      const storage='talentforge-action-slots-v2:'+JSON.stringify(key);
      localStorage.setItem(storage,JSON.stringify(['__training_strike','__training_spark','__training_beam',null]));
      localStorage.setItem(storage+':unlocked','[]');
      localStorage.setItem('talentforge-training-grounds-v1',JSON.stringify({stats:{critChance:0}}));
    }""", 'project:'+pid)
    page.locator('#playMode').click()
    node.click()
    expect(node.locator('.rank')).to_have_text('1/1')
    page.clock.install(time=0)
    page.clock.pause_at(60000)
    page.locator('#openTrainingGrounds').click()
    arena = page.locator('#trainingGrounds')
    expect(arena.locator('[data-role=scene]')).to_have_text('Scene · Ready',timeout=140000)
    page.clock.run_for(100)
    canvas = arena.locator('.tg-world-frame canvas')
    assert canvas.evaluate("el => Boolean(el.getContext('webgl2'))")
    assert {'character/hero.glb','targets/Training-dummy.glb','weapons/sword-one-hand.glb',
            'world/guildhouseb.glb'} <= assets, assets
    arena.locator('.tg-world-target').click()
    slot = arena.locator(f'[data-world-ability="{spell["id"]}"]')
    expect(slot).to_have_count(1)
    page.keyboard.press(slot.locator('kbd').inner_text())
    page.clock.run_for(180)
    expect(arena.locator('#tg-cast')).to_be_visible()
    snapshot = "async el => (await import('/world/generated/world.js')).worldSnapshot(el)"
    casting = canvas.evaluate(snapshot)
    assert casting['activeClip'].startswith('SpellCast'),casting
    assert casting['weaponGripError'] < 1e-8
    expect(arena.locator('[data-event=projectileLaunched]')).to_have_count(0)
    page.clock.run_for(1200)
    expect(arena.locator('[data-event=projectileLaunched]')).to_have_count(1)
    page.clock.run_for(650)
    expect(arena.locator('[data-event=projectileHit]')).to_have_count(1)
    expect(arena.locator('[data-event=damage]')).to_contain_text('Lantern Bolt')
    expect(arena.locator('.tg-unit-target .tg-unit-bar')).to_contain_text('999820')
    expect(arena.locator('.tg-unit-resource')).to_contain_text('60')
    arena.locator('.tg-world-meter').click()
    expect(arena.locator('.tg-meter-player')).to_contain_text('180')
    expect(arena.locator('.tg-world-combat-text [data-school=fire]:visible')).to_contain_text('180')
    expect(slot).to_have_attribute('data-state','cooldown')
    page.screenshot(path=shots/'02-talent-spell-impact.png',animations='disabled')
    assert not errors, errors
    print('Stable talent link, new hotbar slot, real GLBs, casting clip, projectile contact, damage, cost, cooldown and combat meter verified.')


if __name__ == '__main__':
    shots = Path(sys.argv[1])
    shots.mkdir(parents=True,exist_ok=True)
    os.environ['TALENT_LOCAL_WOW_ASSETS']='1'
    with temporary_database() as folder, sync_playwright() as pw:
        server.DB = str(Path(folder)/'linked.sqlite3')
        server.initialize()
        http = server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler)
        start_server(http)
        browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),
            args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        try:
            context = browser.new_context(viewport={'width':1440,'height':900})
            exercise(context.new_page(),context,f'http://127.0.0.1:{http.server_port}',shots)
        finally:
            browser.close()
            stop_server(http)
