"""Editor data preservation and contextual controls; no 3D assets/visual claim."""
import json,sys
from pathlib import Path
from playwright.sync_api import expect,sync_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
import server
from server_lifecycle import temporary_database,start_server,stop_server

def run(page,ctx,url):
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.add_init_script("localStorage.setItem('talentforge-language','en')")
 assert ctx.request.post(url+'/api/register',data={'login':'editor-fields','email':'fields@example.test','password':'test-password'}).ok
 doc=json.loads((ROOT/'tests/fixtures/training-grounds.json').read_text());doc['build']={}
 for branch in doc['branches']:branch['talents']=[]
 ability={'id':'test','name':'Preserved burn','icon':'forge-ember','description':'Saved settings','kind':'active','learningMode':'base','cast':0,'cooldown':3,'range':30,'resourceCosts':[],
 'presentation':{'category':'spell','delivery':'ranged','targeting':'dummy','projectile':'homing','projectileSpeed':17,'trajectory':'arc','arcHeight':.8},
 'workshop':{'version':1,'charges':2,'recharge':9,'homingStrength':5,'color':'#ff7529'},
 'combatEffects':[{'id':'hit','type':'damage','trigger':'onHit','school':'fire','baseAmount':100,'coefficient':.2,'scalingStat':'spellPower','canCrit':True,'duration':8,'interval':2,'stacks':3,'refresh':'keep','tickPolicy':'restart','multiplier':1.7,'flatBonus':5}]}
 doc['abilities']=[ability];response=ctx.request.post(url+'/api/projects',data={'document':doc});assert response.ok,response.text();pid=response.json()['id']
 page.goto(url);page.locator('#projects').click();page.locator(f'[data-open="{pid}"]').click();page.locator('[data-ability=test]').first.click()
 expect(page.locator('#abilityDescription')).to_be_visible();expect(page.locator('[data-presentation=targeting]')).to_be_visible();expect(page.locator('[data-key=interval]')).to_be_visible();expect(page.locator('[data-key=refresh]')).not_to_be_visible();expect(page.locator('[data-key=coefficient]')).not_to_be_visible();expect(page.locator('[data-presentation=projectileSpeed]')).to_have_value('17')
 # Several live-summary reads, including invalid and reverted text, cannot change stored effects.
 page.locator('[data-key=baseAmount]').fill('');page.locator('[data-key=baseAmount]').fill('100');expect(page.locator('.ability-live-summary')).to_contain_text('Damage: 100')
 page.locator('#abilityName').fill('Renamed burn');page.locator('#submitModal').click();page.locator('#save').click();expect(page.locator('#saveState')).to_have_text('Saved to account')
 saved=ctx.request.get(url+f'/api/projects/{pid}').json()['document']['abilities'][0];assert saved['combatEffects']==ability['combatEffects'],saved;assert saved['presentation']==ability['presentation'];assert saved['workshop']==ability['workshop']
 # Hidden projectile fields remain independent data when switching to melee delivery.
 page.locator('[data-ability=test]').first.click();page.locator('[data-presentation=delivery]').select_option('melee');expect(page.locator('[data-presentation=projectile]')).not_to_be_visible();page.locator('#submitModal').click();page.locator('#save').click();expect(page.locator('#saveState')).to_have_text('Saved to account')
 saved=ctx.request.get(url+f'/api/projects/{pid}').json()['document']['abilities'][0];assert saved['presentation']=={**ability['presentation'],'delivery':'melee'};assert saved['workshop']==ability['workshop'];assert saved['combatEffects']==ability['combatEffects']
 # Control type and duration stay visible; DR remains advanced. Removing a draft effect leaves the original intact.
 page.locator('[data-ability=test]').first.click();page.locator('[data-add]').click();row=page.locator('[data-combat-row]').nth(1);row.locator('[data-key=type]').select_option('control');expect(row.locator('[data-key=controlType]')).to_be_visible();expect(row.locator('[data-key=duration]')).to_be_visible();expect(row.locator('[data-key=drGroup]')).not_to_be_visible();row.locator('[data-remove]').click();page.locator('#submitModal').click()
 # Channel controls appear in the same basic editor. Explicit mode change configures a legal channel.
 page.locator('[data-ability=test]').first.click();page.locator('#abilityCastMode').select_option('channel');expect(page.locator('[data-presentation=channelDuration]')).to_be_visible();expect(page.locator('[data-workshop=tickInterval]')).to_be_visible();expect(page.locator('#cast')).not_to_be_visible();page.locator('[data-workshop=tickInterval]').fill('1');page.locator('#submitModal').click();page.locator('#save').click();expect(page.locator('#saveState')).to_have_text('Saved to account')
 saved=ctx.request.get(url+f'/api/projects/{pid}').json()['document']['abilities'][0];assert saved['presentation']['channelDuration']==3;assert saved['workshop']['tickInterval']==1;assert saved['presentation']['projectileSpeed']==17;assert saved['combatEffects']==ability['combatEffects']
 # New authored abilities must fill genuinely empty slots, including a formerly practice-only class.
 empty={**doc,'name':'Initially empty','abilities':[]};response=ctx.request.post(url+'/api/projects',data={'document':empty});assert response.ok,response.text();empty_id=response.json()['id'];page.locator('#projects').click();page.locator(f'[data-open="{empty_id}"]').click()
 page.route('**/world/generated/world.js',lambda route:route.abort())
 page.locator('#openTrainingGrounds').click();expect(page.locator('.tg-world-status')).to_have_text('Build the module with npm run build:world.');page.locator('#tg-return').click();page.locator('#addAbility').click();page.get_by_text('Ability templates',exact=True).click();page.locator('#workshopTemplate').select_option(label='Quick Strike');page.locator('#applySpellTemplate').click();page.locator('#submitModal').click();authored=page.evaluate("JSON.parse(localStorage.getItem('talentforge-draft')).abilities[0].id");page.locator('#openTrainingGrounds').click();expect(page.locator(f'.tg-hotbar [data-world-ability="{authored}"]')).to_have_count(1);expect(page.locator('.tg-hotbar [data-world-ability=__training_spark]')).to_have_count(0);expect(page.locator('[data-world-slot]')).to_have_count(18)
 assert not errors,errors
 print('PASS practice-only to first authored skill hotbar reconciliation with deliberately unavailable 3D; no model claim')
 print('PASS actual shared editor: periodic/control visibility, hidden aura/scaling/projectile/advanced values, invalid-then-reverted numeric input, independent summary, save/reopen, melee delivery and legal channel controls; no 3D assets used')

if __name__=='__main__':
 with temporary_database() as folder,sync_playwright() as pw:
  server.DB=str(Path(folder)/'fields.sqlite');server.initialize();http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);start_server(http)
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':1440,'height':1000});page=ctx.new_page()
  try:run(page,ctx,f'http://127.0.0.1:{http.server_port}')
  finally:browser.close();stop_server(http)
