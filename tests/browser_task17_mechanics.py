"""Actual GLB combat verification for queue, pushback, runes, finishers, auras and HUD layout."""
import json
import os
from pathlib import Path
import sys
from playwright.sync_api import expect,sync_playwright
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
import server
from server_lifecycle import temporary_database,start_server
expect.set_options(timeout=12000)

def hit(amount=30,school='fire'):
    return {'id':'hit','type':'damage','trigger':'onHit','school':school,'baseAmount':amount,'coefficient':0,'scalingStat':'none','canCrit':False}
def status(key,stat,amount,target='player'):
    return {'id':key.replace(' ','-'),'type':'status','trigger':'onCast','name':key,'stat':stat,'amount':amount,'target':target,'duration':20}
def ability(key,effects,own=False,**extra):
    return {'id':key,'name':key,'icon':'forge-arcane','description':'Authored Task 17 scenario','kind':'active','learningMode':'base',
      'cast':0,'cooldown':0,'range':20,'resourceCosts':[],
      'presentation':{'delivery':'ranged','targeting':'self' if own else 'dummy','projectile':'none','impact':'arcane'},
      'workshop':{'version':1,'noGcd':True},'combatEffects':effects,**extra}

def run(page,context,url,shots):
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('https://**/*',lambda route:route.abort())
    manifest=json.loads((ROOT/'local-assets/wow/manifest.json').read_text())
    manifest['playerSpawn']={'x':-25,'z':-20};manifest['target']['position']={'x':-25,'z':-26}
    page.route('**/local-world-assets/manifest.json',lambda route:route.fulfill(json=manifest))
    doc=json.loads((ROOT/'tests/fixtures/training-grounds.json').read_text())
    for branch in doc['branches']:branch['talents']=[]
    doc['build']={};doc['character']['hp']=5000
    doc['character']['resources'][0]['current']=100
    doc['character']['resources'][1].update(max=3,current=3)
    doc['character']['resources'][2].update(id='blood',name='Blood Runes',max=2,current=2,unit='count')
    doc['rpg']={'version':1,'level':85,'seed':13,'combatRules':{'version':'cataclysm-4.3.4','classId':'mage','targetLevel':85,'position':'behind'},
      'hasteUses':['periodic'],'attributes':{'haste':50,'spellHitRating':10000,'hitRating':10000,'expertiseRating':10000,'critChance':0},
      'bonuses':[{'id':'stance-bonus','owner':{'kind':'ability','id':'battle'},'state':{'key':'stance','value':'battle'},'spell':'strike','stat':'damage','amount':50}],
      'resources':{'blood':{'rune':True,'recharge':10}},'incoming':{'amount':100,'school':'physical'}}
    doc['rpg']['procs']=[
      {'id':'chain-one','name':'Chain one','owner':{'kind':'ability','id':'chain'},'event':'damage','sourceAbilityId':'chain','chance':1,'cooldown':0,'priority':2,'charges':1,'spell':'payload-one','effect':'hit'},
      {'id':'chain-two','name':'Chain two','owner':{'kind':'ability','id':'chain'},'event':'damage','sourceAbilityId':'payload-one','chance':1,'cooldown':0,'priority':1,'chain':True,'spell':'payload-two','effect':'hit'},
      {'id':'two-crits','name':'Two criticals','owner':{'kind':'ability','id':'critical'},'event':'criticalDamage','sourceAbilityId':'critical','school':'fire','every':2,'consecutive':True,'chance':1,'cooldown':0,'spell':'crit-resource','effect':'gain'}
    ]
    doc['abilities']=[
      ability('cast',[hit()],cast=2,resourceCosts=[{'resourceId':'mana','amount':10,'unit':'points'}],workshop={'version':1}),
      ability('queued',[hit()],resourceCosts=[{'resourceId':'mana','amount':10,'unit':'points'}],workshop={'version':1}),
      ability('clarity',[status('Clarity','critChance',0)],True),
      ability('free',[hit()],resourceCosts=[{'resourceId':'mana','amount':100,'unit':'points'}],workshop={'version':1,'noGcd':True,'freeWithAura':'Clarity','consumeFreeAura':True}),
      ability('finisher',[hit()],resourceCosts=[{'resourceId':'charges','amount':1,'unit':'count'}],workshop={'version':1,'noGcd':True,'finisherResource':'charges','finisherScale':1}),
      ability('rune',[hit(10)],resourceCosts=[{'resourceId':'blood','amount':1,'unit':'count'}]),
      ability('guard',[{'id':'ward','type':'shield','trigger':'onCast','name':'Ward','target':'player','amount':100,'fraction':1,'priority':10,'coefficient':0,'duration':20},status('Mirror','reflectDamage',50)],True),
      ability('target-ward',[{'id':'ward','type':'shield','trigger':'onCast','name':'Target ward','target':'dummy','amount':50,'fraction':1,'priority':10,'coefficient':0,'duration':20,'school':'fire'}]),
      ability('auras',[status('Exposed','armor',-20,'dummy'),{'id':'slow','type':'control','trigger':'onCast','name':'Slow','target':'player','controlType':'slow','amount':20,'duration':20}]),
      ability('knock',[{'id':'knock','type':'control','trigger':'onHit','name':'Knock','target':'dummy','controlType':'knockback','amount':2,'duration':1}]),
      ability('strike',[hit(100,'physical')]),
      ability('cap',[{**hit(1000),'cap':75}]),
      ability('haste-dot',[{**hit(10),'duration':6,'interval':2}]),
      ability('chain',[hit(30)]),
      ability('critical',[{**hit(50),'canCrit':True}]),
      ability('crit-buff',[status('Critical focus','critChance',100)],True),
      ability('payload-one',[hit(10,'arcane')],kind='passive'),
      ability('payload-two',[hit(20,'shadow')],kind='passive'),
      ability('crit-resource',[{'id':'gain','type':'resource','trigger':'onCast','resourceId':'mana','amount':5,'unit':'points'}],kind='passive'),
      ability('bleed',[{**hit(100,'physical'),'damageKind':'bleed'}]),
      ability('battle',[{'id':'state','type':'state','trigger':'onCast','key':'stance','value':'battle'}],True)
    ]
    assert context.request.post(url+'/api/register',data={'login':'mechanics','email':'mechanics@example.test','password':'test-password'}).ok
    response=context.request.post(url+'/api/projects',data={'document':doc});assert response.ok,response.text()
    pid=response.json()['id']
    page.add_init_script("localStorage.setItem('talentforge-language','en');localStorage.setItem('talentforge-training-grounds-v1',JSON.stringify({dummy:{armor:26070}}))")
    page.goto(url);page.locator('#projects').click();page.locator(f'[data-open="{pid}"]').click()
    page.clock.install(time=0);page.clock.pause_at(60000)
    page.locator('#openTrainingGrounds').click();arena=page.locator('#trainingGrounds')
    expect(arena.locator('[data-role=scene]')).to_have_text('Scene · Ready',timeout=150000)
    canvas=arena.locator('canvas');snap=lambda:canvas.evaluate("async el=>(await import('/world/generated/world.js')).worldSnapshot(el)")
    page.clock.run_for(100);assert set(snap()['assets'])=={'hero','environment','weapon','target'}
    assert canvas.evaluate("el=>!!el.getContext('webgl2')")
    arena.locator('.tg-world-target').click()
    cast=lambda key:arena.locator(f'[data-world-ability="{key}"]').click()
    events=lambda kind:arena.locator(f'[data-event="{kind}"]')
    mana=lambda:arena.locator('.tg-unit-player .tg-unit-resource span').text_content()
    cast('cast');page.clock.run_for(500);arena.locator('.tg-test-incoming').click()
    expect(events('castPushback')).to_have_count(1)
    page.clock.run_for(1700);cast('queued')
    expect(events('castQueued')).to_have_count(1)
    page.clock.run_for(500)
    expect(events('damage')).to_have_count(2);expect(events('resourceSpent')).to_have_count(2)
    assert mana()=='80 / 100',mana()
    page.screenshot(path=shots/'01-queue-pushback.png',animations='disabled')
    page.clock.fast_forward(1600)
    cast('clarity');cast('free');page.clock.run_for(100)
    assert mana()=='80 / 100'
    expect(arena.locator('.tg-unit-player .tg-status-effect')).to_have_count(0)
    cast('finisher');page.clock.run_for(100)
    expect(events('damage').filter(has_text='finisher')).to_contain_text('90')
    cast('rune');page.clock.run_for(50);cast('rune');page.clock.run_for(50)
    expect(arena.locator('[data-resource-id=blood]')).to_contain_text('0 / 2')
    page.clock.fast_forward(10000)
    expect(arena.locator('[data-resource-id=blood]')).to_contain_text('1 / 2')
    page.clock.fast_forward(10000)
    expect(arena.locator('[data-resource-id=blood]')).to_contain_text('2 / 2')
    cast('guard');cast('target-ward');cast('auras');page.clock.run_for(100)
    for unit in ['player','target']:
        for rail in ['buffs','debuffs']:
            expect(arena.locator(f'.tg-unit-{unit} .tg-{rail} .tg-status-effect').first).to_be_attached()
    expect(arena.locator('.tg-unit-player .tg-absorb')).to_contain_text('100')
    arena.locator('.tg-test-incoming').click();page.clock.run_for(100)
    expect(events('absorbed')).to_have_count(1)
    expect(arena.locator('.tg-unit-player .tg-absorb')).to_have_text('')
    arena.locator('.tg-test-incoming').click();page.clock.run_for(100)
    expect(events('reflected')).to_have_count(1)
    cast('strike');page.clock.run_for(100)
    expect(arena.locator('.tg-unit-target .tg-absorb')).to_contain_text('50')
    cast('battle');cast('strike');page.clock.run_for(100)
    expect(events('damage').filter(has_text='strike').first).to_contain_text('83')
    cast('bleed');page.clock.run_for(100)
    expect(events('damage').filter(has_text='bleed')).to_contain_text('100')
    # Preserve a moved panel and verify the next arena session restores it.
    arena.locator('.tg-layout-toggle').click()
    handle=arena.locator('.tg-unit-player .tg-layout-handle')
    box=handle.bounding_box();page.mouse.move(box['x']+15,box['y']+8);page.mouse.down();page.mouse.move(120,220,steps=6);page.mouse.up()
    arena.locator('.tg-layout-toggle').click()
    position=arena.locator('.tg-unit-player').bounding_box();
    assert 180<position['y']<260,position
    page.screenshot(path=shots/'02-four-aura-rails-layout.png',animations='disabled')
    cast('cap');page.clock.run_for(100)
    expect(events('damage').filter(has_text='cap')).to_contain_text('25')
    cast('haste-dot');page.clock.fast_forward(7000)
    expect(events('damage').filter(has_text='haste-dot')).to_have_count(5)
    cast('chain');page.clock.run_for(100)
    expect(events('procTriggered')).to_have_count(2)
    cast('crit-buff');cast('critical');page.clock.run_for(100);cast('critical');page.clock.run_for(100)
    expect(events('procTriggered')).to_have_count(3)
    expect(events('damage').filter(has_text='critical')).to_have_count(2)
    assert mana()=='85 / 100',mana()
    page.screenshot(path=shots/'04-procs-haste-critical.png',animations='disabled')
    before=snap()['dummy'];cast('knock');page.clock.run_for(100)
    after=snap()['dummy'];assert sum((a-b)**2 for a,b in zip(before,after))>.1,(before,after)
    assert snap()['weaponGripError']<1e-8
    page.screenshot(path=shots/'03-knockback.png',animations='disabled')
    arena.locator('#tg-return').click()
    page.locator('#openTrainingGrounds').click()
    expect(arena.locator('[data-role=scene]')).to_have_text('Scene · Ready',timeout=150000)
    page.clock.run_for(100)
    restored=arena.locator('.tg-unit-player').bounding_box()
    assert abs(restored['y']-position['y'])<2,(position,restored)
    assert not errors,errors
    print('PASS actual GLBs, queue after pushback, one payment, free cast aura, 3-point finisher, rune serial recovery, four aura rails, school shield, absorption, reflection, bleed, final cap, periodic haste, proc chain, consecutive critical proc, state modifier, collision-constrained knockback, weapon grip, HUD layout persistence')

if __name__=='__main__':
    shots=Path(sys.argv[1]);shots.mkdir(parents=True,exist_ok=True)
    os.environ['TALENT_LOCAL_WOW_ASSETS']='1'
    with temporary_database() as folder,sync_playwright() as pw:
        server.DB=str(Path(folder)/'mechanics.sqlite3');server.initialize()
        http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);start_server(http)
        browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        context=browser.new_context(viewport={'width':1200,'height':820});page=context.new_page()
        try:run(page,context,f'http://127.0.0.1:{http.server_port}',shots)
        except Exception:
            page.screenshot(path=shots/'failed.png',animations='disabled');raise
        finally:browser.close()
