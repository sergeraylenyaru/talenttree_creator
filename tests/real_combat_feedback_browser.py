"""Exercise combat text, contact and mouse input with the four local GLBs."""
import json
import os
from pathlib import Path
import sys

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server
from server_lifecycle import start_server, temporary_database

expect.set_options(timeout=25000)
seed = json.loads((ROOT / 'tests/fixtures/training-grounds.json').read_text())
bolt = seed['abilities'][0]
bolt.update(name='Mixed bolt', range=15, cast=0, cooldown=0, resourceCosts=[{'resourceId': 'health', 'amount': 100, 'unit': 'points'}],
            presentation={'delivery': 'ranged', 'projectile': 'straight', 'projectileSpeed': 6})
effect = bolt['combatEffects'][0]
bolt['combatEffects'] = [
    {**effect, 'id': 'fire', 'school': 'fire', 'trigger': 'onHit'},
    {**effect, 'id': 'physical', 'school': 'physical', 'trigger': 'onHit'}
]
manifest = json.loads((ROOT / 'local-assets/wow/manifest.json').read_text())
manifest['playerSpawn'] = {'x': -25, 'z': -20}
manifest['target']['position'] = {'x': -25, 'z': -26}


def verify(page, port, shots):
    assets, errors = set(), []
    page.on('response', lambda response: assets.add(response.url.split('/local-world-assets/')[-1])
            if '/local-world-assets/' in response.url and response.status == 200 else None)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('https://**/*', lambda route: route.abort())
    # The environment blocks the external icon host. Fulfill its exact icon URLs
    # with distinctive test art while checking the app chose the configured icon.
    def icon(route):
        sword = route.request.url.endswith('/inv_sword_04.jpg')
        color, symbol = ('#52759b', '⚔') if sword else ('#ab4a29', '✦')
        route.fulfill(content_type='image/svg+xml', body=(
            f'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">'
            f'<rect width="32" height="32" fill="{color}"/>'
            f'<text x="16" y="24" text-anchor="middle" font-size="26" fill="white">{symbol}</text></svg>'))
    page.route('https://wow.zamimg.com/images/wow/icons/**', icon)
    page.route('**/local-world-assets/manifest.json', lambda route: route.fulfill(json=manifest))
    page.add_init_script('''
        localStorage.setItem('talentforge-language', 'en');
        localStorage.setItem('talentforge-draft', JSON.stringify(%s));
        localStorage.setItem('talentforge-training-grounds-v1',
          JSON.stringify({stats: {critChance: 1}, globalCooldown: 1.5}));
    ''' % json.dumps(seed))
    page.clock.install(time=0)
    page.goto(f'http://127.0.0.1:{port}')
    page.clock.pause_at(60000)
    page.locator('#openTrainingGrounds').click()
    arena = page.locator('#trainingGrounds')
    expect(arena.locator('[data-role=scene]')).to_have_text('Scene · Ready', timeout=120000)
    page.clock.run_for(100)
    canvas = arena.locator('.tg-world-frame canvas')
    assert canvas.evaluate("el => Boolean(el.getContext('webgl2'))")
    assert {manifest['model'], manifest['target']['model'], manifest['environment']['model'],
            manifest['weapons']['mainHand']['model']} <= assets
    snapshot = """async canvas => (await import('/world/generated/world.js')).worldSnapshot(canvas)"""
    start = canvas.evaluate(snapshot)
    assert abs(start['dummy'][2] - start['player']['z']) >= 5, start
    marker = arena.locator('.tg-world-target')
    marker.click()
    arena.locator('.tg-world-meter').click(button='right')
    expect(arena.locator('[data-event=autoStarted]')).to_have_count(0)
    arena.locator('.tg-world-meter').click()
    page.keyboard.press('1')
    expect(arena.locator('[data-event=projectileLaunched]')).to_have_count(1)
    expect(arena.locator('[data-event=damage]')).to_have_count(0)
    page.clock.fast_forward(1150)
    expect(arena.locator('[data-event=projectileHit]')).to_have_count(1)
    expect(arena.locator('[data-event=damage]')).to_have_count(2)
    text = arena.locator('.tg-world-combat-text')
    white = text.locator('[data-school=physical]:visible')
    yellow = text.locator('[data-school=fire]:visible')
    expect(white).to_be_visible()
    expect(yellow).to_be_visible()
    expect(white.locator('b')).to_have_css('color', 'rgb(255, 255, 255)')
    expect(yellow.locator('b')).to_have_css('color', 'rgb(255, 219, 77)')
    expect(yellow).to_have_class('tg-text-critical')
    expect(yellow.locator('img')).to_have_js_property('complete', True)
    assert yellow.locator('img').evaluate('img => img.naturalWidth > 0')
    assert yellow.locator('img').get_attribute('src').endswith('/spell_fire_flamebolt.jpg')
    expect(arena.locator('.tg-meter-player')).to_contain_text('400')
    expect(arena.locator('.tg-unit-target .tg-unit-bar')).to_contain_text('999600')
    arena.locator('.tg-world-log').click()
    page.screenshot(path=shots / '01-ranged-impact.png')
    before = yellow.evaluate("el => [el.style.left, el.style.top]")
    bounds = canvas.bounding_box()
    x, y = bounds['width'] * .55, bounds['height'] * .48
    page.mouse.move(x, y)
    page.mouse.down(button='right')
    page.mouse.move(x + 55, y, steps=4)
    page.clock.run_for(160)
    assert yellow.evaluate("el => [el.style.left, el.style.top]") != before
    page.mouse.move(x, y, steps=4)
    page.mouse.up(button='right')
    expect(arena.locator('[data-event=autoStarted]')).to_have_count(0)
    page.clock.fast_forward(1800)
    expect(white).to_have_count(0)
    expect(yellow).to_have_count(0)
    arena.locator('.tg-world-log').click()
    marker.click(button='right')
    expect(arena.locator('.tg-swing')).to_contain_text('Out of melee range')
    expect(arena.locator('[data-event=autoHit]')).to_have_count(0)
    page.keyboard.down('w')
    page.clock.run_for(800)
    page.keyboard.up('w')
    expect(arena.locator('[data-event=autoHit]')).to_have_count(1)
    arena.locator('.tg-basic-strike').click()
    expect(arena.locator('.tg-basic-strike')).to_have_attribute('aria-pressed', 'false')

    # Click the interaction collider under the nameplate, first on the head and
    # then on the torso after zooming in. Neither click targets the nameplate.
    for offset, zoom in [(.045, 0), (.125, -350)]:
        if zoom:
            page.clock.fast_forward(1600)
            page.mouse.move(x, y)
            page.mouse.wheel(0, zoom)
            page.clock.run_for(250)
        nameplate = marker.bounding_box()
        px = nameplate['x'] + nameplate['width'] / 2
        py = nameplate['y'] + nameplate['height'] / 2 + bounds['height'] * offset
        before_hits = arena.locator('[data-event=autoHit]').count()
        assert page.evaluate('([x,y]) => document.elementFromPoint(x,y).tagName', [px, py]) == 'CANVAS'
        page.mouse.click(px, py, button='right')
        expect(arena.locator('[data-event=autoHit]')).to_have_count(before_hits + 1)
        page.mouse.click(px, py, button='right')
        expect(arena.locator('[data-event=autoHit]')).to_have_count(before_hits + 1)
        if zoom:
            page.clock.run_for(40)
            page.screenshot(path=shots / '02-immediate-autoattack.png')
            page.keyboard.press('1')
            expect(arena.locator('[data-event=projectileLaunched]')).to_have_count(2)
        arena.locator('.tg-basic-strike').click()

    page.clock.fast_forward(1800)
    page.keyboard.press('2')
    page.clock.fast_forward(2100)
    healing = text.locator('[data-school=healing]:visible')
    expect(healing.locator('b')).to_have_css('color', 'rgb(117, 239, 153)')
    assert healing.locator('img').get_attribute('src').endswith('/spell_holy_flashheal.jpg')
    page.clock.run_for(300)
    page.screenshot(path=shots / '03-healing.png')
    assert not errors, errors
    print('Four real GLBs and WebGL2: projectile at distance, mixed text, projection/lifetime, '
          'nameplate/head/torso interaction, immediate autoattack and independent ability passed', flush=True)


if __name__ == '__main__':
    shots = Path(sys.argv[1])
    shots.mkdir(parents=True, exist_ok=True)
    os.environ['TALENT_LOCAL_WOW_ASSETS'] = '1'
    with temporary_database() as folder, sync_playwright() as pw:
        server.DB = str(Path(folder) / 'combat-feedback.sqlite')
        server.initialize()
        http = server.ArchiveHTTPServer(('127.0.0.1', 0), server.Handler)
        start_server(http)
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium', args=[
            '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'
        ])
        try:
            verify(browser.new_page(viewport={'width': 1200, 'height': 800}), http.server_port, shots)
        finally:
            browser.close()
