"""Template/favorite editor persistence fixtures, including transitive proc payloads.
This is a browser/data/runtime test and does not claim real GLB visual validation.
"""
import json
from pathlib import Path
import sys
from playwright.sync_api import expect,sync_playwright
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
import server
from server_lifecycle import temporary_database,start_server,stop_server
from browser_ability_isolation import open_project,saved,save,drag
expect.set_options(timeout=15000)

def document(name,rid):
    doc=json.loads((ROOT/'tests/fixtures/training-grounds.json').read_text())
    doc.update(name=name,abilities=[],build={})
    for branch in doc['branches']:branch['talents']=[]
    doc['character']['resources']=[{**doc['character']['resources'][0],'id':rid,'current':100}]
    doc['rpg']={'version':1,'attributes':{'critChance':0}}
    return doc

def run(page,context,url,shots):
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.route('https://**/*',lambda route:route.abort())
    page.add_init_script("localStorage.setItem('talentforge-language','en')")
    assert context.request.post(url+'/api/register',data={'login':'bundle-owner','email':'bundles@example.test','password':'test-password'}).ok
    source=document('Source mage','mana')
    spell={'id':'source','name':'Owned Fireball','description':'Owned proc payload','icon':'forge-ember','kind':'active','learningMode':'base',
      'cast':0,'cooldown':0,'range':30,'resourceCosts':[{'resourceId':'mana','resourceName':'Mana','amount':10,'unit':'points'}],
      'combatEffects':[{'id':'hit','type':'damage','trigger':'onHit','school':'fire','baseAmount':150,'coefficient':0,'scalingStat':'none','canCrit':False}]}
    source['abilities']=[spell,{**spell,'id':'payload','name':'Owned Spark','kind':'passive','resourceCosts':[],
      'combatEffects':[{**spell['combatEffects'][0],'baseAmount':25}]}]
    source['rpg']['procs']=[{'id':'extra','name':'Extra spark','owner':{'kind':'ability','id':'source'},'event':'damage',
      'chance':1,'cooldown':0,'sourceAbilityId':'source','spell':'payload','effect':'hit','cost':{'resourceId':'mana','amount':2,'unit':'points'}}]
    pids=[]
    for doc in [source,document('Personal import','my-mana'),document('Favorite import','other-mana')]:
        response=context.request.post(url+'/api/projects',data={'document':doc});assert response.ok,response.text();pids.append(response.json()['id'])
    open_project(page,url,pids[0]);page.locator('#spellLibrary').click()
    page.locator('[data-spell-id=source] [data-spell-action=edit]').click()
    page.locator('#favoriteItem').click()
    expect(page.locator('#spellLibraryRows')).to_be_visible()
    page.locator('#closeModal').click();save(page)
    favorite=context.request.get(url+'/api/favorites').json()['favorites'][0]
    assert len(favorite['item']['templateAbilities'])==1
    assert favorite['item']['templateRules']['procs'][0]['owner']['id']==favorite['item']['id']
    page.locator('#spellLibrary').click();page.locator('[data-spell-id=source] [data-spell-action=edit]').click()
    page.get_by_text('Ability templates',exact=True).click();page.locator('#rememberSpellTemplate').click()
    page.locator('#submitModal').click();expect(page.locator('#spellLibraryRows')).to_be_visible();page.locator('#closeModal').click();save(page)
    open_project(page,url,pids[1]);page.locator('#addAbility').click();page.get_by_text('Ability templates',exact=True).click()
    page.locator('#workshopTemplate').select_option(label='Owned Fireball');page.locator('#applySpellTemplate').click()
    page.locator('#submitModal').click();expect(page.locator('#modal')).not_to_be_visible();save(page)
    imported=saved(context,url,pids[1]);assert len(imported['abilities'])==2 and len(imported['rpg']['procs'])==1
    main=next(ability for ability in imported['abilities'] if ability['name']=='Owned Fireball')
    assert main['resourceCosts'][0]['resourceId']=='my-mana'
    assert imported['rpg']['procs'][0]['cost']['resourceId']=='my-mana'
    drag(page,page.locator(f'[data-ability="{main["id"]}"]'),page.locator('.tree').first.locator('[data-row="0"][data-col="0"]'))
    save(page);tree=saved(context,url,pids[1]);assert len(tree['abilities'])==4
    node=tree['branches'][0]['talents'][0];node_spell=node['grantedAbilityId']
    proc=next(rule for rule in tree['rpg']['procs'] if rule['owner']['id']==node_spell)
    page.locator('#spellLibrary').click();page.locator(f'[data-spell-id="{proc["spell"]}"] [data-spell-action=edit]').click()
    page.locator('[data-key=baseAmount]').fill('700');page.locator('#submitModal').click()
    expect(page.locator('#spellLibraryRows')).to_be_visible();page.locator('#closeModal').click();save(page)
    tree=saved(context,url,pids[1])
    assert next(ability for ability in tree['abilities'] if ability['id']==proc['spell'])['combatEffects'][0]['baseAmount']==700
    assert sum(ability['name']=='Owned Spark' and ability['combatEffects'][0]['baseAmount']==25 for ability in tree['abilities'])==1
    # Run the same existing engine on the persisted document; no parallel calculator.
    result=page.evaluate("""async data=>{const {compileCombatBuild}=await import('/combat/build-compiler.js');
      const {createCombatRuntime}=await import('/combat/combat-runtime.js');
      const doc=structuredClone(data.doc);doc.build={[data.node]:1};
      const rt=createCombatRuntime(compileCombatBuild(doc),{globalCooldown:0});rt.cast(data.ability);
      return {damage:rt.report().metrics.damage,mana:rt.state.player.resources['my-mana'].current};} """,{'doc':tree,'node':node['id'],'ability':node_spell})
    assert result=={'damage':850,'mana':88},result
    page.screenshot(path=shots/'01-independent-payloads.png')
    open_project(page,url,pids[2]);page.locator('#favorites').click();page.locator(f'[data-use="{favorite["id"]}"]').click();save(page)
    favorite_copy=saved(context,url,pids[2]);assert len(favorite_copy['abilities'])==2
    assert favorite_copy['rpg']['procs'][0]['cost']['resourceId']=='other-mana'
    assert next(ability for ability in favorite_copy['abilities'] if ability['name']=='Owned Spark')['combatEffects'][0]['baseAmount']==25
    assert saved(context,url,pids[0])['abilities'][1]['combatEffects'][0]['baseAmount']==25
    assert not errors,errors
    return pids

if __name__=='__main__':
    shots=Path(sys.argv[1]);shots.mkdir(parents=True,exist_ok=True)
    with temporary_database() as folder,sync_playwright() as pw:
        server.DB=str(Path(folder)/'bundles.sqlite3');server.initialize()
        http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);start_server(http);port=http.server_port;url=f'http://127.0.0.1:{port}'
        browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        context=browser.new_context(viewport={'width':1440,'height':1000});page=context.new_page()
        try:
            pids=run(page,context,url,shots);state=context.storage_state();browser.close();stop_server(http)
            http=server.ArchiveHTTPServer(('127.0.0.1',port),server.Handler);start_server(http)
            browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);context=browser.new_context(storage_state=state)
            for pid in pids:assert context.request.get(url+'/api/projects/'+pid).ok
            template=context.request.get(url+'/api/favorites').json()['favorites'][0]['item']
            assert template['templateAbilities'][0]['combatEffects'][0]['baseAmount']==25
            print('PASS personal templates and favorites copy proc dependencies, adapt resource IDs, isolate 700/25 payloads and retain data after server/browser restart; persisted runtime damage 850, resource 88')
        except Exception:
            if not page.is_closed():page.screenshot(path=shots/'failed.png')
            raise
        finally:browser.close()
