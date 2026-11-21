"""Verify control, DR, cleanse, immunity and reset in the real two-entity scene."""
import json
import os
from pathlib import Path
import sys
from playwright.sync_api import expect,sync_playwright

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
import server
from server_lifecycle import start_server,temporary_database
expect.set_options(timeout=20000)

def ability(key,effects,self_target=False,cooldown=0):
    return {'id':key,'name':key,'icon':'forge-arcane','description':'Control test','kind':'active','learningMode':'base',
      'cast':0,'cooldown':cooldown,'range':20,'resourceCosts':[],
      'workshop':{'version':1,'noGcd':True},
      'presentation':{'delivery':'ranged','projectile':'none','targeting':'self' if self_target else 'dummy','impact':'arcane'},
      'combatEffects':effects}

def control(key,target='dummy',**extra):
    return {'id':'control','type':'control','trigger':'onCast' if target=='player' else 'onHit',
      'controlType':key,'name':key,'duration':4,'target':target,**extra}

def run(page,context,url,shots):
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.route('https://**/*',lambda route:route.abort())
    manifest=json.loads((ROOT/'local-assets/wow/manifest.json').read_text())
    manifest['playerSpawn']={'x':-25,'z':-20}
    manifest['target']['position']={'x':-25,'z':-26}
    page.route('**/local-world-assets/manifest.json',lambda route:route.fulfill(json=manifest))
    doc=json.loads((ROOT/'tests/fixtures/training-grounds.json').read_text())
    for branch in doc['branches']:branch['talents']=[]
    doc['build']={}
    doc['abilities']=[
      ability('stun',[control('stun',drGroup='stun')]),
      ability('root',[control('root','player',dispelType='magic')],True),
      ability('cleanse',[{'id':'dispel','type':'dispel','trigger':'onCast','target':'player','dispelType':'magic','count':1}],True),
      ability('immunity',[control('immunity','player')],True,20),
      ability('reset',[{'id':'reset','type':'cooldown','trigger':'onCast','abilityId':'immunity','seconds':0,'reset':True}],True)
    ]
    doc['rpg']={'version':1,'incoming':{'school':'physical','amount':200}}
    assert context.request.post(url+'/api/register',data={'login':'controls','email':'controls@example.test','password':'test-password'}).ok
    response=context.request.post(url+'/api/projects',data={'document':doc})
    assert response.ok,response.text()
    pid=response.json()['id']
    page.add_init_script("localStorage.setItem('talentforge-language','en')")
    page.goto(url);page.locator('#projects').click();page.locator(f'[data-open="{pid}"]').click()
    page.locator('#spellLibrary').click()
    page.locator('[data-spell-id=root] [data-spell-action=edit]').click()
    expect(page.locator('[data-key=type]')).to_have_value('control')
    page.locator('[data-key=target]').select_option('player')
    page.locator('[data-key=controlType]').select_option('root')
    page.screenshot(path=shots/'01-control-editor.png')
    page.locator('#submitModal').click()
    expect(page.locator('#spellLibraryRows')).to_be_visible()
    page.locator('#closeModal').click()
    page.locator('#save').click();expect(page.locator('#saveState')).to_have_text('Saved to account')
    assert context.request.get(url+'/api/projects/'+pid).json()['document']['abilities'][1]['combatEffects'][0]['controlType']=='root'
    page.clock.install(time=0);page.clock.pause_at(60000)
    page.locator('#openTrainingGrounds').click()
    arena=page.locator('#trainingGrounds')
    expect(arena.locator('[data-role=scene]')).to_have_text('Scene · Ready',timeout=150000)
    canvas=arena.locator('canvas')
    assert canvas.evaluate("el=>!!el.getContext('webgl2')")
    snap=lambda:canvas.evaluate("async el=>(await import('/world/generated/world.js')).worldSnapshot(el)")
    page.clock.run_for(100)
    assert set(snap()['assets'])=={'hero','environment','weapon','target'}
    arena.locator('.tg-world-target').click()
    button=lambda key:arena.locator(f'[data-world-ability="{key}"]')
    for duration in [4,2,1]:
        button('stun').click()
        expect(arena.locator('.tg-debuffs .tg-status-effect')).to_have_count(1)
        page.clock.fast_forward(duration*1000+30)
    button('stun').click()
    expect(arena.locator('[data-event=controlImmune]')).to_have_count(1)
    button('root').click()
    z=snap()['player']['z']
    canvas.click(position={'x':120,'y':300})
    page.keyboard.down('w');page.clock.run_for(300);page.keyboard.up('w')
    assert abs(snap()['player']['z']-z)<.03
    button('cleanse').click()
    expect(arena.locator('[data-event=dispelled]')).to_have_count(1)
    canvas.click(position={'x':120,'y':300})
    page.keyboard.down('w');page.clock.run_for(300);page.keyboard.up('w')
    assert snap()['player']['z']<z-.5
    button('immunity').click()
    arena.locator('.tg-test-incoming').click()
    expect(arena.locator('[data-event=immune]')).to_have_count(1)
    expect(arena.locator('.tg-unit-player .tg-unit-bar:not(.tg-unit-resource)')).to_contain_text(f'{doc["character"]["hp"]} / {doc["character"]["hp"]}')
    expect(button('immunity')).to_have_attribute('data-state','cooldown')
    button('reset').click()
    expect(button('immunity')).to_have_attribute('data-state','')
    arena.locator('.tg-world-log').click()
    page.screenshot(path=shots/'02-control-combat.png',animations='disabled')
    assert not errors,errors
    print('PASS actual models, control editor persistence, DR 4/2/1/immune, root blocks WASD, cleanse restores movement, immunity and cooldown reset')

if __name__=='__main__':
    shots=Path(sys.argv[1]);shots.mkdir(parents=True,exist_ok=True)
    os.environ['TALENT_LOCAL_WOW_ASSETS']='1'
    with temporary_database() as folder,sync_playwright() as pw:
        server.DB=str(Path(folder)/'controls.sqlite3');server.initialize()
        http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);start_server(http)
        browser=pw.chromium.launch(executable_path='/usr/bin/chromium',
          args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        try:
            context=browser.new_context(viewport={'width':1366,'height':900})
            run(context.new_page(),context,f'http://127.0.0.1:{http.server_port}',shots)
        finally:browser.close()
