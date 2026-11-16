"""Render the 3D training arena in Chromium with SwiftShader and exercise real inputs."""
import base64
import json
from pathlib import Path
import struct
import sys

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from server_lifecycle import start_server, temporary_database

seed = json.loads((Path(__file__).parent / 'fixtures' / 'training-grounds.json').read_text(encoding='utf-8'))
positions = base64.b64encode(struct.pack('<9f', -0.5, 0, 0, 0.5, 0, 0, 0, 1.5, 0)).decode()
fixture = {
    'asset': {'version': '2.0'},
    'buffers': [{'uri': 'data:application/octet-stream;base64,' + positions, 'byteLength': 36}],
    'bufferViews': [{'buffer': 0, 'byteLength': 36, 'target': 34962}],
    'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 3, 'type': 'VEC3',
                   'min': [-0.5, 0, 0], 'max': [0.5, 1.5, 0]}],
    'materials': [{'doubleSided': True}],
    'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'material': 0}]}],
    'nodes': [{'mesh': 0}], 'scenes': [{'nodes': [0]}], 'scene': 0,
}
snapshot_script = """async (canvas) => {
    const {worldSnapshot} = await import('/world/generated/world.js');
    return worldSnapshot(canvas);
}"""

with temporary_database() as folder, sync_playwright() as playwright:
    server.DB = str(Path(folder) / 'world.sqlite')
    server.initialize()
    http = server.ArchiveHTTPServer(('127.0.0.1', 0), server.Handler)
    start_server(http)
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', args=[
        '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'
    ])
    try:
        url = f'http://127.0.0.1:{http.server_port}'
        page = browser.new_page(viewport={'width': 1440, 'height': 980})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('https://**/*', lambda route: route.abort())
        page.add_init_script('''
            localStorage.setItem('talentforge-language', 'en');
            localStorage.setItem('talentforge-draft', JSON.stringify(%s));
        ''' % json.dumps(seed))
        page.clock.install(time=0)
        page.goto(url)
        expect(page.locator('#treeTitle')).to_have_text('Training Mage')
        page.clock.pause_at(60_000)
        page.locator('#openTrainingGrounds').click()
        arena = page.locator('#trainingGrounds')
        canvas = arena.locator('.tg-world-frame canvas')
        expect(canvas).to_be_visible()
        assert canvas.evaluate('(canvas) => Boolean(canvas.getContext("webgl2"))')

        def snapshot():
            return canvas.evaluate(snapshot_script)

        assert snapshot()['model'] == 'placeholder'
        assert snapshot()['draws'] > 30 and snapshot()['geometries'] > 20
        expect(arena.locator('.tg-world-model')).to_have_text('Placeholder character')
        expect(arena.locator('.tg-ability strong')).to_have_text(['Flame', 'Renewal'])
        expect(arena.locator('[data-metric="totalDamage"]')).to_be_visible()
        marker = arena.locator('.tg-world-target')
        expect(marker).to_be_visible()

        # Focus the actual canvas and send keyboard/pointer input to Chromium.
        canvas.evaluate('(canvas) => canvas.focus({preventScroll: true})')
        initial = snapshot()['player']
        page.keyboard.down('w')
        page.clock.run_for(450)
        walking = snapshot()['player']
        assert walking['z'] < initial['z'] - 0.5 and walking['animation'] == 'walk'
        page.keyboard.down('Shift')
        page.clock.run_for(450)
        running = snapshot()['player']
        assert walking['z'] - running['z'] > initial['z'] - walking['z']
        assert running['animation'] == 'run'
        page.keyboard.up('Shift')
        page.keyboard.up('w')
        page.keyboard.press('Space')
        page.clock.run_for(150)
        airborne = snapshot()['player']
        assert airborne['y'] > 0.5 and not airborne['grounded']
        page.clock.run_for(800)
        assert snapshot()['player']['grounded']
        page.keyboard.press('1')
        expect(arena.locator('[data-event="damage"]').first).to_be_visible()
        expect(arena.locator('#tg-label-dummy')).to_be_visible()

        marker.click()
        assert snapshot()['selected']
        expect(marker).to_have_attribute('aria-pressed', 'true')
        bounds = canvas.bounding_box()
        x, y = bounds['x'] + bounds['width'] * 0.75, bounds['y'] + bounds['height'] * 0.45
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 80, y + 25, steps=4)
        page.mouse.up()
        changed = snapshot()['orbit']
        assert changed['yaw'] != 0 and changed['pitch'] != 0.29
        page.mouse.wheel(0, -300)
        page.clock.run_for(120)
        assert snapshot()['orbit']['distance'] < 5
        arena.locator('.tg-quality select').select_option('high')

        first_canvas = canvas.element_handle()
        arena.locator('#tg-return').click()
        expect(arena).not_to_be_visible()
        expect(canvas).to_have_count(0)
        expect(page.locator('#points')).to_have_text('1 / 41')
        assert first_canvas.evaluate(snapshot_script) is None

        page.route('**/local-world-assets/manifest.json', lambda route: route.fulfill(json={
            'model': 'character/fixture.gltf', 'scale': 1.2, 'rotation': 45, 'heightOffset': 0.1
        }))
        page.route('**/local-world-assets/character/fixture.gltf', lambda route: route.fulfill(json=fixture))
        page.locator('#openTrainingGrounds').click()
        expect(arena.locator('.tg-world-model')).to_have_text('Local model')
        assert snapshot()['model'] == 'imported'
        assert snapshot()['player']['z'] == initial['z']
        assert arena.locator('canvas').count() == 1
        canvas.evaluate('canvas => canvas.dispatchEvent(new Event("webglcontextlost", {cancelable: true}))')
        expect(canvas).not_to_be_visible()
        expect(arena.locator('.tg-world-status')).to_contain_text('3D is unavailable')
        expect(arena.locator('.tg-ability strong')).to_have_text(['Flame', 'Renewal'])
        assert not errors, errors
    finally:
        browser.close()

print('3D Training Grounds: rendered WebGL2, input, targeting, combat HUD, glTF import, re-entry and fallback passed')
