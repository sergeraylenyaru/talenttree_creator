"""End-to-end synthetic local exports in a real Chromium WebGL2 arena."""
import base64
import json
from pathlib import Path
import struct
import sys

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from server_lifecycle import start_server, temporary_database


def model(environment=False, clips=()):
    vertices = [-6, 2, -6, -6, 2, 6, 6, 2, -6, 6, 2, 6] if environment else [
        -0.4, -1, 0, 0.4, -1, 0, 0, 1, 0, 0.4, 1, 0]
    chunk = struct.pack('<20f', *vertices, 0, 1, 1, 1, 1, 1.2, 1, 1)
    return {
        'asset': {'version': '2.0'},
        'buffers': [{'uri': 'data:application/octet-stream;base64,' + base64.b64encode(chunk).decode(),
                     'byteLength': len(chunk)}],
        'bufferViews': [{'buffer': 0, 'byteLength': 48, 'target': 34962},
                        {'buffer': 0, 'byteOffset': 48, 'byteLength': 8},
                        {'buffer': 0, 'byteOffset': 56, 'byteLength': 24}],
        'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 4, 'type': 'VEC3',
                       'min': [min(vertices[i::3]) for i in range(3)],
                       'max': [max(vertices[i::3]) for i in range(3)]},
                      {'bufferView': 1, 'componentType': 5126, 'count': 2, 'type': 'SCALAR',
                       'min': [0], 'max': [1]},
                      {'bufferView': 2, 'componentType': 5126, 'count': 2, 'type': 'VEC3'}],
        'materials': [{'doubleSided': True}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'material': 0, 'mode': 5}]}],
        'nodes': [{'mesh': 0, 'children': [1]}, {'name': 'bone_WeaponR'}],
        'scenes': [{'nodes': [0]}], 'scene': 0,
        'animations': [{'name': name, 'samplers': [{'input': 1, 'output': 2}],
                        'channels': [{'sampler': 0, 'target': {'node': 1, 'path': 'scale'}}]}
                       for name in clips],
    }


seed = json.loads((Path(__file__).parent / 'fixtures' / 'training-grounds.json').read_text(encoding='utf-8'))
manifest = {
    'model': 'character/hero.gltf', 'debug': True,
    'environment': {'model': 'world/guildhouse.gltf',
                    'ground': {'minX': -5, 'maxX': 5, 'minZ': -5, 'maxZ': 5, 'y': 2}},
    'target': {'model': 'targets/Training-dummy.gltf', 'position': {'x': 0, 'z': -2}},
    'playerSpawn': {'x': 0, 'z': 3},
    'weapons': {'mainHand': {'model': 'weapons/sword.gltf'}}
}
target_clips = ('Stand (ID 0 variation 0)', 'CombatWound (ID 9 variation 0)', 'CombatCritical (ID 10 variation 0)')
models = {
    manifest['model']: model(clips=('Idle', 'Walk', 'Run')),
    manifest['environment']['model']: model(environment=True),
    manifest['target']['model']: model(clips=target_clips),
    manifest['weapons']['mainHand']['model']: model(),
}

with temporary_database() as folder, sync_playwright() as playwright:
    server.DB = str(Path(folder) / 'arena.sqlite')
    server.initialize()
    http = server.ArchiveHTTPServer(('127.0.0.1', 0), server.Handler)
    start_server(http)
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', args=[
        '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'
    ])
    try:
        page = browser.new_page(viewport={'width': 1366, 'height': 940})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('https://**/*', lambda route: route.abort())
        page.route('**/local-world-assets/manifest.json', lambda route: route.fulfill(json=manifest))
        def respond_with(value):
            return lambda route: route.fulfill(json=value)

        for path, fixture in models.items():
            page.route('**/local-world-assets/' + path, respond_with(fixture))
        page.add_init_script('''
            localStorage.setItem('talentforge-language', 'en');
            localStorage.setItem('talentforge-draft', JSON.stringify(%s));
            localStorage.setItem('talentforge-training-grounds-v1', JSON.stringify({stats: {critChance: 1}}));
        ''' % json.dumps(seed))
        page.clock.install(time=0)
        page.goto(f'http://127.0.0.1:{http.server_port}')
        expect(page.locator('#treeTitle')).to_have_text('Training Mage')
        page.clock.pause_at(60_000)
        page.locator('#openTrainingGrounds').click()
        arena = page.locator('#trainingGrounds')
        canvas = arena.locator('canvas')
        panel = arena.locator('.tg-asset-panel')
        panel.locator('[data-role="scene"]').wait_for(state='attached')

        def snapshot():
            return canvas.evaluate('''async el => {
                const {worldSnapshot} = await import('/world/generated/world.js');
                return worldSnapshot(el);
            }''')

        assert set(snapshot()['assets']) == {'hero', 'environment', 'weapon', 'target'}
        assert snapshot()['player']['y'] == 2
        assert abs(snapshot()['visualMinY'] - 2) < 1e-5
        panel.locator(':scope > summary').click()
        expect(panel.locator('[data-bone]')).to_have_text('bone_WeaponR')
        panel.locator('input').first.fill('0.2')
        panel.locator('[data-reset]').click()
        expect(panel.locator('input').first).to_have_value('0')
        panel.locator(':scope > summary').click()
        page.clock.run_for(100)
        assert snapshot()['targetClip'] == target_clips[0]
        arena.locator('.tg-world-target').click()
        page.keyboard.press('1')
        page.clock.run_for(180)
        assert snapshot()['targetClip'] == target_clips[0]
        page.clock.run_for(420)
        assert snapshot()['targetClip'] == target_clips[2]
        expect(arena.locator('[data-event="damage"]').first).to_be_visible()
        arena.locator('.tg-target-reset').click()
        page.clock.run_for(60)
        assert snapshot()['targetClip'] == target_clips[0]
        arena.locator('#tg-return').click()
        expect(canvas).to_have_count(0)
        page.route('**/local-world-assets/weapons/sword.gltf', lambda route: route.fulfill(status=404))
        page.route('**/local-world-assets/world/guildhouse.gltf', lambda route: route.fulfill(status=404))
        page.route('**/local-world-assets/targets/Training-dummy.gltf', lambda route: route.fulfill(status=404))
        page.locator('#openTrainingGrounds').click()
        expect(panel.locator('[data-role="scene"]')).to_have_text('Scene · Ready')
        assert snapshot()['assets'] == ['hero']
        assert snapshot()['player']['y'] == 0
        assert not errors, errors
    finally:
        browser.close()

print('Local arena: four synthetic assets, floor, calibrated attachment, impact animation and optional fallbacks passed')
