"""Editor and persistence fixture test. This script does not load real GLB assets."""
import json
from pathlib import Path
import sys
from playwright.sync_api import expect,sync_playwright
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
import server
from server_lifecycle import temporary_database,start_server
from rpg_fixture import document
expect.set_options(timeout=12000)

def run(page,context,url,shots):
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.route('https://**/*',lambda route:route.abort())
    doc=document();doc['rpg']['level']=85
    doc['rpg']['combatRules']={'version':'cataclysm-4.3.4','classId':'mage','targetLevel':88}
    doc['rpg']['items']=[{'id':'hood','name':'Training Hood','type':'cloth','slot':'head','icon':'forge-arcane','level':85,'quality':'rare','stats':{'intellect':100},'setId':'arcanist'}]
    doc['rpg']['equipped']={'head':'hood'}
    doc['rpg']['setBonuses']=[{'id':'set','name':'Arcanist','setId':'arcanist','pieces':1,'stats':{'spellPower':30}}]
    assert context.request.post(url+'/api/register',data={'login':'lab-owner','email':'lab@example.test','password':'test-password'}).ok
    response=context.request.post(url+'/api/projects',data={'document':doc});assert response.ok,response.text()
    pid=response.json()['id'];page.add_init_script("localStorage.setItem('talentforge-language','en')")
    page.goto(url);page.locator('#projects').click();page.locator(f'[data-open="{pid}"]').click()
    page.locator('#characterLab').click();lab=page.locator('.rpg-lab')
    lab.get_by_label('Enable level progression').check()
    lab.get_by_label('Progression base level').fill('80')
    lab.get_by_label('Health per level').fill('20')
    lab.get_by_label('Intellect per level').fill('2')
    lab.get_by_label('Mana per level').fill('5')
    lab.get_by_label('Training mode').select_option('survival')
    expect(lab.get_by_label('Measurement duration, seconds')).to_have_value('60')
    page.screenshot(path=shots/'01-level-progression.png')
    lab.get_by_role('button',name='Equipment',exact=True).click()
    expect(lab.get_by_label('Set identifier').first).to_have_value('arcanist')
    lab.get_by_label('Item roll seed').fill('42')
    lab.get_by_role('button',name='Roll item statistics',exact=True).click()
    expect(lab.get_by_role('button',name='Restore unrolled statistics')).to_be_visible()
    with page.expect_download() as result:lab.get_by_role('button',name='Export item').click()
    item=json.loads(Path(result.value.path()).read_text())['item']
    assert item['roll']['seed']==42 and item['roll']['baseStats']['intellect']==100
    assert 80<=item['stats']['intellect']<=120
    rolled=item['stats']['intellect']
    page.screenshot(path=shots/'02-item-roll-set.png')
    page.locator('#submitModal').click();page.locator('#save').click()
    expect(page.locator('#saveState')).to_have_text('Saved to account')
    saved=context.request.get(url+'/api/projects/'+pid).json()['document']
    assert saved['rpg']['progression']=={'baseLevel':80,'healthPerLevel':20,'attributesPerLevel':{'intellect':2},'resourcePerLevel':{'mana':5}}
    assert saved['rpg']['items'][0]['stats']['intellect']==rolled
    assert saved['rpg']['trainingMode']=='survival' and saved['rpg']['testDuration']==60
    page.reload();page.locator('#projects').click();page.locator(f'[data-open="{pid}"]').click();page.locator('#characterLab').click()
    expect(page.locator('.rpg-lab').get_by_label('Health per level')).to_have_value('20')
    assert not errors,errors
    print('PASS editor fixtures, custom progression, survival duration, item roll seed, set configuration, API save and browser reload; no real-model claim')

if __name__=='__main__':
    shots=Path(sys.argv[1]);shots.mkdir(parents=True,exist_ok=True)
    with temporary_database() as folder,sync_playwright() as pw:
        server.DB=str(Path(folder)/'lab.sqlite3');server.initialize()
        http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);start_server(http)
        browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True);page=context.new_page()
        try:run(page,context,f'http://127.0.0.1:{http.server_port}',shots)
        except Exception:
            page.screenshot(path=shots/'failed.png');raise
        finally:browser.close()
