"""Exercise spatial combat through the real WebGL2 arena."""
import json
from pathlib import Path
import sys

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from server_lifecycle import start_server, temporary_database

seed = json.loads((Path(__file__).parent / 'fixtures' / 'training-grounds.json').read_text(encoding='utf-8'))
melee = seed['abilities'][0]
melee.update(name='Strike', range=0, cooldown=4)
melee['combatEffects'] = [{**melee['combatEffects'][0], 'school': 'physical'}]
ranged = {**melee, 'id': 'bolt', 'name': 'Arcane bolt', 'learningMode': 'base', 'range': 25,
          'combatEffects': [{**melee['combatEffects'][0], 'school': 'arcane'}],
          'resourceCosts': [{'resourceId': 'mana', 'amount': 10, 'unit': 'points'}]}
seed['abilities'].insert(1, ranged)

with temporary_database() as folder, sync_playwright() as playwright:
    server.DB = str(Path(folder) / 'spatial.sqlite')
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
        page.add_init_script('''
            localStorage.setItem('talentforge-language', 'en');
            localStorage.setItem('talentforge-draft', JSON.stringify(%s));
            localStorage.setItem('talentforge-training-grounds-v1',
              JSON.stringify({dummy: {maxHealth: 200}, stats: {critChance: 0}, globalCooldown: 0}));
        ''' % json.dumps(seed))
        page.clock.install(time=0)
        page.goto(f'http://127.0.0.1:{http.server_port}')
        expect(page.locator('#treeTitle')).to_have_text('Training Mage')
        page.clock.pause_at(60_000)
        page.locator('#openTrainingGrounds').click()
        arena = page.locator('#trainingGrounds')
        canvas = arena.locator('canvas')
        expect(canvas).to_be_visible()
        marker = arena.locator('.tg-world-target')
        feedback = arena.locator('#tg-feedback')
        damage = arena.locator('[data-event="damage"]')

        def snapshot():
            return canvas.evaluate('''async element => {
                const {worldSnapshot} = await import('/world/generated/world.js');
                return worldSnapshot(element);
            }''')

        def vital(name, amount):
            expect(arena.locator(f'meter[aria-labelledby="tg-label-{name}"]')).to_have_attribute('value', str(amount))

        page.keyboard.press('1')
        expect(feedback).to_have_text('Select the dummy')
        marker.click()
        page.keyboard.press('1')
        expect(feedback).to_have_text('Target out of range')
        vital('resource-0', 80)

        page.keyboard.down('w')
        page.clock.run_for(1450)
        page.keyboard.up('w')
        page.keyboard.press('1')
        expect(arena.locator('[data-event="attackLaunched"]')).to_have_count(1)
        vital('dummy', 200)
        vital('resource-0', 60)
        expect(arena.locator('[data-world-slot="1"] span')).not_to_be_empty()
        page.clock.run_for(180)
        expect(damage).to_have_count(0)
        page.clock.run_for(160)
        vital('dummy', 100)
        expect(damage).to_have_count(1)

        page.keyboard.down('s')
        page.clock.run_for(1250)
        page.keyboard.up('s')
        page.clock.run_for(2600)
        page.keyboard.press('1')
        expect(feedback).to_have_text('Target out of range')
        vital('resource-0', 60)
        page.keyboard.press('2')
        start = snapshot()['attacks'][0]['position']['z']
        page.clock.run_for(110)
        assert snapshot()['attacks'][0]['position']['z'] < start
        vital('dummy', 100)
        vital('resource-0', 50)
        page.clock.run_for(900)
        vital('dummy', 0)
        expect(marker).to_have_text('Dummy defeated')
        expect(damage).to_have_count(2)
        expect(arena.locator('[data-metric="totalDamage"]')).to_have_text('200')
        assert not snapshot()['attacks']

        arena.locator('.tg-target-reset').click()
        vital('dummy', 200)
        vital('resource-0', 50)
        arena.locator('#tg-return').click()
        expect(canvas).to_have_count(0)
        page.locator('#openTrainingGrounds').click()
        expect(canvas).to_have_count(1)
        expect(canvas).to_be_visible()
        assert not snapshot()['attacks']
        vital('dummy', 200)
        assert not errors, errors
    finally:
        browser.close()

print('Spatial combat: melee timing, range feedback, projectile travel and impact, costs, defeat, reset and re-entry passed')
