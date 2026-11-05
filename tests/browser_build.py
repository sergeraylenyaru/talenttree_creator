"""Optional browser regression: separate visitor builds, temporary SQLite only."""
import json
import sys
import tempfile
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

with tempfile.TemporaryDirectory() as tmp:
    server.DB = str(Path(tmp) / 'builds.sqlite')
    server.initialize()
    http = server.ArchiveHTTPServer(('127.0.0.1', 0), server.Handler)
    threading.Thread(target=http.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{http.server_port}'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
            owner = browser.new_context()
            owner.request.post(base + '/api/register', data={'login':'build_author', 'password':'test-password-123'})
            d = {'version':1,'name':'Личный калькулятор','budget':41,'rowCost':5,'build':{'t':3},'abilities':[],
                 'branches':[{'id':'b','name':'Сила','rows':5,'talents':[{'id':'t','name':'Сила','icon':'inv_misc_questionmark','row':0,'col':0,'maxRank':5,'descriptions':['1','2','3','4','5'],'requires':''}]}]}
            tokens = [owner.request.post(base + '/api/share', data={'document':d,'visibility':'public'}).json()['token'] for _ in range(2)]
            # Simulate a link published before allocations were removed from server documents.
            with server.connect() as db:
                db.execute('UPDATE shares SET document=? WHERE token=?', (json.dumps(d), tokens[0]))
            a, b = browser.new_context(), browser.new_context()
            first, second = a.new_page(), b.new_page()
            errors = []
            for page in [first, second]:
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('dialog', lambda dialog: dialog.accept())

            def open_tree(page, token, points):
                page.goto(base + '/?share=' + token)
                page.wait_for_function("document.querySelector('#publicationBar').textContent.includes('Личный калькулятор')")
                page.wait_for_function("expected=>document.querySelector('#points').textContent===expected", arg=f'{points} / 41')

            open_tree(first, tokens[0], 0)
            first.locator('[data-talent="t"]').click()
            first.locator('[data-talent="t"]').click()
            assert first.locator('#points').inner_text() == '2 / 41'
            open_tree(first, tokens[0], 2)
            open_tree(second, tokens[0], 0)
            second.locator('[data-talent="t"]').click()
            open_tree(second, tokens[0], 1)
            first.locator('#rankings').click()
            first.locator('[data-open-publication="' + tokens[1] + '"]').click()
            first.wait_for_function("document.querySelector('#points').textContent==='0 / 41'")
            first.locator('#rankings').click()
            first.locator('[data-open-publication="' + tokens[0] + '"]').click()
            first.wait_for_function("document.querySelector('#points').textContent==='2 / 41'")
            first.locator('#reset').click()
            first.locator('#undo').click()
            open_tree(first, tokens[0], 2)
            first.locator('#reset').click()
            open_tree(first, tokens[0], 0)
            open_tree(second, tokens[0], 1)
            assert a.request.get(base + '/api/shared/' + tokens[0]).json()['document']['build'] == {}
            with server.connect() as db:
                assert json.loads(db.execute('SELECT document FROM shares WHERE token=?', (tokens[0],)).fetchone()[0])['build'] == {'t':3}
            assert not errors, errors
            print('PASS: legacy links start empty; browser builds survive reload and undo; reset persists; links and visitors remain independent; server snapshot is untouched.')
            browser.close()
    finally:
        http.shutdown()
        http.server_close()
