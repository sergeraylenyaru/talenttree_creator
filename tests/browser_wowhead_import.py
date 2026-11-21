"""Normal Chromium UI + real GLBs; mocked network serves fixed synthetic XML only."""
import json,os,re,sys
from pathlib import Path
from unittest.mock import patch
from playwright.sync_api import expect,sync_playwright
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
import server,wowhead_items as wh
from server_lifecycle import temporary_database,start_server,stop_server
expect.set_options(timeout=15000)
FIX=ROOT/'tests/fixtures/wowhead-cata'

class Source:
 def __init__(self):self.calls=[]
 def __call__(self,item_id):
  self.calls.append(item_id)
  if item_id==900098:raise wh.ImportError('source_blocked','Fixture source blocked',502)
  names={900001:'weapon',900002:'armor',900003:'ring',900004:'trinket'}
  if item_id not in names:raise wh.ImportError('not_found','Fixture item not found',404)
  return (FIX/(names[item_id]+'.xml')).read_bytes()

def open_project(page,url,pid):
 page.goto(url);page.locator('#projects').click();page.locator(f'[data-open="{pid}"]').click()

def author(page,context,url,shots,source):
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('https://**/*',lambda route:route.abort())
 page.add_init_script("localStorage.setItem('talentforge-language','en')")
 doc=json.loads((ROOT/'tests/fixtures/training-grounds.json').read_text())
 for b in doc['branches']:b['talents']=[]
 doc['build']={};doc['rpg']={'version':1,'level':85,'seed':13,'attributes':{'hitRating':10000,'expertiseRating':10000},'combatRules':{'version':'cataclysm-4.3.4','classId':'warrior','targetLevel':85,'position':'behind'},'hasteUses':['swing']}
 doc['abilities']=[{'id':'weapon-test','name':'Weapon calculation','icon':'forge-steel','kind':'active','learningMode':'base','description':'Uses imported weapon statistics','cast':0,'cooldown':0,'range':2,'resourceCosts':[],
  'presentation':{'delivery':'melee','targeting':'dummy','projectile':'none','attackAnimation':'sword','impact':'melee'},'workshop':{'version':1,'noGcd':True,'attackType':'melee','weaponHand':'mainHand'},
  'combatEffects':[{'id':'hit','type':'damage','trigger':'onHit','school':'physical','baseAmount':0,'weaponCoefficient':1,'scalingStat':'none','coefficient':0,'canCrit':False}]}]
 assert context.request.post(url+'/api/register',data={'login':'equipment-import','email':'equipment@example.test','password':'test-password'}).ok
 response=context.request.post(url+'/api/projects',data={'document':doc});assert response.ok,response.text();pid=response.json()['id'];open_project(page,url,pid)
 page.locator('#characterLab').click();lab=page.locator('.rpg-lab');lab.get_by_role('button',name='Equipment',exact=True).click();panel=lab.locator('.wowhead-import');panel.locator(':scope > summary').click()
 def preview(item):
  panel.get_by_label('Item link or ID',exact=True).fill(str(item));panel.get_by_role('button',name='Load preview',exact=True).click();expect(panel.get_by_role('button',name='Add independent copy',exact=True)).to_be_visible()
 def confirm():panel.get_by_role('button',name='Add independent copy',exact=True).click()
 def selected():return lab.get_by_label('Edit item',exact=True).input_value()
 preview('https://www.wowhead.com/cata/item=900001')
 assert context.request.get(url+f'/api/projects/{pid}').json()['document']['rpg'].get('items',[])==[]
 expect(panel).to_contain_text('Cataclysm (/cata)');expect(panel).to_contain_text('100');expect(panel).to_contain_text('140');assert page.evaluate('window.fixtureExecuted') is None
 page.screenshot(path=shots/'01-independent-preview.png',animations='disabled');confirm();first=selected();lab.get_by_role('button',name='Configure item effects',exact=True).click();expect(lab.get_by_role('button',name='Add trigger',exact=True)).to_be_visible();lab.get_by_role('button',name='Equipment',exact=True).click();preview(900001);confirm();second=selected();assert first!=second
 lab.get_by_label('Edit item',exact=True).select_option(first);lab.get_by_label('Minimum weapon damage',exact=True).fill('500');lab.get_by_label('Maximum weapon damage',exact=True).fill('700')
 lab.get_by_label('Edit item',exact=True).select_option(second);expect(lab.get_by_label('Minimum weapon damage',exact=True)).to_have_value('100')
 lab.get_by_label('Main Hand',exact=True).select_option(second)
 preview(900002);confirm();lab.get_by_role('button',name='Equip selected item',exact=True).click()
 preview(900003);confirm();ring1=selected();lab.get_by_label('Ring1',exact=True).select_option(ring1)
 lab.get_by_label('Ring2',exact=True).select_option(ring1);expect(lab.locator(':scope > [role=status]')).to_contain_text('already equipped')
 preview(900003);confirm();ring2=selected();lab.get_by_label('Ring2',exact=True).select_option(ring2)
 preview(900004);confirm();trinket=selected();lab.get_by_label('Trinket2',exact=True).select_option(trinket)
 count=len(source.calls);panel.get_by_label('Item link or ID',exact=True).fill('https://www.wowhead.com/item=19019');panel.get_by_role('button',name='Load preview',exact=True).click();expect(panel.locator('[role=status]')).to_have_text('Only Cataclysm (/cata) is supported.');assert len(source.calls)==count
 for item,message in [(900099,'Item not found.'),(900098,'Wowhead blocked the request or rate limited the source.')]:
  panel.get_by_label('Item link or ID',exact=True).fill(str(item));panel.get_by_role('button',name='Load preview',exact=True).click();expect(panel.locator('[role=status]')).to_have_text(message)
 lab.get_by_role('button',name='Statistics',exact=True).click();expect(lab.get_by_text('120',exact=True).first).to_be_visible()
 page.screenshot(path=shots/'02-derived-statistics.png',animations='disabled')
 lab.get_by_role('button',name='Combat Analytics',exact=True).click();lab.get_by_label('Build name',exact=True).fill('Imported equipment');lab.get_by_role('button',name='Save current build',exact=True).click()
 page.locator('#submitModal').click();page.locator('#save').click();expect(page.locator('#saveState')).to_have_text('Saved to account')
 saved=context.request.get(url+f'/api/projects/{pid}').json()['document'];items=saved['rpg']['items'];assert len(items)==6
 assert items[0]['minDamage']==500 and items[1]['minDamage']==100;assert items[0]['source']==items[1]['source'] or items[0]['source']['responseSha256']==items[1]['source']['responseSha256']
 assert saved['rpg']['equipped']['mainHand']==second;assert saved['rpg']['equipped']['ring1']!=saved['rpg']['equipped']['ring2'];assert saved['rpg']['equipped']['trinket2']==trinket
 assert len(saved['rpg']['builds'][0]['combatSnapshot']['rpg']['items'])==6;assert not errors,errors
 return pid,saved

def reopen_and_fight(page,context,url,pid,saved,shots):
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('https://**/*',lambda route:route.abort());page.add_init_script("localStorage.setItem('talentforge-language','en')")
 manifest=json.loads((ROOT/'local-assets/wow/manifest.json').read_text());manifest['playerSpawn']={'x':-26.5,'z':-26};manifest['target']['position']={'x':-25,'z':-26}
 page.route('**/local-world-assets/manifest.json',lambda route:route.fulfill(json=manifest))
 preview_requests=[];page.on('request',lambda request:preview_requests.append(request.url) if '/api/items/wowhead/' in request.url else None)
 open_project(page,url,pid);page.locator('#characterLab').click();lab=page.locator('.rpg-lab');lab.get_by_role('button',name='Equipment',exact=True).click();expect(lab.get_by_label('Edit item',exact=True).locator('option')).to_have_count(7)
 assert not preview_requests;assert context.request.get(url+f'/api/projects/{pid}').json()['document']['rpg']['items']==saved['rpg']['items']
 page.screenshot(path=shots/'03-reopened-without-source.png',animations='disabled');page.locator('#closeModal').click()
 page.clock.install(time=0);page.clock.pause_at(60000);page.locator('#openTrainingGrounds').click();arena=page.locator('#trainingGrounds');expect(arena.locator('[data-role=scene]')).to_have_text('Scene · Ready',timeout=150000)
 canvas=arena.locator('canvas');page.clock.run_for(100);assert canvas.evaluate("el=>!!el.getContext('webgl2')")
 snapshot=canvas.evaluate("async el=>(await import('/world/generated/world.js')).worldSnapshot(el)");assert set(snapshot['assets'])=={'hero','environment','weapon','target'};assert snapshot['weaponGripError']<1e-8
 arena.locator('.tg-world-target').click();arena.locator('[data-world-ability=weapon-test]').click();page.clock.run_for(1000);expect(arena.locator('[data-event=damage]')).to_have_count(1)
 arena.locator('.tg-rpg-review').click();review=page.locator('.rpg-review')
 with page.expect_download() as downloaded:review.get_by_role('button',name='Export JSON',exact=True).click()
 report=json.loads(Path(downloaded.value.path()).read_text());(shots/'combat-report.json').write_text(json.dumps(report,indent=2))
 damage=next(e for e in report['timeline'] if e['type']=='damage');assert 117<=damage['amount']<=157,damage;assert damage['calculation']['attackPower']==120;assert report['build']['equipment']['mainHand']['source']['itemId']==900001
 assert not errors,errors;assert not preview_requests;page.screenshot(path=shots/'04-real-combat-report.png',animations='disabled')
 print('PASS fixed XML through server parser, preview/confirmation, weapon/armor/ring/trinket, independent copies, paired slots, source errors, derived AP120, saved build, browser/server restart, offline source reopening, real GLBs/WebGL2 and imported weapon combat damage',damage['amount'])

if __name__=='__main__':
 shots=Path(sys.argv[1]);shots.mkdir(parents=True,exist_ok=True);os.environ['TALENT_LOCAL_WOW_ASSETS']='1'
 with temporary_database() as folder,sync_playwright() as pw:
  server.DB=str(Path(folder)/'equipment.sqlite');server.initialize();http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);start_server(http);port=http.server_port;url=f'http://127.0.0.1:{port}'
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']);context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True);page=context.new_page();source=Source()
  try:
   with patch.object(wh,'fetch_xml',side_effect=source):pid,saved=author(page,context,url,shots,source)
   state=context.storage_state();browser.close();stop_server(http)
   http=server.ArchiveHTTPServer(('127.0.0.1',port),server.Handler);start_server(http)
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']);context=browser.new_context(storage_state=state,viewport={'width':1440,'height':1000},accept_downloads=True);page=context.new_page()
   with patch.object(wh,'fetch_xml',side_effect=AssertionError('Saved items must not fetch Wowhead')):reopen_and_fight(page,context,url,pid,saved,shots)
  except Exception:
   page.screenshot(path=shots/'failed.png',animations='disabled');raise
  finally:browser.close()
