"""Validate the RPG workflow with real local WoW models and WebGL2."""
import json
import os
from pathlib import Path
import sys

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server
from rpg_fixture import document
from server_lifecycle import start_server, stop_server, temporary_database

expect.set_options(timeout=25000)


def exercise(page, context, url, shots):
    errors, assets = [], set()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('response', lambda response: assets.add(response.url.split('/local-world-assets/')[-1])
            if '/local-world-assets/' in response.url and response.status == 200 else None)
    page.route('https://**/*', lambda route: route.abort())
    doc = document()
    manifest = json.loads((ROOT / 'local-assets/wow/manifest.json').read_text())
    manifest['playerSpawn'] = {'x': -25, 'z': -20}
    manifest['target']['position'] = {'x': -25, 'z': -26}
    page.route('**/local-world-assets/manifest.json', lambda route: route.fulfill(json=manifest))
    page.add_init_script("localStorage.setItem('talentforge-language','en')")
    assert context.request.post(url+'/api/register', data={
        'login':'rpg-test', 'email':'rpg-test@example.test', 'password':'test-password-123'}).ok
    response = context.request.post(url+'/api/projects', data={'document':doc})
    assert response.ok, response.text()
    pid = response.json()['id']
    page.add_init_script("localStorage.setItem(" + json.dumps('talentforge-build:project:'+pid) +
                         ", '{\"fire-talent\":1}')")
    page.goto(url)
    page.locator('#projects').click()
    page.locator(f'[data-open="{pid}"]').click()
    page.locator('#characterLab').click()
    lab = page.locator('.rpg-lab')
    lab.get_by_role('button', name='Statistics', exact=True).click()
    expect(lab.get_by_text('44', exact=True).first).to_be_visible()
    page.screenshot(path=shots/'01-character-statistics.png', animations='disabled')
    lab.get_by_role('button', name='Equipment', exact=True).click()
    lab.get_by_role('button', name='Create item', exact=True).click()
    lab.get_by_label('Item name', exact=True).fill('Honed Test Blade')
    lab.get_by_label('Minimum weapon damage').fill('180')
    lab.get_by_label('Maximum weapon damage').fill('180')
    lab.get_by_label('Weapon speed, seconds').fill('1.2')
    lab.get_by_text('Item stat bonuses', exact=True).click()
    lab.get_by_label('Crit Chance', exact=True).fill('0.75')
    lab.get_by_text('Item stat bonuses', exact=True).click()
    lab.get_by_role('button', name='Equip selected item').click()
    lab.get_by_role('button', name='Duplicate item').click()
    expect(lab.get_by_label('Item name')).to_have_value('Honed Test Blade (copy)')
    with page.expect_download() as item:
        lab.get_by_role('button', name='Export item').click()
    assert json.loads(Path(item.value.path()).read_text())['item']['minDamage'] == 180
    page.locator('#modalBody').evaluate('(body) => body.scrollTop = 0')
    page.screenshot(path=shots/'02-equipment-editor.png', animations='disabled')
    lab.get_by_role('button', name='Combat Analytics', exact=True).click()
    lab.get_by_label('Build name').fill('Honed baseline')
    lab.get_by_role('button', name='Save current build').click()
    expect(lab.get_by_text('Honed baseline', exact=True)).to_be_visible()
    page.locator('#submitModal').click()
    page.locator('#save').click()
    expect(page.locator('#saveState')).to_have_text('Saved to account')
    saved = context.request.get(url+f'/api/projects/{pid}').json()['document']['rpg']
    assert saved['equipped']['mainHand'] == saved['items'][0]['id']
    assert saved['builds'][0]['equipped'] == saved['equipped']
    page.reload()
    page.locator('#projects').click()
    page.locator(f'[data-open="{pid}"]').click()
    page.clock.install(time=0)
    page.clock.pause_at(60000)
    page.locator('#openTrainingGrounds').click()
    arena = page.locator('#trainingGrounds')
    expect(arena.locator('[data-role=scene]')).to_have_text('Scene · Ready', timeout=140000)
    page.clock.run_for(100)
    canvas = arena.locator('.tg-world-frame canvas')
    snapshot = "async el => (await import('/world/generated/world.js')).worldSnapshot(el)"
    assert canvas.evaluate("el => !!el.getContext('webgl2')")
    assert {'character/hero.glb', 'targets/Training-dummy.glb', 'weapons/sword-one-hand.glb',
            'world/guildhouseb.glb'} <= assets, assets
    start = canvas.evaluate(snapshot)
    assert start['weaponGripError'] < 1e-8
    marker = arena.locator('.tg-world-target')
    marker.click()
    page.keyboard.press('2')
    expect(arena.locator('.tg-buffs')).to_contain_text('6')
    arena.locator('.tg-test-incoming').click()
    expect(arena.locator('[data-event=absorbed]')).to_have_count(2)
    page.clock.run_for(1600)
    page.keyboard.press('1')
    expect(arena.locator('[data-event=projectileLaunched]')).to_have_count(1)
    page.clock.fast_forward(1150)
    expect(arena.locator('[data-event=projectileHit]')).to_have_count(1)
    expect(arena.locator('[data-event=procTriggered]').first).to_be_attached()
    expect(arena.locator('.tg-world-combat-text [data-school=fire]:visible img').first).to_have_attribute('src','/art/spells/ember.png')
    expect(arena.locator('.tg-debuffs [title*="Exposed"]')).to_be_visible()
    page.screenshot(path=shots/'03-real-combat-effects.png', animations='disabled')
    page.keyboard.down('w')
    page.clock.run_for(800)
    moving = canvas.evaluate(snapshot)
    page.keyboard.up('w')
    assert moving['player']['z'] < start['player']['z'] and moving['weaponGripError'] < 1e-8, moving
    marker.click(button='right')
    expect(arena.locator('[data-event=autoHit]').first).to_be_attached()
    page.clock.run_for(1280)
    expect(arena.locator('[data-event=autoHit]').nth(1)).to_be_attached()
    arena.locator('.tg-basic-strike').click()
    page.clock.fast_forward(1100)
    expect(arena.locator('[data-event=healing]').first).to_be_attached()
    arena.locator('.tg-rpg-review').click()
    review = page.locator('.rpg-review')
    expect(review.get_by_text('Session metrics')).to_be_visible()
    page.clock.run_for(250)
    review.get_by_role('button', name='Stop session').click()
    expect(review.get_by_role('button', name='Resume session')).to_be_visible()
    page.screenshot(path=shots/'04-combat-analytics.png', animations='disabled')
    review.get_by_role('button', name='Effects', exact=True).click()
    expect(review.get_by_text('Kindling Surge', exact=True)).to_be_visible()
    page.screenshot(path=shots/'06-effect-analytics.png', animations='disabled')
    review.get_by_role('button', name='Character', exact=True).click()
    expect(review.get_by_text('Honed Test Blade', exact=True)).to_be_visible()
    expect(review.get_by_alt_text('Hero')).to_be_visible()
    page.screenshot(path=shots/'05-live-hero-equipment.png', animations='disabled')
    with page.expect_download() as report:
        review.get_by_role('button', name='Export JSON').click()
    data = json.loads(Path(report.value.path()).read_text())
    assert data['metrics']['auto'] >= 720 and data['metrics']['periodic'] > 0, data['metrics']
    assert data['metrics']['absorbed'] > 100 and data['metrics']['healing'] > 0
    assert data['build']['equipment']['mainHand']['speed'] == 1.2
    assert data['effects'] and data['procs'] and data['seed'] == 13
    with page.expect_download() as csv:
        review.get_by_role('button', name='Export CSV').click()
    assert 'procTriggered' in Path(csv.value.path()).read_text()
    review.get_by_role('button', name='Save measurement').click()
    expect(review.get_by_text('Measurement saved.')).to_be_visible()
    review.get_by_role('button', name='Resume session').click()
    page.clock.run_for(300)
    review.get_by_role('button', name='Close', exact=True).click()
    arena.locator('.tg-target-reset').click()
    expect(arena.locator('.tg-unit-target .tg-unit-bar')).to_contain_text('1000000')
    arena.locator('.tg-rpg-review').click()
    with page.expect_download() as preserved:
        review.get_by_role('button', name='Export JSON').click()
    fresh = json.loads(Path(preserved.value.path()).read_text())
    assert fresh['metrics']['damage'] == data['metrics']['damage']
    review.get_by_role('button', name='Save measurement').click()
    review.get_by_role('button', name='Compare', exact=True).click()
    expect(review.get_by_text('Different duration, seed or dummy settings. Compare with care.')).to_be_visible()
    review.get_by_role('button', name='New session').click()
    review.get_by_role('button', name='Summary', exact=True).click()
    expect(review.get_by_text('0 s', exact=True)).to_be_visible()
    assert not errors, errors
    print('Verified four real GLBs in WebGL2, paid ranged impact, HUD and shield absorption, weapon swings, saved build and combat exports.')


if __name__ == '__main__':
    shots = Path(sys.argv[1])
    shots.mkdir(parents=True, exist_ok=True)
    os.environ['TALENT_LOCAL_WOW_ASSETS'] = '1'
    with temporary_database() as folder, sync_playwright() as pw:
        server.DB = str(Path(folder) / 'rpg.sqlite')
        server.initialize()
        http = server.ArchiveHTTPServer(('127.0.0.1', 0), server.Handler)
        start_server(http)
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium', args=[
            '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        try:
            context = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
            exercise(context.new_page(), context, f'http://127.0.0.1:{http.server_port}', shots)
        finally:
            browser.close()
            stop_server(http)
