"""Actual four private GLBs; authored combat data, no synthetic GLB fixtures."""
import json
import os
from pathlib import Path
import re
import sys
from playwright.sync_api import expect,sync_playwright
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
import server
from server_lifecycle import temporary_database,start_server
from browser_task17_mechanics import ability,hit,status
expect.set_options(timeout=15000)

def exercise(page,context,url,shots):
    errors=[];loaded=set();page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('response',lambda res:loaded.add(res.url.split('/local-world-assets/')[-1]) if '/local-world-assets/' in res.url and res.status==200 else None)
    page.route('https://**/*',lambda route:route.abort())
    manifest=json.loads((ROOT/'local-assets/wow/manifest.json').read_text());manifest['playerSpawn']={'x':-23.5,'z':-26};manifest['target']['position']={'x':-25,'z':-26}
    page.route('**/local-world-assets/manifest.json',lambda route:route.fulfill(json=manifest))
    doc=json.loads((ROOT/'tests/fixtures/training-grounds.json').read_text())
    for branch in doc['branches']:branch['talents']=[]
    doc['build']={};doc['character']['hp']=5000;doc['character']['resources'][0].update(current=70)
    for rid in ['blood','death']:
        doc['character']['resources'].append({'id':rid,'name':rid,'max':2 if rid=='blood' else 6,'current':2 if rid=='blood' else 0,'unit':'count','display':'icons','shape':'circle','color':'#aa00ff'})
    doc['rpg']={'version':1,'level':85,'seed':13,'states':{'stance':'battle'},'restrictions':{'dualWield':True},'hasteUses':['swing','rune'],
      'combatRules':{'version':'cataclysm-4.3.4','classId':'mage','targetLevel':85,'position':'behind'},
      'attributes':{'masteryRating':179.28,'spellHitRating':10000,'hitRating':10000,'expertiseRating':10000},
      'resources':{'mana':{'kind':'custom'},'blood':{'kind':'rune','rune':True,'recharge':10},'death':{'kind':'rune','rune':True,'recharge':10}},
      'incoming':{'school':'fire','amount':50,'castTime':2},
      'items':[{'id':key,'name':key,'icon':'forge-steel','level':85,'quality':'rare','slot':slot,'type':'sword1' if slot=='mainHand' else 'dagger','minDamage':50,'maxDamage':50,'speed':speed,'stats':{}} for key,slot,speed in [('main','mainHand',2),('off','offHand',1.4)]],
      'equipped':{'mainHand':'main','offHand':'off'},
      'bonuses':[{'id':'mastery','owner':{'kind':'ability','id':'bolt'},'spell':'bolt','stat':'damage','amount':10,'masteryScale':1,
        'condition':{'type':'all','conditions':[{'type':'state','key':'stance','value':'battle'},{'type':'resourceAbove','resource':'mana','value':50}]}}],
      'procs':[{'id':'ppm','name':'Weapon PPM','owner':{'kind':'ability','id':'bolt'},'spell':'payload','effect':'gain','event':'damage','attackType':'auto','chance':1,'ppm':6,'cooldown':0,'charges':1}]}
    doc['abilities']=[
      ability('bolt',[hit(100)],resourceCosts=[{'resourceId':'mana','amount':10,'unit':'points'}],presentation={'delivery':'ranged','targeting':'dummy','projectile':'straight','projectileSpeed':8,'impact':'fire'}),
      ability('interrupt',[{'id':'interrupt','type':'control','trigger':'onHit','target':'dummy','name':'Interrupt','controlType':'interrupt','school':'fire','duration':4}]),
      ability('buff-one',[{**status('power-one','damageDone',10),'category':'power'}],True),ability('buff-two',[{**status('power-two','damageDone',20),'category':'power'}],True),
      ability('dot',[{**hit(10),'duration':4,'interval':1,'snapshot':True,'tickPolicy':'preserve'}]),
      ability('channel',[hit(10)],resourceCosts=[{'resourceId':'mana','amount':10,'unit':'points'}],presentation={'delivery':'ranged','targeting':'dummy','projectile':'none','channelDuration':4},workshop={'version':1,'noGcd':True,'tickInterval':1}),
      ability('blood',[{'id':'convert','type':'rune','trigger':'onCast','fromResource':'blood','toResource':'death','count':1}],True,resourceCosts=[{'resourceId':'blood','amount':1,'unit':'count'}]),
      ability('rune-spend',[hit(10)],resourceCosts=[{'resourceId':'blood','amount':2,'unit':'count'}],workshop={'version':1,'noGcd':True,'runeSubstitute':'death'}),
      ability('payload',[{'id':'gain','type':'resource','trigger':'onCast','resourceId':'mana','unit':'points','amount':5}],True,kind='passive')]
    assert context.request.post(url+'/api/register',data={'login':'integration','email':'integration@example.test','password':'test-password'}).ok
    response=context.request.post(url+'/api/projects',data={'document':doc});assert response.ok,response.text();pid=response.json()['id']
    page.add_init_script("localStorage.setItem('talentforge-language','en');localStorage.setItem('talentforge-training-grounds-v1',JSON.stringify({stats:{critChance:0},dummy:{armor:0}}))")
    page.goto(url);page.locator('#projects').click();page.locator(f'[data-open="{pid}"]').click()
    page.locator('#spellLibrary').click();page.locator('[data-spell-id=bolt] [data-spell-action=edit]').click()
    page.locator('summary').filter(has_text='Advanced settings').click()
    page.locator('summary').filter(has_text='Cast rules').click()
    page.locator('[data-workshop=attackType]').select_option('spell');page.locator('[data-workshop=weaponHand]').select_option('mainHand')
    page.locator('[data-workshop=swingPolicy]').select_option('pause')
    page.locator('summary').filter(has_text='Charges and global cooldown').click()
    page.locator('[data-workshop=cooldownGroup]').fill('shared-test');page.locator('[data-workshop=groupCooldown]').fill('8')
    page.locator('#submitModal').click();page.locator('#closeModal').click()
    page.locator('#spellLibrary').click();page.locator('[data-spell-id=dot] [data-spell-action=edit]').click()
    page.locator('[data-key=tickPolicy]').select_option('restart');page.locator('#submitModal').click();page.locator('#closeModal').click()
    page.locator('#characterLab').click();lab=page.locator('.rpg-lab');lab.get_by_role('button',name='Abilities',exact=True).click()
    lab.get_by_label('Процент за очко искусности / % per mastery point').fill('2')
    lab.get_by_label('PPM (autoattack only)').fill('60');lab.get_by_label('Threshold',exact=True).fill('55')
    page.screenshot(path=shots/'01-constructor.png',animations='disabled')
    lab.get_by_role('button',name='Combat Analytics',exact=True).click();lab.get_by_label('Build name').fill('Mechanics checkpoint');lab.get_by_role('button',name='Save current build',exact=True).click()
    page.locator('#submitModal').click();page.locator('#save').click();expect(page.locator('#saveState')).to_have_text('Saved to account')
    saved=context.request.get(url+f'/api/projects/{pid}').json()['document']
    assert saved['rpg']['bonuses'][0]['masteryScale']==2;assert saved['rpg']['procs'][0]['ppm']==60
    assert saved['rpg']['builds'][0]['combatSnapshot']['abilities'][0]['workshop']['groupCooldown']==8
    page.reload();page.locator('#projects').click();page.locator(f'[data-open="{pid}"]').click()
    page.locator('#characterLab').click();lab.get_by_role('button',name='Combat Analytics',exact=True).click();lab.get_by_role('button',name='Load build',exact=True).click();page.locator('#submitModal').click()
    page.clock.install(time=0);page.clock.pause_at(60000)
    page.locator('#openTrainingGrounds').click();arena=page.locator('#trainingGrounds');expect(arena.locator('[data-role=scene]')).to_have_text('Scene · Ready',timeout=150000)
    canvas=arena.locator('canvas');snap=lambda:canvas.evaluate("async el=>(await import('/world/generated/world.js')).worldSnapshot(el)")
    page.clock.run_for(100);assert canvas.evaluate("el=>!!el.getContext('webgl2')");assert set(snap()['assets'])=={'hero','environment','weapon','target'}
    assert {'character/hero.glb','targets/Training-dummy.glb','weapons/sword-one-hand.glb','world/guildhouseb.glb'}<=loaded
    arena.locator('.tg-world-target').click();cast=lambda key:arena.locator(f'[data-world-ability="{key}"]').click()
    events=lambda kind:arena.locator(f'[data-event="{kind}"]')
    cast('bolt');page.clock.run_for(1000);expect(events('damage')).to_have_count(1);expect(events('damage')).to_contain_text('128')
    expect(events('resourceSpent')).to_have_count(1);expect(arena.locator('[data-world-ability=bolt]')).to_have_attribute('data-state','cooldownGroup');cast('bolt');expect(events('resourceSpent')).to_have_count(1)
    arena.locator('.tg-test-incoming').click();page.clock.run_for(500);expect(arena.locator('#tg-dummy-cast')).to_be_visible()
    page.screenshot(path=shots/'02-dummy-cast.png',animations='disabled');cast('interrupt');page.clock.run_for(100)
    expect(events('dummyCastInterrupted')).to_have_count(1);expect(arena.locator('#tg-dummy-cast')).to_be_hidden()
    page.clock.fast_forward(2500);expect(events('incomingDamage')).to_have_count(0)
    cast('buff-one');cast('buff-two');page.clock.run_for(100);expect(arena.locator('.tg-unit-player .tg-buffs .tg-status-effect')).to_have_count(1)
    arena.locator('#tg-reset').click();cast('dot');page.clock.run_for(500);cast('dot');page.clock.fast_forward(4000);expect(events('damage')).to_have_count(4)
    arena.locator('#tg-reset').click();cast('channel');expect(events('resourceSpent')).to_have_count(1)
    page.clock.run_for(500);arena.locator('#tg-cancel').click();page.clock.fast_forward(4000);expect(events('damage')).to_have_count(0);expect(events('resourceSpent')).to_have_count(1)
    arena.locator('#tg-reset').click();cast('blood');page.clock.fast_forward(10000);expect(arena.locator('[data-resource-id=death]')).to_contain_text('1 / 6')
    cast('rune-spend');page.clock.run_for(100);expect(events('resourceSpent')).to_have_count(3)
    page.clock.fast_forward(20000);expect(arena.locator('[data-resource-id=blood]')).to_contain_text('2 / 2');expect(arena.locator('[data-resource-id=death]')).to_contain_text('0 / 6')
    page.screenshot(path=shots/'03-runes.png',animations='disabled')
    arena.locator('#tg-reset').click();arena.locator('.tg-basic-strike').click();page.clock.fast_forward(10000)
    expect(events('procTriggered')).to_have_count(1)
    arena.locator('.tg-rpg-review').click();review=page.locator('.rpg-review')
    with page.expect_download() as download:review.get_by_role('button',name='Export JSON',exact=True).click()
    report=json.loads(Path(download.value.path()).read_text());(shots/'combat-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    hands={entry.get('hand') for entry in report['timeline'] if entry['type']=='damage'};assert {'mainHand','offHand'}<=hands,hands
    assert any(entry.get('position')=='front' for entry in report['timeline'] if entry['type']=='damage')
    assert any(entry.get('chance')==1 for entry in report['timeline'] if entry['type']=='procTriggered')
    assert snap()['weaponGripError']<1e-8;assert not errors,errors
    page.screenshot(path=shots/'04-analysis.png',animations='disabled')
    review.get_by_role('button',name='Close',exact=True).click();arena.locator('.tg-basic-strike').click();arena.locator('#tg-reset').click()
    canvas.focus();page.keyboard.down('ShiftLeft')
    for direction,duration in [('KeyS',900),('KeyA',1500),('KeyW',900)]:
        page.keyboard.down(direction);page.clock.run_for(duration);page.keyboard.up(direction)
    page.keyboard.up('ShiftLeft');page.clock.run_for(200)
    moved=snap();assert moved['player']['x']<moved['dummy'][0]-.5,moved['player'];assert abs(moved['dummyFacing']-1.57079632679)<1e-8
    cast('bolt');page.clock.run_for(1000);expect(events('damage')).to_have_count(1)
    arena.locator('.tg-rpg-review').click()
    with page.expect_download() as rear_download:page.locator('.rpg-review').get_by_role('button',name='Export JSON',exact=True).click()
    rear=json.loads(Path(rear_download.value.path()).read_text());assert any(e.get('position')=='behind' for e in rear['timeline'] if e['type']=='damage')
    (shots/'behind-report.json').write_text(json.dumps(rear,ensure_ascii=False,indent=2))
    page.locator('.rpg-review').get_by_role('button',name='Close',exact=True).click();page.screenshot(path=shots/'05-behind-dummy.png',animations='disabled')
    assert not errors,errors
    (shots/'saved-test-document.json').write_text(json.dumps(saved,ensure_ascii=False,indent=2))
    print('PASS actual GLBs/WebGL2, editor/server/reload/build, mastery 128, cooldown group, dummy interrupt, exclusive buffs, refresh clipping, channel payment/cancel, rune conversion/substitution, main/off hand clock, PPM, actual front geometry and exported ledger')

if __name__=='__main__':
    shots=Path(sys.argv[1]);shots.mkdir(parents=True,exist_ok=True);os.environ['TALENT_LOCAL_WOW_ASSETS']='1'
    with temporary_database() as folder,sync_playwright() as pw:
        server.DB=str(Path(folder)/'integration.sqlite3');server.initialize();http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);start_server(http)
        browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']);context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True);page=context.new_page()
        try:exercise(page,context,f'http://127.0.0.1:{http.server_port}',shots)
        except Exception:page.screenshot(path=shots/'failed.png',animations='disabled');raise
        finally:browser.close()
