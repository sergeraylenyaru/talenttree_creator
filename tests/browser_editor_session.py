"""Chromium UI continuity tests with all four actual private GLBs and isolated DB."""
import json,os,sys
from pathlib import Path
from playwright.sync_api import expect,sync_playwright
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
import server
from server_lifecycle import temporary_database,start_server,stop_server
expect.set_options(timeout=15000)

def session(page):return page.evaluate("async ()=>(await import('/training-grounds/training-grounds.js')).trainingSessionSnapshot(document.querySelector('#trainingGrounds'))")
def world(page):return page.locator('#trainingGrounds canvas').evaluate("async el=>(await import('/world/generated/world.js')).worldSnapshot(el)")
def invariant(page):
 s=session(page);w=world(page)
 return {'sessionId':s['sessionId'],'runtime':{k:v for k,v in s['runtime'].items() if k!='paused'},'auto':s['auto'],'offhand':s.get('offhand'),'world':{k:w[k] for k in ['player','orbit','selected','activeClip','camera','attacks','weaponPosition']},'layout':page.locator('.tg-unit-player,.tg-unit-target,.tg-world-actions,#tg-cast').evaluate_all("els=>els.map(el=>el.getAttribute('style'))"),'slots':page.locator('[data-world-slot]').evaluate_all("els=>els.map(el=>[el.dataset.worldAbility,el.title,el.disabled])")}

def equal(actual,expected,label):
 if actual==expected:return
 Path('/tmp/session-actual.json').write_text(json.dumps(actual,indent=2,ensure_ascii=False))
 Path('/tmp/session-expected.json').write_text(json.dumps(expected,indent=2,ensure_ascii=False))
 raise AssertionError(label+' (see /tmp/session-actual.json and /tmp/session-expected.json)')

def run(page,context,url,shots):
 errors=[];page.on('pageerror',lambda error:errors.append(str(error)));page.route('https://**/*',lambda route:route.abort())
 page.add_init_script("localStorage.setItem('talentforge-language','ru')")
 manifest=json.loads((ROOT/'local-assets/wow/manifest.json').read_text());manifest['playerSpawn']={'x':-26.5,'z':-26};manifest['target']['position']={'x':-25,'z':-26}
 page.route('**/local-world-assets/manifest.json',lambda route:route.fulfill(json=manifest))
 doc=json.loads((ROOT/'tests/fixtures/training-grounds.json').read_text());doc['rpg']={'version':1,'seed':19}
 doc['abilities']=[];doc['build']={}
 for branch in doc['branches']:branch['talents']=[]
 def spell(id,name,cast=0,projectile='none',duration=None):
  a={'id':id,'name':name,'description':'Проверка редактирования','icon':'forge-ember','kind':'active','learningMode':'base','cast':cast,'cooldown':3,'range':30,'resourceCosts':[{'resourceId':'mana','amount':5,'unit':'points'}],
   'workshop':{'version':1,'noGcd':True},'presentation':{'category':'spell','delivery':'ranged','targeting':'dummy','projectile':projectile,'projectileSpeed':1,'impact':'fire'},
   'combatEffects':[{'id':'hit','type':'damage','trigger':'onHit','school':'fire','baseAmount':100,'scalingStat':'none','coefficient':0,'canCrit':False}]}
  if duration:a['combatEffects'][0].update(duration=duration,interval=2,stacks=3)
  return a
 doc['branches'][0]['talents']=[{'id':'learn-extra','row':0,'col':0,'name':'Выучить талант','maxRank':1,'descriptions':['Открывает способность.'],'icon':'forge-arcane','grantedAbilityId':'talent-spell'}]
 doc['abilities']=[spell('bolt','Огненный шар',2),spell('burn','Горение',duration=10),spell('missile','Снаряд',projectile='homing'),spell('quick','Быстрый огонь'),{**spell('talent-spell','Талант'), 'learningMode':'talent','talentId':'learn-extra'}]
 assert context.request.post(url+'/api/register',data={'login':'session-author','email':'session@example.test','password':'test-password','language':'ru'}).ok
 assert context.request.post(url+'/api/profile/settings',data={'language':'ru'}).ok
 response=context.request.post(url+'/api/projects',data={'document':doc});assert response.ok,response.text();pid=response.json()['id']
 page.goto(url);page.locator('#projects').click();page.locator(f'[data-open="{pid}"]').click()
 page.clock.install(time=0);page.clock.pause_at(60000);page.locator('#openTrainingGrounds').click();arena=page.locator('#trainingGrounds');expect(arena.locator('[data-role=scene]')).to_have_text('Сцена · Готово',timeout=150000)
 page.clock.run_for(100);canvas=arena.locator('canvas');assert canvas.evaluate("el=>!!el.getContext('webgl2')");assert set(world(page)['assets'])=={'hero','environment','weapon','target'}
 page.evaluate("window.retainedCanvas=document.querySelector('#trainingGrounds canvas')")
 arena.locator('.tg-world-target').click();canvas.focus();page.keyboard.down('KeyA');page.clock.run_for(80);page.keyboard.up('KeyA');page.clock.run_for(32)
 # Orbit and zoom are also session state.
 box=canvas.bounding_box();page.mouse.move(box['x']+box['width']*.55,box['y']+box['height']*.45);page.mouse.down(button='right');page.mouse.move(box['x']+box['width']*.55+30,box['y']+box['height']*.45+12);page.mouse.up(button='right');page.clock.run_for(100)
 arena.locator('.tg-layout-toggle').click();handle=arena.get_by_role('button',name='Настроить интерфейс · Герой',exact=True);bounds=handle.bounding_box();page.mouse.move(bounds['x']+bounds['width']/2,bounds['y']+bounds['height']/2);page.mouse.down();page.mouse.move(bounds['x']+bounds['width']/2+28,bounds['y']+bounds['height']/2-35);page.mouse.up();arena.locator('.tg-layout-toggle').click()
 arena.locator('.tg-world-actions > details > summary').click();arena.locator('.tg-slot-settings select').nth(17).select_option('burn');arena.locator('.tg-world-actions > details > summary').click()
 arena.locator('.tg-hotbar [data-world-ability=burn]').first.click();page.clock.run_for(300);arena.locator('[data-world-ability=bolt]').click();page.clock.run_for(400)
 assert session(page)['runtime']['state']['activeCast'];assert session(page)['runtime']['statuses']
 entry=invariant(page);arena.locator('#tg-return').click();before=invariant(page);assert 0<=before['runtime']['state']['combatTime']-entry['runtime']['state']['combatTime']<.017
 for cycle in range(3):
  if cycle:arena.locator('#tg-return').click()
  assert session(page)['held'];page.clock.fast_forward(60000);equal(invariant(page),before,'exact resume')
  page.locator('#openTrainingGrounds').click();equal(invariant(page),before,'exact resume');assert not session(page)['runtime']['paused'];assert page.evaluate("window.retainedCanvas===document.querySelector('#trainingGrounds canvas')")
 print('PASS exact 3 tree cycles',flush=True)
 # Context menu pauses both world and runtime; no cast or autoattack from RMB.
 slot=arena.locator('.tg-hotbar [data-world-ability=bolt]');slot.click(button='right');expect(page.get_by_role('menuitem',name='Редактировать',exact=True)).to_be_visible();page.screenshot(path=shots/'01-context-menu.png',animations='disabled');assert session(page)['runtime']['paused'];assert not session(page)['auto']['status']['active'];page.clock.fast_forward(10000);equal(invariant(page),before,'exact resume')
 page.keyboard.press('Escape');expect(page.get_by_role('menu')).to_have_count(0);assert not session(page)['runtime']['paused']
 slot.click(button='right');arena.locator('#tg-pause').click();expect(page.get_by_role('menu')).to_have_count(0);assert session(page)['runtime']['paused'];arena.locator('#tg-pause').click();assert not session(page)['runtime']['paused'];equal(invariant(page),before,'outside menu close')
 slot.click(button='right');page.get_by_role('menuitem',name='Редактировать',exact=True).click();expect(page.locator('#abilityName')).to_be_visible();assert session(page)['runtime']['paused']
 page.locator('#abilityName').fill('Огненный шар 500');page.locator('[data-key=baseAmount]').fill('500');page.locator('#abilityDescription').fill('');page.keyboard.type('wasd 123 обычный текст');page.clock.fast_forward(20000);equal(invariant(page),before,'exact resume')
 page.screenshot(path=shots/'02-simple-editor.png',animations='disabled');page.locator('#submitModal').click();page.clock.run_for(1);expect(page.locator('#modal')).not_to_be_visible();assert not session(page)['runtime']['paused'];assert session(page)['runtime']['state']['activeCast']['ability']['name']=='Огненный шар';assert session(page)['sessionId']==before['sessionId'];expect(slot).to_have_attribute('title',__import__('re').compile('Огненный шар 500'))
 page.clock.fast_forward(1800);events=session(page)['runtime']['state']['combatLog'];assert [e['amount'] for e in events if e['type']=='damage' and e['abilityId']=='bolt']==[100]
 page.clock.fast_forward(3500);slot.click();page.clock.fast_forward(2100);events=session(page)['runtime']['state']['combatLog'];assert [e['amount'] for e in events if e['type']=='damage' and e['abilityId']=='bolt']==[100,500]
 print('PASS menu/editor and old100/new500 cast',flush=True)
 # Inflight homing projectile freezes over tree round trips, retaining old config.
 arena.locator('[data-world-ability=missile]').click();page.clock.run_for(40);assert session(page)['runtime']['pending']==1;arena.locator('#tg-return').click();flight=invariant(page);page.clock.fast_forward(45000);equal(invariant(page),flight,'projectile resume');page.locator('#openTrainingGrounds').click();equal(invariant(page),flight,'projectile resume');page.clock.fast_forward(3500);assert session(page)['runtime']['pending']==0
 # Cancel restores original ability and previously paused state.
 arena.locator('#tg-pause').click();paused=invariant(page);slot.click(button='right');page.get_by_role('menuitem',name='Редактировать',exact=True).click();page.locator('#abilityName').fill('Discard me');page.locator('#closeModal').click();page.clock.run_for(1);assert session(page)['runtime']['paused'];equal(invariant(page),paused,'paused cancel')
 # One manual key generates one new cast after all the previous resume cycles.
 arena.locator('#tg-pause').click();page.clock.fast_forward(4000);canvas.focus();count=sum(e['type']=='castStarted' and e['abilityId']=='quick' for e in session(page)['runtime']['state']['combatLog']);page.keyboard.press('Digit4');page.clock.run_for(100);assert sum(e['type']=='castStarted' and e['abilityId']=='quick' for e in session(page)['runtime']['state']['combatLog'])==count+1
 # Delete uses the same editor/save lifecycle and removes all broken slot refs.
 arena.locator('.tg-hotbar [data-world-ability=quick]').click(button='right');page.get_by_role('menuitem',name='Редактировать',exact=True).click();page.once('dialog',lambda d:d.accept());page.locator('#deleteItem').click();page.clock.run_for(1);expect(arena.locator('[data-world-ability=quick]')).to_have_count(0);assert not session(page)['runtime']['paused']
 # Basic attack and empty slots never create a fake editor/menu.
 arena.locator('.tg-hotbar [data-world-ability=__training_strike]').click(button='right');expect(page.get_by_role('menu')).to_have_count(0);arena.locator('[data-world-slot="17"]').click(button='right');expect(page.get_by_role('menu')).to_have_count(0)
 print('PASS projectile, cancel, paused state, key, delete and empty/basic slots',flush=True)
 # Active autoattack retains its scheduled hit and cooldown across the tree pause.
 arena.locator('.tg-hotbar [data-world-ability=__training_strike]').click();page.clock.run_for(100);assert session(page)['auto']['status']['active'];arena.locator('#tg-return').click();auto_state=invariant(page);page.clock.fast_forward(50000);equal(invariant(page),auto_state,'autoattack pause');page.locator('#openTrainingGrounds').click();equal(invariant(page),auto_state,'autoattack resume');arena.locator('.tg-hotbar [data-world-ability=__training_strike]').click()
 # Unlock a talent and alter max HP/resources using existing tree and character editors.
 arena.locator('#tg-return').click();stats_before=session(page)['runtime'];page.locator('#playMode').click();page.locator('[data-talent=learn-extra]').click();page.locator('#editMode').click();page.locator('#characterSettings').click();page.locator('#builderHp').fill('700');page.locator('[data-resource-index="0"]').click();page.locator('#resourceMax').fill('50');page.locator('#resourceCurrent').fill('50');page.locator('#submitModal').click();page.locator('#openTrainingGrounds').click();assert session(page)['sessionId']==before['sessionId'];assert session(page)['runtime']['state']['player']['health']==700;assert session(page)['runtime']['state']['player']['resources']['mana']['current']==min(50,stats_before['state']['player']['resources']['mana']['current']);expect(arena.locator('.tg-hotbar [data-world-ability=talent-spell]')).to_be_visible();assert session(page)['runtime']['state']['combatLog']==stats_before['state']['combatLog']
 # Read-only calculator mode never exposes a mutating menu.
 arena.locator('#tg-return').click();page.locator('#playMode').click();page.locator('#openTrainingGrounds').click();slot.click(button='right');expect(page.get_by_role('menu')).to_have_count(0);arena.locator('#tg-return').click();page.locator('#editMode').click()
 page.locator('#save').click();expect(page.locator('#saveState')).to_have_text('Сохранено в аккаунте');saved=context.request.get(url+f'/api/projects/{pid}').json()['document'];assert saved['abilities'][0]['name']=='Огненный шар 500';assert saved['abilities'][0]['combatEffects'][0]['baseAmount']==500;assert saved['abilities'][0]['presentation']['projectileSpeed']==1;assert 'quick' not in [a['id'] for a in saved['abilities']]
 print('PASS autoattack, stats and talents',flush=True)
 # Another project needs an explicit choice and does not discard the retained fight.
 other={**doc,'name':'Other class'};response=context.request.post(url+'/api/projects',data={'document':other});assert response.ok,response.text();other_id=response.json()['id'];old_session=session(page)['sessionId'];page.locator('#projects').click();page.locator(f'[data-open="{other_id}"]').click();page.locator('#openTrainingGrounds').click();expect(page.locator('.tg-session-choice')).to_be_visible();assert session(page)['sessionId']==old_session;page.get_by_role('button',name='Остаться в дереве',exact=True).click();assert session(page)['held'];page.locator('#projects').click();page.locator(f'[data-open="{pid}"]').click();page.locator('#openTrainingGrounds').click();assert session(page)['sessionId']==old_session;assert page.evaluate("window.retainedCanvas===document.querySelector('#trainingGrounds canvas')");arena.locator('#tg-return').click()
 page.reload();page.locator('#projects').click();page.locator(f'[data-open="{pid}"]').click();page.locator('[data-ability="bolt"]').first.click();expect(page.locator('#abilityName')).to_have_value('Огненный шар 500');expect(page.locator('[data-key=baseAmount]')).to_have_value('500')
 expect(page.locator('[data-presentation=castingAnimation] optgroup[label=GLB]')).to_be_attached(timeout=120000)
 expect(page.locator('[data-presentation=impactAnimation] optgroup[label=GLB]')).to_be_attached(timeout=120000)
 assert not errors,errors
 print('PASS actual four GLBs/WebGL2; retained canvas/runtime, 3 exact round trips, active cast/DoT/cooldown/projectile, old100/new500, RNG/time/vitals/camera/slots, RMB save/cancel/delete/prior pause, auto swing preservation, talent unlock, max vital clamp, readonly and incompatible-class choice, no duplicate cast, source save/reload')

if __name__=='__main__':
 shots=Path(sys.argv[1]);shots.mkdir(parents=True,exist_ok=True);os.environ['TALENT_LOCAL_WOW_ASSETS']='1'
 with temporary_database() as folder,sync_playwright() as pw:
  server.DB=str(Path(folder)/'session.sqlite');server.initialize();http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);start_server(http);url=f'http://127.0.0.1:{http.server_port}'
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']);context=browser.new_context(viewport={'width':1440,'height':1000});page=context.new_page()
  try:run(page,context,url,shots)
  except Exception:page.screenshot(path=shots/'failed.png',animations='disabled');print('BROWSER ERRORS',page.locator('#formError').text_content() if page.locator('#formError').count() else 'no UI',page.locator('.tg-game-feedback').text_content() if page.locator('.tg-game-feedback').count() else 'no HUD');raise
  finally:browser.close();stop_server(http)
