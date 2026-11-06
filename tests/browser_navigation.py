"""Optional browser regression: python3 tests/browser_navigation.py.

Requires Playwright and Chromium; CHROMIUM_PATH may select a local binary.
Uses a disposable SQLite database and never touches application saves.
"""
import os
from pathlib import Path
import sys
import tempfile
import threading
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def run():
    previous_db = server.DB
    with tempfile.TemporaryDirectory() as tmp:
        server.DB = str(Path(tmp) / 'navigation.sqlite')
        server.initialize()
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),
                    headless=True, args=['--no-sandbox'])
                context = browser.new_context(viewport={'width': 1440, 'height': 1000})
                base = f'http://127.0.0.1:{http.server_port}'
                assert context.request.post(base + '/api/register', data={
                    'login': 'navigation_author', 'password': 'navigation-password'}).ok
                context.request.post(base + '/api/profile/settings', data={'language':'ru'})
                document = {'version': 1, 'name': 'Дерево для проверки', 'budget': 41,
                            'rowCost': 5, 'build': {}, 'abilities': [], 'branches': [
                                {'id': 'one', 'name': 'Ветка', 'rows': 25, 'talents': []}]}
                project_id = context.request.post(base + '/api/projects', data={
                    'document': document}).json()['id']
                assert context.request.post(base + '/api/publish', data={
                    'projectId': project_id, 'visibility': 'public'}).ok
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('dialog', lambda dialog: dialog.accept())
                page.goto(base)
                page.wait_for_function("document.querySelector('#user').textContent==='navigation_author'")
                for copy in (False, True):
                    page.locator('#rankings').click()
                    page.wait_for_selector('.publication-row')
                    page.locator('#projects').click()
                    page.wait_for_selector('[data-open]')
                    assert page.locator('#library h2').inner_text() == 'Мои деревья'
                    page.locator('[data-copy]' if copy else '[data-open]').first.click()
                    page.wait_for_function("document.querySelector('#community').hidden && !document.querySelector('.workspace').hidden")
                    assert page.locator('#className').input_value() == document['name'] + (' — копия' if copy else '')
                    assert page.locator('#className').is_enabled()
                    assert page.locator('#projects').get_attribute('aria-current') == 'page'
                page.locator('#rankings').click()
                page.wait_for_selector('.publication-row')
                page.locator('.publication-row-bottom').click()
                page.wait_for_selector('#draftDialog[open]')
                page.locator('#discardDraft').click()
                page.wait_for_selector('#likePublication')
                assert page.locator('.workspace').is_visible()
                assert not page.locator('#className').is_enabled()
                assert '?share=' in page.url
                page.locator('#projects').click()
                page.locator('[data-open]').first.click()
                page.wait_for_function("!document.querySelector('#className').disabled")
                assert '?share=' not in page.url
                assert not page.locator('#publicationBar').is_visible()
                page.locator('#projects').click()
                page.wait_for_selector('#librarySearch')
                page.locator('#librarySearch').fill('нет такого дерева')
                assert page.locator('.library-card').count() == 0
                page.locator('#librarySearch').fill('')
                page.locator('[data-open]').first.click()
                page.wait_for_function("document.querySelector('#library').hidden")
                assert page.locator('#zoomIn,#zoomReset,#focusBranch').count()==0
                page.locator('#save').click()
                page.wait_for_function("document.querySelector('#saveState').textContent==='Сохранено в аккаунте'")
                page.locator('#notifications').click()
                assert page.locator('#noticeList li').count() > 0
                page.locator('#clearNotices').click()
                assert page.locator('#noticeList li').count() == 0
                page.keyboard.press('Escape')
                assert not page.locator('#noticeDropdown').is_visible()
                for width in (1024, 768, 390, 320):
                    page.set_viewport_size({'width': width, 'height': 900})
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                    assert page.locator('#trees').evaluate("el=>el.scrollHeight<=el.clientHeight+1 && el.scrollWidth<=el.clientWidth+1 && getComputedStyle(el).overflow==='visible'")
                page.locator('#mobileMenu').click()
                assert page.locator('#siteNav').is_visible()
                page.locator('#rankings').click()
                page.wait_for_selector('.publication-row')
                assert page.locator('#mobileMenu').get_attribute('aria-expanded') == 'false'
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.emulate_media(reduced_motion='reduce')
                assert page.locator('.publication-row').first.evaluate('(el)=>getComputedStyle(el).animationName') == 'none'
                assert not errors, errors
                browser.close()
                print('PASS: saved tree and copy open from rankings; row opens calculator; switching back clears publication state.')
        finally:
            http.shutdown()
            http.server_close()
            thread.join()
            server.DB = previous_db


if __name__ == '__main__':
    run()
