"""Two authored mage trees retain isolated Fireballs across browser and server restart."""
import json
import sys
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import server
from server_lifecycle import start_server,stop_server,temporary_database

expect.set_options(timeout=15000)

def open_project(page,url,pid):
    page.goto(url)
    page.locator('#projects').click()
    page.locator(f'[data-open="{pid}"]').click()
    page.wait_for_function("pid => JSON.parse(localStorage.getItem('talentforge-draft-source') || 'null')?.projectId === pid", arg=pid)

def saved(context,url,pid):
    return context.request.get(url+'/api/projects/'+pid).json()['document']

def save(page):
    page.locator('#save').click()
    expect(page.locator('#saveState')).to_have_text('Saved to account')

def drag(page,source,target):
    source.dispatch_event('dragstart', {'dataTransfer':page.evaluate_handle('new DataTransfer()')})
    target.dispatch_event('drop', {'dataTransfer':page.evaluate_handle('new DataTransfer()')})
    expect(page.locator('[data-talent]')).to_have_count(1)

def exercise(page,context,url,shots):
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.add_init_script("localStorage.setItem('talentforge-language','en');")
    assert context.request.post(url+'/api/register',data={'login':'mage-owner','email':'mage@example.test','password':'test-password'}).ok
    pids=[]
    for name in ['Mage A','Mage B']:
        doc=json.loads((ROOT/'tests/fixtures/training-grounds.json').read_text())
        doc['name']=name
        doc['abilities']=[]
        doc['build']={}
        for branch in doc['branches']:
            branch['talents']=[]
        response=context.request.post(url+'/api/projects',data={'document':doc})
        assert response.ok,response.text()
        pid=response.json()['id']
        pids.append(pid)
        open_project(page,url,pid)
        page.locator('#addAbility').click()
        page.get_by_text('Ability templates',exact=True).click()
        page.locator('#workshopTemplate').select_option(label='Fireball')
        page.locator('#applySpellTemplate').click()
        page.locator('#submitModal').click()
        expect(page.locator('#modal')).not_to_be_visible()
        source=page.locator('[data-ability]').first
        drag(page,source,page.locator('.tree').first.locator('[data-row="0"][data-col="0"]'))
        save(page)
        current=saved(context,url,pid)
        original=current['abilities'][0]
        instance=current['abilities'][1]
        assert original['id']!=instance['id']
        assert instance['templateSource']['id']==original['id']
        assert instance['combatEffects']==original['combatEffects']
    open_project(page,url,pids[0])
    first=saved(context,url,pids[0])
    node=page.locator('[data-talent]').first
    node_id=node.get_attribute('data-talent')
    instance_id=first['branches'][0]['talents'][0]['grantedAbilityId']
    node.click()
    page.locator('#editLinkedAbility').click()
    page.locator('[data-key=baseAmount]').fill('500')
    page.get_by_text('Ability templates',exact=True).click()
    page.locator('#rememberSpellTemplate').click()
    page.locator('#submitModal').click()
    save(page)
    changed=saved(context,url,pids[0])
    assert next(a for a in changed['abilities'] if a['id']==instance_id)['combatEffects'][0]['baseAmount']==500
    assert changed['abilities'][0]['combatEffects'][0]['baseAmount']==150
    drag(page,page.locator(f'[data-talent="{node_id}"]'),page.locator('.tree').first.locator('[data-row="0"][data-col="2"]'))
    save(page)
    moved=saved(context,url,pids[0])
    assert moved['branches'][0]['talents'][0]['grantedAbilityId']==instance_id
    assert len(moved['abilities'])==2
    page.locator('#spellLibrary').click()
    page.locator(f'[data-spell-id="{instance_id}"] [data-spell-action=duplicate]').click()
    page.locator('[data-key=baseAmount]').fill('700')
    page.locator('#submitModal').click()
    expect(page.locator('#spellLibraryRows')).to_be_visible()
    page.locator('#closeModal').click()
    save(page)
    copied=saved(context,url,pids[0])
    assert len({a['id'] for a in copied['abilities']})==3
    assert [a['combatEffects'][0]['baseAmount'] for a in copied['abilities']]==[150,500,700]
    page.locator('#characterLab').click()
    lab=page.locator('.rpg-lab')
    lab.get_by_role('button',name='Combat Analytics',exact=True).click()
    for name in ['First loadout','Second loadout']:
        lab.get_by_label('Build name').fill(name)
        lab.get_by_role('button',name='Save current build').click()
    page.locator('#submitModal').click()
    save(page)
    # An edit to the active document must not mutate either saved build.
    page.locator(f'[data-talent="{node_id}"]').click()
    page.locator('#editLinkedAbility').click()
    page.locator('[data-key=baseAmount]').fill('600')
    page.locator('#submitModal').click();save(page)
    modified=saved(context,url,pids[0])
    assert next(a for a in modified['abilities'] if a['id']==instance_id)['combatEffects'][0]['baseAmount']==600
    for build in modified['rpg']['builds']:
        assert next(a for a in build['combatSnapshot']['abilities'] if a['id']==instance_id)['combatEffects'][0]['baseAmount']==500
    page.locator('#characterLab').click()
    lab=page.locator('.rpg-lab');lab.get_by_role('button',name='Combat Analytics',exact=True).click()
    lab.get_by_role('button',name='Load build',exact=True).first.click()
    page.locator('#submitModal').click();save(page)
    restored=saved(context,url,pids[0])
    assert [a['combatEffects'][0]['baseAmount'] for a in restored['abilities']]==[150,500,700]
    page.screenshot(path=shots/'mage-a.png')
    open_project(page,url,pids[1])
    other=saved(context,url,pids[1])
    assert [a['combatEffects'][0]['baseAmount'] for a in other['abilities']]==[150,150]
    page.locator('#addAbility').click()
    page.get_by_text('Ability templates',exact=True).click()
    page.locator('#workshopTemplate').select_option(label='Fireball')
    page.locator('#applySpellTemplate').click()
    expect(page.locator('[data-key=baseAmount]')).to_have_value('150')
    page.screenshot(path=shots/'standard-template-150.png')
    page.locator('#closeModal').click()
    assert not errors,errors
    return pids

if __name__=='__main__':
    shots=Path(sys.argv[1]);shots.mkdir(parents=True,exist_ok=True)
    with temporary_database() as folder,sync_playwright() as pw:
        server.DB=str(Path(folder)/'isolation.sqlite3');server.initialize()
        http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);start_server(http)
        port=http.server_port;url=f'http://127.0.0.1:{port}'
        browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        context=browser.new_context(viewport={'width':1440,'height':1000})
        pids=exercise(context.new_page(),context,url,shots)
        state=context.storage_state()
        browser.close()
        stop_server(http)
        http=server.ArchiveHTTPServer(('127.0.0.1',port),server.Handler);start_server(http)
        browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        context=browser.new_context(storage_state=state,viewport={'width':1440,'height':1000})
        page=context.new_page();page.add_init_script("localStorage.setItem('talentforge-language','en')")
        for pid,amounts in zip(pids,[[150,500,700],[150,150]]):
            open_project(page,url,pid)
            doc=saved(context,url,pid)
            assert [a['combatEffects'][0]['baseAmount'] for a in doc['abilities']]==amounts
        assert len(saved(context,url,pids[0])['rpg']['builds'])==2
        page.locator('#addAbility').click()
        page.get_by_text('Ability templates',exact=True).click()
        options=page.locator('#workshopTemplate option').evaluate_all("(nodes)=>nodes.filter(n=>n.textContent==='Fireball').map(n=>n.value)")
        assert len(options)==2
        for value,amount in zip(options,['150','500']):
            page.locator('#workshopTemplate').select_option(value=value)
            page.locator('#applySpellTemplate').click()
            expect(page.locator('[data-key=baseAmount]')).to_have_value(amount)
            page.get_by_text('Ability templates',exact=True).click()
        page.screenshot(path=shots/'personal-template-after-restart.png')
        browser.close()
    print('PASS two mages 500/150, immutable standard 150, independent duplicate 700, personal snapshot 500, node movement, two builds and browser/server restart')
