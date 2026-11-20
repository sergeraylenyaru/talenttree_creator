"""Verify starter templates and an unsaved arced spell preview on the real arena."""
import json
import os
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server
from server_lifecycle import start_server, stop_server, temporary_database

expect.set_options(timeout=25000)


def exercise(page, context, url, shots):
    errors, assets = [], set()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('response', lambda response: assets.add(response.url.split('/local-world-assets/')[-1])
            if '/local-world-assets/' in response.url and response.status == 200 else None)
    page.route('https://**/*', lambda route: route.abort())
    manifest = json.loads((ROOT/'local-assets/wow/manifest.json').read_text())
    manifest['playerSpawn'] = {'x': -25, 'z': -20}
    manifest['target']['position'] = {'x': -25, 'z': -26}
    page.route('**/local-world-assets/manifest.json', lambda route: route.fulfill(json=manifest))
    assert context.request.post(url+'/api/register', data={
        'login':'class-library','email':'class-library@example.test','password':'test-password-123'}).ok
    fixture = json.loads((ROOT/'tests/fixtures/training-grounds.json').read_text())
    fixture['abilities'] = []
    fixture['build'] = {}
    for branch in fixture['branches']:
        for talent in branch['talents']:
            talent.pop('grantedAbilityId', None)
    response = context.request.post(url+'/api/projects', data={'document':fixture})
    assert response.ok, response.text()
    pid = response.json()['id']
    page.add_init_script("""localStorage.setItem('talentforge-language','en');
      localStorage.setItem('talentforge-training-grounds-v1',JSON.stringify({stats:{critChance:0}}));""")
    page.goto(url)
    page.locator('#projects').click()
    page.locator(f'[data-open="{pid}"]').click()
    page.locator('#spellLibrary').click()
    for _ in range(2):
        page.locator('#libraryClassTemplates').click()
        page.locator('#templateClass').select_option('mage')
        expect(page.locator('[data-class-template]')).to_have_count(8)
        page.locator('#addClassLibrary').click()
        expect(page.locator('[data-spell-id]')).to_have_count(8)
    page.locator('#spellOrigin').select_option('template')
    page.locator('#spellClass').select_option('mage')
    page.locator('#spellSchool').select_option('frost')
    expect(page.locator('[data-spell-id]')).to_have_count(4)
    page.screenshot(path=shots/'01-class-library.png', animations='disabled')
    page.locator('[data-spell-id="tf-class-mage-strike"] [data-spell-action=edit]').click()
    page.locator('#cast').fill('0.6')
    page.locator('summary').filter(has_text='Combat presentation').click()
    page.locator('[data-presentation=trajectory]').select_option('arc')
    page.locator('[data-presentation=arcHeight]').fill('0.8')
    page.locator('[data-presentation=projectileOrigin]').select_option('hand')
    page.locator('[data-presentation=projectilePreset]').select_option('frostbolt')
    page.locator('[data-presentation=effectPreset]').select_option('frostImpact')
    page.locator('[data-presentation=startAnimation]').select_option('guard')
    page.locator('[data-presentation=finishAnimation]').select_option('cast')
    impact = page.locator('[data-presentation=impactAnimation]')
    expect(impact.locator('optgroup[label=GLB]')).to_be_attached()
    clip = impact.locator('option').filter(has_text='CombatWound').first.get_attribute('value')
    impact.select_option(clip)
    page.locator('#modalBody').evaluate('(body) => body.scrollTop=body.scrollHeight')
    page.screenshot(path=shots/'02-spell-visuals-editor.png', animations='disabled')
    original = page.evaluate("localStorage.getItem('talentforge-draft')")
    page.clock.install(time=0)
    page.clock.pause_at(60000)
    page.locator('#previewSpell').click()
    arena = page.locator('#trainingGrounds')
    expect(arena.locator('[data-role=scene]')).to_have_text('Scene · Ready', timeout=140000)
    page.clock.run_for(100)
    canvas = arena.locator('canvas')
    assert canvas.evaluate("el => Boolean(el.getContext('webgl2'))")
    assert {'character/hero.glb','targets/Training-dummy.glb','weapons/sword-one-hand.glb','world/guildhouseb.glb'} <= assets
    page.get_by_role('button', name='Play preview').click()
    page.clock.run_for(150)
    expect(arena.locator('#tg-cast')).to_be_visible()
    page.screenshot(path=shots/'03-arc-preview.png', animations='disabled')
    page.clock.run_for(560)
    expect(arena.locator('[data-event=projectileLaunched]')).to_have_count(1)
    expect(arena.locator('[data-event=damage]')).to_have_count(0)
    page.clock.run_for(200)
    expect(arena.locator('[data-event=damage]')).to_have_count(0)
    page.screenshot(path=shots/'05-glacial-flight.png', animations='disabled')
    page.clock.run_for(500)
    expect(arena.locator('[data-event=projectileHit]')).to_have_count(1)
    expect(arena.locator('[data-event=damage]')).to_contain_text('Glacial Lance')
    arena.locator('.tg-world-meter').click()
    expect(arena.locator('.tg-meter-player')).to_contain_text('45')
    expect(arena.locator('.tg-unit-target .tg-unit-bar')).to_contain_text('999955')
    page.screenshot(path=shots/'04-glacial-impact.png', animations='disabled')
    assert page.evaluate("localStorage.getItem('talentforge-draft')") == original
    page.locator('#tg-return').click()
    page.locator('#submitModal').click()
    page.locator('#save').click()
    expect(page.locator('#saveState')).to_have_text('Saved to account')
    saved = context.request.get(url+f'/api/projects/{pid}').json()['document']
    assert len(saved['abilities']) == 8
    strike = next(row for row in saved['abilities'] if row['id']=='tf-class-mage-strike')
    assert strike['presentation']['arcHeight'] == .8
    assert strike['presentation']['impactAnimation'] == clip
    assert not errors, errors
    print('Class template import is idempotent; filters, real GLB clip catalog, arced cast and impact, preview isolation and saved visual configuration passed.')


if __name__ == '__main__':
    shots = Path(sys.argv[1])
    shots.mkdir(parents=True,exist_ok=True)
    os.environ['TALENT_LOCAL_WOW_ASSETS']='1'
    with temporary_database() as folder, sync_playwright() as pw:
        server.DB = str(Path(folder) / 'class-library.sqlite3')
        server.initialize()
        http = server.ArchiveHTTPServer(('127.0.0.1',0), server.Handler)
        start_server(http)
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium',args=[
            '--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        try:
            context = browser.new_context(viewport={'width':1440,'height':900})
            exercise(context.new_page(),context,f'http://127.0.0.1:{http.server_port}',shots)
        finally:
            browser.close()
            stop_server(http)
