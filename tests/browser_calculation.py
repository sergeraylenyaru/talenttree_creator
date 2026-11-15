"""Verify the independent calculation ES module loads and runs in Chromium."""
from pathlib import Path
import sys
import threading
import tempfile
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

temporary = tempfile.TemporaryDirectory()
server.DB = str(Path(temporary.name) / 'calculation.sqlite')
server.initialize()
http = server.ArchiveHTTPServer(('127.0.0.1', 0), server.Handler)
threading.Thread(target=http.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        # A static JSON resource provides a same-origin page without loading the app UI.
        page.goto(f'http://127.0.0.1:{http.server_port}/icon-catalog.json')
        result = page.evaluate('''async () => {
          const api = await import('/combat/calculation-engine.js');
          const effect = Object.freeze({id:'fire',type:'damage',trigger:'onHit',school:'fire',
            baseAmount:120,scalingStat:'spellPower',coefficient:0.65,canCrit:true});
          const context = Object.freeze({source:Object.freeze({spellPower:200,damageMultiplier:1.1,
            schoolDamageMultipliers:Object.freeze({fire:1.2})}),
            target:Object.freeze({resistances:Object.freeze({fire:1000})})});
          const before = JSON.stringify([effect,context]);
          const damage = api.calculateDamage(effect,context);
          const dispatched = api.calculateCombatEffect(effect,context);
          const heal = api.calculateHealing({id:'heal',type:'healing',trigger:'onCast',
            baseAmount:80,scalingStat:'none',coefficient:0,canCrit:false});
          return {damage:damage.finalAmount,dispatched:dispatched.finalAmount,healing:heal.finalAmount,
            reduction:api.calculateMitigation('fire',context.target).reduction,
            critical:api.rollCritical(0.25,0.2), unchanged:before===JSON.stringify([effect,context])};
        }''')
        assert result == {'damage':264, 'dispatched':264, 'healing':80, 'reduction':0.2,
                          'critical':True, 'unchanged':True}, result
        assert not errors, errors
        browser.close()
finally:
    http.shutdown()
    http.server_close()
    temporary.cleanup()
print('PASS: calculation ES module in Chromium, all five exports, frozen inputs and no script errors')
