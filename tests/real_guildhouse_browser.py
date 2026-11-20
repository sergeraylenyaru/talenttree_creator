"""WebGL2 integration against the four privately installed GLB exports.

Pass a screenshot directory as the first argument to save images outside Git.
"""

import json
import math
import os
from pathlib import Path
import sys
import time

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server
from server_lifecycle import start_server, temporary_database

ASSETS = ROOT / 'local-assets' / 'wow'
SEED = json.loads((ROOT / 'tests/fixtures/training-grounds.json').read_text())
MELEE = {**SEED['abilities'][0], 'id': 'sword-test', 'name': 'Sword strike', 'learningMode': 'base',
         'range': 0, 'resourceCosts': [], 'cooldown': 1,
         'combatEffects': [SEED['abilities'][0]['combatEffects'][0]]}
SEED['abilities'][0]['cast'] = 1
SEED['abilities'][0]['presentation'] = {
    'category': 'spell', 'delivery': 'ranged', 'castingAnimation': 'cast',
    'projectile': 'homing', 'projectileSpeed': 5, 'impact': 'fire', 'channelDuration': 6
}
MELEE['presentation'] = {'category': 'attack', 'delivery': 'melee',
                         'attackAnimation': 'twoHand', 'impact': 'melee'}
SEED['abilities'].insert(1, MELEE)


def verify(page, port, screenshots):
    failures = []
    models = {}
    page.on('pageerror', lambda error: failures.append(str(error)))
    page.on('response', lambda response: models.update({response.url.split('/local-world-assets/')[-1]: response.status})
            if '/local-world-assets/' in response.url else None)
    page.route('https://**/*', lambda route: route.abort())
    legacy = json.loads((ASSETS / 'manifest.json').read_text())
    legacy['environment']['exploration'] = False
    for clip in ('walkBack', 'runBack', 'strafeLeft', 'strafeRight'):
        legacy['animations'].pop(clip, None)
    page.route('**/local-world-assets/manifest.json', lambda route: route.fulfill(json=legacy))
    page.add_init_script("""
        localStorage.setItem('talentforge-language', 'en');
        localStorage.setItem('talentforge-draft', JSON.stringify(%s));
        localStorage.setItem('talentforge-training-grounds-v1', JSON.stringify({stats: {critChance: 1}}));
    """ % json.dumps(SEED))
    page.goto(f'http://127.0.0.1:{port}')
    page.locator('#openTrainingGrounds').click()
    arena = page.locator('#trainingGrounds')
    canvas = arena.locator('canvas')
    panel = arena.locator('.tg-asset-panel')
    expect(panel.locator('[data-role=scene]')).to_have_text('Scene · Ready', timeout=120000)

    def state():
        return canvas.evaluate("""async element => {
            const {worldSnapshot} = await import('/world/generated/world.js');
            return worldSnapshot(element);
        }""")

    def wait_for(check, label, timeout=15):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            current = state()
            if check(current):
                return current
            page.wait_for_timeout(30)
        raise AssertionError(f'{label}: {state()}')

    def orbit(dx):
        rect = canvas.bounding_box()
        x, y = rect['x'] + rect['width'] * .35, rect['y'] + rect['height'] * .55
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + dx, y, steps=6)
        page.mouse.up()

    def shot(name):
        if screenshots:
            canvas.screenshot(path=screenshots / (name + '.png'), timeout=20000)
            print('Captured', name, flush=True)

    def grip(data):
        assert data['weaponGripError'] < 1e-9 and all(map(math.isfinite, data['weaponPosition']))

    initial = wait_for(lambda s: (s['activeClip'] or '').startswith('Stand')
                       and (s.get('targetClip') or '').startswith('Stand'), 'initial idle frame')
    assert canvas.evaluate("element => !!element.getContext('webgl2')")
    assert set(initial['assets']) == {'hero', 'environment', 'weapon', 'target'}, panel.text_content()
    expected = ['manifest.json', 'character/hero.glb', 'targets/Training-dummy.glb',
                'weapons/sword-one-hand.glb', 'world/guildhouseb.glb']
    assert all(models.get(path) == 200 for path in expected), models
    assert abs(initial['visualMinY'] - initial['player']['y']) < 0.04, initial
    assert initial['dummy'] == [-25, -0.0545, -25]
    grip(initial)
    panel.locator(':scope > summary').click()
    expect(panel.locator('[data-bone]')).to_have_text('bone_HandR')
    with page.expect_download() as event:
        panel.locator('[data-report]').click()
    report = json.loads(event.value.path().read_text())['assets']
    for role, asset in report.items():
        assert asset['textures'] > 0 and asset['meshes'] > 0, role
        assert all(map(math.isfinite, asset['bounds']['min'] + asset['bounds']['max'])), role
    assert [entry['bone'] for entry in report['hero']['rigidAttachments']] == ['bone_ShoulderL', 'bone_ShoulderR']
    print('Actual GLB materials, textures and bounds verified:', {r: a['textures'] for r, a in report.items()}, flush=True)
    panel.locator(':scope > summary').click()
    shot('01-guildhouse-idle')
    orbit(-185)
    wait_for(lambda s: s['cameraForward']['x'] < -.8, 'right-hand view')
    page.mouse.wheel(0, -1500)
    wait_for(lambda s: s['camera']['clearance'] < 2.45, 'close-up zoom')
    shot('03-right-hand-grip')
    orbit(185)
    page.mouse.wheel(0, 775)
    wait_for(lambda s: abs(s['cameraForward']['x']) < .02, 'return behind hero')

    def cast(ability, expected):
        # Read the live render immediately after the user-initiated action.
        animated = arena.locator('[data-tg-ability]').filter(has_text=ability).evaluate("""async element => {
            const {worldSnapshot} = await import('/world/generated/world.js');
            element.click();
            await new Promise(requestAnimationFrame);
            await new Promise(requestAnimationFrame);
            return worldSnapshot(document.querySelector('.tg-world-frame canvas'));
        }""")
        assert not arena.locator('#tg-feedback').text_content()
        assert animated['activeClip'].startswith(expected), animated
        return animated

    arena.locator('.tg-world-target').click()
    ranged = cast('Flame', ('SpellCast', 'ChannelCastDirected'))
    grip(ranged)
    channel = wait_for(lambda s: (s['activeClip'] or '').startswith('ChannelCastDirected'), 'channel animation')
    grip(channel)
    expect(arena.locator('#tg-cast-phase')).to_have_text('Channeling')
    shot('05-channeling')
    wait_for(lambda s: 'CombatWound' in s['targetClip'], 'ranged impact')
    expect(arena.locator('[data-event=damage].tg-critical').first).to_have_count(1)
    wait_for(lambda s: s['targetClip'].startswith('Stand'), 'dummy recovered')
    canvas.focus()
    page.keyboard.down('KeyW')
    walking = wait_for(lambda s: s['activeClip'].startswith('Run') and s['player']['z'] < -22.5, 'walk')
    page.keyboard.up('KeyW')
    grip(walking)
    wait_for(lambda s: s['activeClip'].startswith('Stand'), 'idle after movement')
    melee = cast('Sword strike', 'Attack2H')
    grip(melee)
    assert math.dist(melee['weaponPosition'], walking['weaponPosition']) > 0.08
    wait_for(lambda s: 'CombatWound' in s['targetClip'], 'melee impact')
    print('Manual ranged and two-handed melee combat verified', flush=True)

    canvas.focus()
    page.keyboard.down('ShiftLeft')
    page.keyboard.down('KeyA')
    running = wait_for(lambda s: s['activeClip'].startswith('Walk'), 'shift walk')
    grip(running)
    page.keyboard.press('Space')
    jumping = wait_for(lambda s: s['activeClip'].startswith('Jump'), 'jump')
    grip(jumping)
    page.keyboard.up('ShiftLeft')
    falling = wait_for(lambda s: s['activeClip'].startswith('Fall'), 'fall')
    grip(falling)
    wall = wait_for(lambda s: s['player']['x'] < -30.85 and s['player']['grounded'], 'reach west obstacle')
    page.wait_for_timeout(600)
    stopped = state()
    assert abs(stopped['player']['x'] - wall['player']['x']) < 0.2 and stopped['player']['x'] >= -31, stopped
    page.keyboard.up('KeyA')
    page.keyboard.press('Space')
    page.keyboard.down('KeyA')
    wait_for(lambda s: s['activeClip'].startswith('Jump'), 'jump against wall')
    finished = wait_for(lambda s: s['player']['grounded'], 'land against wall')
    page.keyboard.up('KeyA')
    assert abs(finished['player']['x'] - stopped['player']['x']) < 0.1, finished

    debug = arena.locator('.tg-world-debug-control input')
    debug.check()
    expect(arena.locator('.tg-world-debug')).to_contain_text('bone_HandR')
    orbit(263)
    blocked = wait_for(lambda s: s['camera']['obstructed'] and not s['camera']['avatarVisible'],
                       'wall camera obstruction and close-range avatar culling')
    assert blocked['camera']['clearance'] < blocked['camera']['distance']
    shot('02-guildhouse-collision-debug')
    debug.uncheck()
    expect(arena.locator('.tg-world-debug')).to_be_hidden()
    orbit(-263)
    wait_for(lambda s: abs(s['cameraForward']['x']) < .02 and s['camera']['avatarVisible'],
             'return behind hero at wall')
    canvas.focus()
    page.keyboard.down('KeyD')
    wait_for(lambda s: s['player']['x'] > -26.5, 'approach table aisle')
    page.keyboard.up('KeyD')
    page.keyboard.down('KeyS')
    table = wait_for(lambda s: s['player']['z'] >= -19.77 and abs(s['player']['vz']) < 0.02,
                     'stop against the guildhouse table', timeout=45)
    assert abs(table['player']['z'] - (-19.416 - 0.34)) < 0.05
    page.keyboard.down('KeyD')
    wait_for(lambda s: s['player']['x'] > -24.5, 'slide around the table corner', timeout=45)
    page.keyboard.up('KeyD')
    passage = wait_for(lambda s: s['player']['z'] > -15.8, 'south passage', timeout=45)
    page.keyboard.up('KeyS')
    assert passage['player']['grounded'] and abs(passage['visualMinY'] - passage['player']['y']) < 0.15
    shot('04-south-passage')

    assert not failures, failures
    print('Walk, run, jump, fall, wall, table, corner, passage and camera collision verified in the actual guildhouse', flush=True)


def main():
    manifest = json.loads((ASSETS / 'manifest.json').read_text())
    for path in (manifest['model'], manifest['target']['model'], manifest['environment']['model'],
                 manifest['weapons']['mainHand']['model']):
        with (ASSETS / path).open('rb') as model:
            assert model.read(4) == b'glTF', path
    screenshots = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if screenshots:
        screenshots.mkdir(parents=True, exist_ok=True)
    os.environ['TALENT_LOCAL_WOW_ASSETS'] = '1'
    with temporary_database() as folder, sync_playwright() as playwright:
        server.DB = str(Path(folder) / 'real-arena.sqlite')
        server.initialize()
        http = server.ArchiveHTTPServer(('127.0.0.1', 0), server.Handler)
        start_server(http)
        browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),
            args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        try:
            verify(browser.new_page(viewport={'width': 1440, 'height': 1050}, accept_downloads=True),
                   http.server_port, screenshots)
        finally:
            browser.close()


if __name__ == '__main__':
    main()
