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
# The mesh origin is above its feet. Animate a child node without changing its base height.
positions = base64.b64encode(struct.pack('<17f', -0.5, -1.5, 0, 0.5, -1.5, 0, 0, 0.3, 0,
                                        0, 1, 1, 1, 1, 1.2, 1, 1)).decode()
fixture = {
    'asset': {'version': '2.0'},
    'buffers': [{'uri': 'data:application/octet-stream;base64,' + positions, 'byteLength': 68}],
    'bufferViews': [{'buffer': 0, 'byteLength': 36, 'target': 34962},
                    {'buffer': 0, 'byteOffset': 36, 'byteLength': 8},
                    {'buffer': 0, 'byteOffset': 44, 'byteLength': 24}],
    'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 3, 'type': 'VEC3',
                   'min': [-0.5, -1.5, 0], 'max': [0.5, 0.3, 0]},
                  {'bufferView': 1, 'componentType': 5126, 'count': 2, 'type': 'SCALAR', 'min': [0], 'max': [1]},
                  {'bufferView': 2, 'componentType': 5126, 'count': 2, 'type': 'VEC3'}],
    'materials': [{'doubleSided': True}],
    'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'material': 0}]}],
    'nodes': [{'children': [1], 'translation': [0, -0.3, 0]}, {'mesh': 0}],
    'scenes': [{'nodes': [0]}], 'scene': 0,
    'animations': [{'name': name, 'samplers': [{'input': 1, 'output': 2}],
                    'channels': [{'sampler': 0, 'target': {'node': 1, 'path': 'scale'}}]}
                   for name in ('Idle', 'Walk', 'Run', 'Jump', 'Fall')],
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
        marker.click()
        page.keyboard.press('1')
        page.clock.run_for(1100)
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
            'model': 'character/fixture.gltf', 'scale': 1.2, 'rotation': 90, 'heightOffset': 0
        }))
        page.route('**/local-world-assets/character/fixture.gltf', lambda route: route.fulfill(json=fixture))
        page.locator('#openTrainingGrounds').click()
        expect(arena.locator('.tg-world-model')).to_have_text('Local model')
        assert snapshot()['model'] == 'imported'
        assert snapshot()['player']['z'] == initial['z']
        assert arena.locator('canvas').count() == 1
        arena.locator('.tg-quality select').select_option('low')
        canvas.evaluate('(canvas) => canvas.focus({preventScroll: true})')
        page.clock.run_for(80)
        assert abs(snapshot()['visualMinY']) < 1e-5
        assert snapshot()['player']['y'] == 0
        assert snapshot()['activeClip'] == 'Idle'

        def move(key, basis, sign, clip):
            start = snapshot()['player']
            page.keyboard.down(key)
            page.clock.run_for(300)
            current = snapshot()
            page.keyboard.up(key)
            dx = current['player']['x'] - start['x']
            dz = current['player']['z'] - start['z']
            fx, fz = current['cameraForward']['x'], current['cameraForward']['z']
            forward, right = dx * fx + dz * fz, -dx * fz + dz * fx
            measured = forward if basis == 'forward' else right
            sideways = right if basis == 'forward' else forward
            assert sign * measured > 0.25 and abs(sideways) < 0.08, current
            assert current['activeClip'] == clip
            page.clock.run_for(140)

        move('w', 'forward', 1, 'Walk')
        move('s', 'forward', -1, 'Walk')
        move('a', 'right', -1, 'Walk')
        move('d', 'right', 1, 'Walk')
        bounds = canvas.bounding_box()
        x, y = bounds['x'] + bounds['width'] * 0.7, bounds['y'] + bounds['height'] * 0.5
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - 270, y, steps=6)
        page.mouse.up()
        page.clock.run_for(260)
        assert abs(snapshot()['cameraForward']['x']) > 0.8
        page.keyboard.down('Shift')
        move('w', 'forward', 1, 'Run')
        page.keyboard.up('Shift')
        page.keyboard.press('Space')
        page.clock.run_for(160)
        assert snapshot()['activeClip'] == 'Jump'
        assert snapshot()['visualMinY'] > 0.5
        page.clock.run_for(330)
        assert snapshot()['activeClip'] == 'Fall'
        page.clock.run_for(450)
        assert snapshot()['activeClip'] == 'Idle'
        assert snapshot()['player']['grounded']
        assert abs(snapshot()['visualMinY']) < 1e-5
        canvas.evaluate('canvas => canvas.dispatchEvent(new Event("webglcontextlost", {cancelable: true}))')
        expect(canvas).not_to_be_visible()
        expect(arena.locator('.tg-world-status')).to_contain_text('3D is unavailable')
        expect(arena.locator('.tg-ability strong')).to_have_text(['Flame', 'Renewal'])
        assert not errors, errors
    finally:
        browser.close()

print('3D Training Grounds: rendered WebGL2, input, targeting, combat HUD, grounded glTF import, camera-relative WASD, animation clips, re-entry and fallback passed')
