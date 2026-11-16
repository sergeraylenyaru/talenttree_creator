"""Play the current talent build in Training Grounds with a controlled Chromium clock."""
import json
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from server_lifecycle import start_server, temporary_database

document = json.loads((Path(__file__).parent / 'fixtures' / 'training-grounds.json').read_text(encoding='utf-8'))
document['build'] = {}

with temporary_database() as tmp, sync_playwright() as playwright:
    server.DB = str(Path(tmp) / 'training.sqlite')
    server.initialize()
    http = server.ArchiveHTTPServer(('127.0.0.1', 0), server.Handler)
    start_server(http)
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    try:
        page = browser.new_page(viewport={'width': 1366, 'height': 900})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('https://**/*', lambda route: route.abort())
        page.add_init_script("""
            localStorage.setItem('talentforge-language', 'en');
            const seed = %s;
            if (!localStorage.getItem('talentforge-draft')) {
                localStorage.setItem('talentforge-draft', JSON.stringify(seed));
                localStorage.setItem('talentforge-training-grounds-v1', JSON.stringify({stats: {critChance: 1}}));
            }
        """ % json.dumps(document))
        page.clock.install(time=0)
        page.clock.pause_at(60_000)
        page.goto(f'http://127.0.0.1:{http.server_port}')
        expect(page.locator('#treeTitle')).to_have_text('Training Mage')
        page.locator('[data-talent="fire-talent"]').click()
        expect(page.locator('#points')).to_have_text('1 / 41')
        page.locator('#openTrainingGrounds').click()
        arena = page.locator('#trainingGrounds')
        expect(arena).to_be_visible()
        # This scenario exercises the original non-spatial combat mode.
        toggle = arena.locator('.tg-world-toggle')
        expect(toggle).to_be_enabled()
        if toggle.get_attribute('aria-pressed') == 'true':
            toggle.click()

        expect(arena.locator('#tg-title')).to_have_text('Training Grounds')
        expect(arena.locator('.tg-build strong')).to_have_text('Training Mage')
        expect(arena.locator('.tg-ability strong')).to_have_text(['Flame', 'Renewal'])
        expect(arena.locator('.tg-main details')).to_contain_text('Passive abilities')

        def meter(name, value):
            expect(arena.locator(f'meter[aria-labelledby="tg-label-{name}"]')).to_have_attribute('value', str(value))

        meter('dummy', 1000000)
        meter('player', 1000)
        page.keyboard.press('1')
        meter('dummy', 999780)
        meter('player', 900)
        meter('resource-0', 60)
        meter('resource-1', 1)
        expect(arena.locator('[data-event="damage"]')).to_have_count(2)
        expect(arena.locator('[data-event="damage"].tg-critical')).to_contain_text('Critical')
        expect(arena.locator('.tg-float.tg-critical')).to_have_text('−200!')
        expect(arena.locator('[data-tg-ability="0"] .tg-cooldown')).to_have_text('4 s')
        expect(arena.locator('[data-metric="totalDamage"]')).to_have_text('220')

        page.clock.run_for(1600)
        page.keyboard.press('2')
        expect(arena.locator('#tg-cast')).to_be_visible()
        expect(arena.locator('#tg-cast-name')).to_have_text('Renewal')
        meter('player', 900)
        page.clock.run_for(1000)
        expect(arena.locator('#tg-cast')).to_be_visible()
        arena.locator('#tg-pause').click()
        page.clock.run_for(3000)
        meter('player', 900)
        arena.locator('#tg-pause').click()
        page.clock.run_for(1050)
        expect(arena.locator('#tg-cast')).not_to_be_visible()
        meter('player', 1000)
        meter('resource-0', 55)
        expect(arena.locator('[data-metric="totalHealing"]')).to_have_text('160')
        expect(arena.locator('[data-metric="effectiveHealing"]')).to_have_text('100')
        expect(arena.locator('[data-metric="overhealing"]')).to_have_text('60')
        expect(arena.locator('[data-event="healing"]')).to_contain_text('Player healing')
        arena.locator('#tg-clear').click()
        expect(arena.locator('#tg-log li')).to_have_count(0)
        expect(arena.locator('[data-metric="totalDamage"]')).to_have_text('220')

        page.set_viewport_size({'width': 360, 'height': 740})
        assert arena.evaluate('(dialog) => dialog.scrollWidth <= dialog.clientWidth')
        arena.locator('.tg-settings summary').click()
        arena.locator('[name="maxHealth"]').fill('400')
        arena.locator('[name="globalCooldown"]').fill('0')
        arena.locator('.tg-settings-form button').click()
        meter('dummy', 400)
        meter('player', 1000)
        meter('resource-0', 80)
        expect(arena.locator('[data-metric="totalDamage"]')).to_have_text('0')
        arena.locator('[data-tg-ability="0"]').click()
        meter('dummy', 180)
        arena.locator('#tg-reset').click()
        meter('dummy', 400)
        meter('resource-1', 2)
        arena.locator('#tg-return').click()
        expect(arena).not_to_be_visible()
        expect(page.locator('#points')).to_have_text('1 / 41')
        page.locator('#openTrainingGrounds').click()
        meter('dummy', 400)
        page.keyboard.press('Escape')
        expect(arena).not_to_be_visible()
        assert not errors, errors
    finally:
        browser.close()

print('Training Grounds: selected build, damage, healing, resources, timers, settings, reset and mobile passed')
