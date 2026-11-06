"""Equipment icons, fit-based pages, custom-item return and resource bounds."""
import sys,tempfile,threading
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
sys.path.insert(0,str(Path(__file__).resolve().parents[1]));import server
with tempfile.TemporaryDirectory() as tmp:
 server.DB=str(Path(tmp)/'equipment.sqlite');server.initialize();http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);threading.Thread(target=http.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{http.server_port}'
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':1440,'height':1000});ctx.route('https://**/*',lambda route:route.abort());ctx.request.post(base+'/api/register',data={'login':'equipment_owner', 'email': 'equipment_owner@example.test','password':'test-password-123'})
   page=ctx.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)));page.goto(base);expect(page.locator('#user')).to_have_text('equipment_owner');page.locator('#characterSettings').click();page.locator('[data-resource-index="0"]').click();assert page.locator('#resourceUnit').input_value()=='percent'
   page.locator('#resourceMax').fill('100');page.locator('#resourceCurrent').fill('80');page.locator('#resourceDisplay').select_option('icons');assert page.locator('#resourceMax').input_value()=='20';assert page.locator('#resourceCurrent').input_value()=='20';assert page.locator('#resourceMax').get_attribute('max')=='20'
   page.locator('#resourceMax').fill('21');assert not page.locator('#resourceMax').evaluate('el=>el.checkValidity()');page.locator('#resourceMax').fill('20');page.locator('#resourceDisplay').select_option('bar');assert page.locator('#resourceMax').get_attribute('max')=='100000000'
   page.locator('#addResource').click();assert page.locator('#resourceUnit').input_value()=='percent';assert page.locator('#resourceMax').get_attribute('max')=='20'
   page.locator('[data-builder-tab="equipment"]').click();page.wait_for_function("document.querySelectorAll('[data-equipment=weaponTypes]').length===16")
   assert page.locator('#nextEquipment').count()==0;assert page.locator('.standard-equipment-icon').count()==21
   assert page.locator('[data-equipment="armorTypes"][value="cloth"]').evaluate("el=>el.nextElementSibling.src.endsWith('/inv_chest_cloth_17.jpg')")
   page.locator('[data-equipment="weaponTypes"][value="wand"]').check()
   page.locator('[data-new-custom="customWeaponTypes"]').click();page.locator('#customEquipmentName').fill('Astral blade');page.locator('#saveCustomEquipment').click();expect(page.locator('[data-builder-tab="equipment"]')).to_have_class('selected');assert page.locator('#modal').is_visible();assert page.locator('[data-custom-enabled="customWeaponTypes"]').is_checked()
   page.locator('[data-new-custom="customArmorTypes"]').click();page.locator('#customEquipmentName').fill('');page.locator('#saveCustomEquipment').click();assert page.locator('#customEquipmentName').is_visible();page.locator('#customEquipmentName').fill('Astral cloth');page.locator('#saveCustomEquipment').click()
   for width,height in [(768,600),(320,700),(390,844),(1440,1000)]:
    page.set_viewport_size({'width':width,'height':height});page.wait_for_function("document.querySelector('#modal').scrollHeight<=document.querySelector('#modal').clientHeight+1")
    assert page.locator('#modal').evaluate('el=>el.scrollWidth<=el.clientWidth+1')
    assert page.locator('#submitModal').evaluate('el=>el.getBoundingClientRect().bottom<=innerHeight')
   page.wait_for_function("document.querySelectorAll('[data-equipment=weaponTypes]').length===16")
   assert page.locator('#nextEquipment').count()==0
   page.locator('#submitModal').click();page.wait_for_function("!document.querySelector('#modal').open");page.locator('#save').click();expect(page.locator('#saveState')).to_have_text('Saved to account')
   pid=ctx.request.get(base+'/api/projects').json()['projects'][0]['id'];c=ctx.request.get(base+'/api/projects/'+pid).json()['document']['character'];assert c['resources'][1]['unit']=='percent';assert c['resources'][1]['max']<=20;assert c['customWeaponTypes'][0]['name']=='Astral blade';assert c['customArmorTypes'][0]['name']=='Astral cloth';assert c['weaponTypes']==['wand']
   assert not errors,errors
   print('PASS: standard WoW icons; all weapons visible when they fit; automatic compact pages on resize; custom save-and-return; percent defaults and twenty-symbol bounds.');browser.close()
 finally:http.shutdown();http.server_close()
