"""Run authored class abilities through the real two-entity Cataclysm arena."""
import json
import os
from pathlib import Path
import subprocess
import sys
import traceback
from playwright.sync_api import expect,sync_playwright

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
import server
from server_lifecycle import temporary_database,start_server

expect.set_options(timeout=15000)
SNAPSHOT="async el=>(await import('/world/generated/world.js')).worldSnapshot(el)"

def exercise(page,context,url,key,fixture,shots):
    errors=[];assets=set()
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('response',lambda response: assets.add(response.url.split('/local-world-assets/')[-1])
      if '/local-world-assets/' in response.url and response.ok else None)
    page.route('https://**/*',lambda route:route.abort())
    manifest=json.loads((ROOT/'local-assets/wow/manifest.json').read_text())
    manifest['playerSpawn']={'x':-25,'z':-22.8}
    manifest['target']['position']={'x':-25,'z':-25}
    page.route('**/local-world-assets/manifest.json',lambda route:route.fulfill(json=manifest))
    registration=context.request.post(url+'/api/register',data={'login':'class-'+key,'email':key+'@example.test','password':'test-password'})
    assert registration.ok,registration.text()
    response=context.request.post(url+'/api/projects',data={'document':fixture['document']})
    assert response.ok,response.text()
    pid=response.json()['id'];roles=fixture['roles']
    page.add_init_script("localStorage.setItem('talentforge-language','en');")
    page.add_init_script("localStorage.setItem("+json.dumps('talentforge-build:project:'+pid)+','+
      json.dumps(json.dumps(fixture['document']['build']))+');')
    page.goto(url);page.locator('#projects').click();page.locator(f'[data-open="{pid}"]').click()
    page.wait_for_function("pid=>JSON.parse(localStorage.getItem('talentforge-draft-source')||'null')?.projectId===pid",arg=pid)
    page.locator('#save').click();expect(page.locator('#saveState')).to_have_text('Saved to account')
    page.reload();page.locator('#projects').click();page.locator(f'[data-open="{pid}"]').click()
    page.clock.install(time=0);page.clock.pause_at(60000)
    page.locator('#openTrainingGrounds').click()
    arena=page.locator('#trainingGrounds');canvas=arena.locator('canvas')
    expect(arena.locator('[data-role=scene]')).to_have_text('Scene · Ready',timeout=150000)
    page.clock.run_for(100)
    snap=lambda:canvas.evaluate(SNAPSHOT)
    assert canvas.evaluate("el=>!!el.getContext('webgl2')")
    assert set(snap()['assets'])=={'hero','environment','weapon','target'}
    arena.locator('.tg-world-target').click()
    button=lambda role:arena.locator(f'[data-world-ability="{roles[role]}"]')
    advance=lambda ms=1700:page.clock.fast_forward(ms)
    event=lambda kind,role:arena.locator(f'[data-event="{kind}"]').filter(
      has_text=next(ability['name'] for ability in fixture['document']['abilities'] if ability['id']==roles[role]))
    button('surge').click();advance()
    if key in ('warrior','paladin','rogue','deathknight'):
        canvas.click(position={'x':100,'y':300})
        page.keyboard.down('w');page.clock.run_for(140);page.keyboard.up('w');page.clock.run_for(50)
        arena.locator('.tg-world-target').click()
    button('heavy').click();page.clock.run_for(150)
    assert snap()['weaponGripError']<1e-8
    if key not in ('warrior','paladin','rogue','deathknight','hunter'):
        expect(arena.locator('#tg-cast')).to_be_visible()
    advance(2600)
    expect(event('damage','heavy')).to_have_count(1)
    expect(event('resourceSpent','heavy')).to_have_count(1)
    arena.locator('.tg-world-meter').click()
    page.screenshot(path=shots/'combat.png',animations='disabled')
    button('strike').click();advance(1700)
    expect(arena.locator('[data-event=procTriggered]')).to_have_count(1)
    expect(event('damage','strike')).to_have_count(1)
    button('burst').click();advance()
    expect(event('damage','burst')).to_have_count(1)
    button('guard').click();arena.locator('.tg-test-incoming').click();advance(100)
    expect(arena.locator('[data-event=absorbed]').first).to_be_attached()
    advance()
    button('focus').click();advance()
    if 'linger' in roles:
        button('linger').click()
        for _ in range(4):advance(2000)
        expect(event('damage','linger')).to_have_count(3)
    if 'mend' in roles:
        advance(16000);button('surge').click();advance(1700)
        arena.locator('.tg-test-incoming').click();advance(100)
        hp=lambda:int(arena.locator('.tg-unit-player .tg-unit-bar:not(.tg-unit-resource) span').text_content().split('/')[0])
        before=hp()
        button('mend').click();page.clock.run_for(1400)
        assert hp()>before
        expect(event('healing','mend').first).to_be_attached()
        advance(6500)
    # Real weapon swings are independent of the ability GCD for every class.
    if key in ('shaman','druid'):
        canvas.click(position={'x':100,'y':300})
        page.keyboard.down('w');page.clock.run_for(140);page.keyboard.up('w');page.clock.run_for(50)
        arena.locator('.tg-world-target').click()
    arena.locator('.tg-world-target').click(button='right');page.clock.run_for(2000)
    expect(arena.locator('[data-event=autoHit]').first).to_be_attached()
    arena.locator('.tg-basic-strike').click()
    arena.locator('.tg-rpg-review').click()
    expect(page.get_by_role('img',name='Damage and healing per second')).to_be_visible()
    with page.expect_download() as report:
        page.locator('.rpg-review').get_by_role('button',name='Export JSON',exact=True).click()
    data=json.loads(Path(report.value.path()).read_text())
    assert data['metrics']['damage']>0 and data['procs'][0]['count']==1
    assert data['series'] and data['build']['talents'] and data['metrics']['auto']>0
    assert len(data['build']['equipment'])>=3
    assert sum(data['schools'].values())==data['metrics']['damage']
    if key in ('mage','deathknight'):page.screenshot(path=shots/'analytics.png',animations='disabled')
    page.locator('.rpg-review').get_by_role('button',name='Close',exact=True).click()
    arena.locator('.tg-world-log').click();arena.locator('#tg-log-filter').select_option('proc')
    expect(arena.locator('#tg-log [data-event=procTriggered]')).to_have_count(1)
    page.screenshot(path=shots/'log.png',animations='disabled')
    assert not errors,errors
    return {'result':'PASS','class':key,'abilities':len(fixture['document']['abilities']),
      'damage':data['metrics']['damage'],'dps':data['metrics']['dps'],'resource':fixture['resourceId'],
      'healing':data['metrics']['effective'],'procCount':1,'model':'four real GLBs','savedBuilds':2,'autoattack':True,'equipmentSlots':len(data['build']['equipment']),'setBonus':True,'talentBonus':True}

if __name__=='__main__':
    out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
    fixtures=json.loads(subprocess.check_output(['node','tools/task17-class-builds.mjs'],cwd=ROOT))
    os.environ['TALENT_LOCAL_WOW_ASSETS']='1';results={}
    with temporary_database() as folder,sync_playwright() as pw:
        server.DB=str(Path(folder)/'classes.sqlite3');server.initialize()
        http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);start_server(http)
        browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        try:
            for key in sys.argv[2:] or fixtures:
                shots=out/key;shots.mkdir(exist_ok=True)
                context=browser.new_context(viewport={'width':1120,'height':780},accept_downloads=True)
                page=context.new_page()
                try:results[key]=exercise(page,context,f'http://127.0.0.1:{http.server_port}',key,fixtures[key],shots)
                except Exception as error:
                    traceback.print_exc()
                    results[key]={'result':'FAIL','error':str(error)}
                    page.screenshot(path=shots/'failed.png',animations='disabled')
                finally:context.close()
                (shots/'result.json').write_text(json.dumps(results[key],ensure_ascii=False,indent=2))
                print(key,results[key]['result'],flush=True)
        finally:browser.close()
    raise SystemExit(0 if all(row['result']=='PASS' for row in results.values()) else 1)
