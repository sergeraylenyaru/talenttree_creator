"""Actual user-supplied Wowhead XML through server/UI, not a live HTTP claim.

Uses isolated SQLite. No GLB loading is needed for this equipment import test.
"""
import json,sys
from pathlib import Path
from unittest.mock import patch
from playwright.sync_api import expect,sync_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
import server,wowhead_items as wh
from server_lifecycle import temporary_database,start_server,stop_server
expect.set_options(timeout=15000)
RAW=(ROOT/'tests/fixtures/wowhead-cata/19019.xml').read_bytes()

def open_project(page,url,pid):
 page.goto(url);page.locator('#projects').click();page.locator(f'[data-open="{pid}"]').click()

def setup(page,ctx,url,shots):
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('https://**/*',lambda r:r.abort())
 assert ctx.request.post(url+'/api/register',data={'login':'thunderfury-test','email':'actual19019@example.test','password':'test-password'}).ok
 doc=json.loads((ROOT/'tests/fixtures/training-grounds.json').read_text());doc['abilities']=[];doc['build']={}
 for branch in doc['branches']:branch['talents']=[]
 doc['rpg']={'version':1,'level':85,'restrictions':{'dualWield':True},'combatRules':{'version':'cataclysm-4.3.4','classId':'warrior'}}
 response=ctx.request.post(url+'/api/projects',data={'document':doc});assert response.ok,response.text();pid=response.json()['id'];open_project(page,url,pid)
 page.locator('#characterLab').click();lab=page.locator('.rpg-lab');lab.get_by_role('button',name='Equipment',exact=True).click();panel=lab.locator('.wowhead-import');panel.locator(':scope > summary').click()
 calls=[]
 def source(item_id):
  calls.append(item_id);assert item_id==19019;return RAW
 def preview(value):
  panel.get_by_label('Item link or ID',exact=True).fill(value);panel.get_by_role('button',name='Load preview',exact=True).click();expect(panel.get_by_role('button',name='Add independent copy',exact=True)).to_be_visible();expect(panel).to_contain_text('Thunderfury, Blessed Blade of the Windseeker');expect(panel).to_contain_text('Cataclysm (/cata)')
 def confirm():panel.get_by_role('button',name='Add independent copy',exact=True).click();return lab.get_by_label('Edit item',exact=True).input_value()
 def saved():return ctx.request.get(url+f'/api/projects/{pid}').json()['document']
 with patch.object(wh,'fetch_xml',side_effect=source):
  preview('19019');assert not saved()['rpg'].get('items',[]);expect(panel).to_contain_text('Appearance ID (not a statistic)');expect(panel).to_contain_text('Durability (wear is not simulated)');expect(panel).to_contain_text('jsonUse effects require manual setup');page.screenshot(path=shots/'01-19019-preview.png',animations='disabled');panel.locator('.wowhead-source').scroll_into_view_if_needed();page.screenshot(path=shots/'01b-19019-metadata.png',animations='disabled')
  first=confirm();expect(lab.get_by_label('Main Hand',exact=True)).to_have_value('');assert not saved()['rpg'].get('items',[])
  preview('https://www.wowhead.com/cata/item=19019&xml');second=confirm();assert first!=second;expect(lab.get_by_label('Minimum weapon damage',exact=True)).to_have_value(str(43.999998855590825));expect(lab.get_by_label('Weapon speed, seconds',exact=True)).to_have_value('1.9')
  lab.get_by_label('Edit item',exact=True).select_option(first);lab.get_by_label('Minimum weapon damage',exact=True).fill('50');lab.get_by_label('Maximum weapon damage',exact=True).fill('120');lab.get_by_label('Main Hand',exact=True).select_option(first)
  lab.get_by_label('Off Hand',exact=True).select_option(second);expect(lab.locator(':scope > [role=status]')).to_contain_text('Unique-equipped item already equipped');expect(lab.get_by_label('Off Hand',exact=True)).to_have_value('')
  lab.get_by_label('Main Hand',exact=True).select_option(second);lab.get_by_label('Edit item',exact=True).select_option(second);expect(lab.get_by_label('Minimum weapon damage',exact=True)).to_have_value(str(43.999998855590825));page.screenshot(path=shots/'02-19019-confirmed-equipment.png',animations='disabled')
  page.locator('#submitModal').click();page.locator('#save').click();expect(page.locator('#saveState')).to_have_text('Saved to account')
 assert calls==[19019,19019];document=saved();a,b=document['rpg']['items'];assert a['id']==first and b['id']==second;assert a['minDamage']==50 and b['minDamage']==43.999998855590825;assert b['stats']=={'agility':5,'stamina':8};assert b['uniqueGroup']=='wowhead-cata-19019';assert document['rpg']['equipped']['mainHand']==second;assert not document['rpg'].get('procs');assert not errors,errors
 return pid,document

def reopen(page,ctx,url,pid,document,shots):
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('https://**/*',lambda r:r.abort());open_project(page,url,pid);page.locator('#characterLab').click();lab=page.locator('.rpg-lab');lab.get_by_role('button',name='Equipment',exact=True).click();expect(lab.get_by_label('Edit item',exact=True).locator('option')).to_have_count(3)
 item=document['rpg']['items'][1];lab.get_by_label('Edit item',exact=True).select_option(item['id']);expect(lab.get_by_label('Minimum weapon damage',exact=True)).to_have_value(str(item['minDamage']));expect(lab.get_by_label('Main Hand',exact=True)).to_have_value(item['id']);assert ctx.request.get(url+f'/api/projects/{pid}').json()['document']['rpg']['items']==document['rpg']['items'];page.screenshot(path=shots/'03-19019-reopened-after-restart.png',animations='disabled');assert not errors,errors

if __name__=='__main__':
 shots=Path(sys.argv[1]);shots.mkdir(parents=True,exist_ok=True)
 with temporary_database() as folder,sync_playwright() as pw:
  server.DB=str(Path(folder)/'actual-19019.sqlite');server.initialize();http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);start_server(http);port=http.server_port;url=f'http://127.0.0.1:{port}'
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':1440,'height':1000});page=ctx.new_page()
  try:pid,document=setup(page,ctx,url,shots)
  except Exception:page.screenshot(path=shots/'failed.png');print('Form:',page.locator('#formError').text_content());raise
  finally:state=ctx.storage_state();browser.close();stop_server(http)
  http=server.ArchiveHTTPServer(('127.0.0.1',port),server.Handler);start_server(http);browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);ctx=browser.new_context(storage_state=state,viewport={'width':1440,'height':1000});page=ctx.new_page()
  try:
   with patch.object(wh,'fetch_xml',side_effect=AssertionError('Reopening must not use Wowhead')):reopen(page,ctx,url,pid,document,shots)
  except Exception:page.screenshot(path=shots/'failed-reopen.png');raise
  finally:browser.close();stop_server(http)
 print('PASS actual user-supplied 19019 XML: server parser, ID/link preview, metadata labels, explicit confirmation, independent copies, no autoequip, unique constraint, save and browser/server restart without source fetch. Successful imports use captured XML; live HTTP is checked separately. No GLB test.')
