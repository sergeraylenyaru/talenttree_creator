"""Exercise the actual open-world assets and HUD on loopback Chromium/WebGL2."""
import json
import os
from pathlib import Path
import sys

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server
from server_lifecycle import start_server, temporary_database


def verify(page, port, screenshots, world_only=False, combat_only=False):
    document = json.loads((ROOT / 'tests/fixtures/training-grounds.json').read_text())
    for ability in document['abilities']:
        ability.pop('combatEffects', None)
    errors, models = [], set()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('response', lambda res: models.add(res.url.split('local-world-assets/')[-1])
            if 'local-world-assets/' in res.url and res.status == 200 else None)
    page.route('https://**/*', lambda route: route.abort())
    page.add_init_script("""
      localStorage.setItem('talentforge-language','en');
      localStorage.setItem('talentforge-draft',JSON.stringify(%s));
      localStorage.setItem('talentforge-training-grounds-v1',JSON.stringify({stats:{critChance:1},globalCooldown:0}));
    """ % json.dumps(document))
    page.goto(f'http://127.0.0.1:{port}')
    page.locator('#openTrainingGrounds').click()
    arena = page.locator('#trainingGrounds')
    frame = arena.locator('.tg-world-frame')
    canvas = frame.locator('canvas')
    expect(arena.locator('[data-role=scene]')).to_have_text('Scene · Ready',timeout=120000)
    assert {'character/hero.glb','targets/Training-dummy.glb','weapons/sword-one-hand.glb',
            'world/guildhouseb.glb'}.issubset(models), models
    assert canvas.evaluate("canvas => Boolean(canvas.getContext('webgl2'))")
    assert frame.evaluate("element => Math.abs(element.clientWidth-innerWidth)<2 && Math.abs(element.clientHeight-innerHeight)<2")

    def state():
        return canvas.evaluate("""async canvas => (await import('/world/generated/world.js')).worldSnapshot(canvas)""")

    def wait_for(js, message, timeout=20000):
        page.wait_for_function("""async source => {
            const canvas=document.querySelector('.tg-world-frame canvas');
            const {worldLocation}=await import('/world/generated/world.js');
            return (new Function('p','return '+source))(worldLocation(canvas));
        }""", arg=js,timeout=timeout)
        return state()

    def shot(name, whole=False):
        if screenshots:
            (arena if whole else frame).screenshot(path=screenshots/(name+'.png'),timeout=30000)

    def go(points):
        return canvas.evaluate("""async (canvas,points) => {
          const {worldLocation}=await import('/world/generated/world.js');
          canvas.focus();
          let held=new Set();
          const drive=keys=>{
            for(const code of held) if(!keys.has(code)) canvas.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));
            for(const code of keys) if(!held.has(code)) canvas.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true}));
            held=keys;
          };
          const frame=()=>new Promise(requestAnimationFrame);
          const history=[];
          try {
            for(const [x,z] of points) {
              const limit=performance.now()+20000;
              let p;
              do {
                p=worldLocation(canvas);
                if(Math.hypot(p.x-x,p.z-z)<.41)break;
                if(performance.now()>limit)throw Error('Route stopped '+JSON.stringify({x,z,p,history}));
                const dx=x-p.x,dz=z-p.z, keys=new Set();
                if(Math.abs(dx)>.15)keys.add(dx<0?'KeyA':'KeyD');
                if(Math.abs(dz)>.15)keys.add(dz<0?'KeyW':'KeyS');
                if(Math.hypot(dx,dz)<1.0)keys.add('ShiftLeft');
                drive(keys);
                await frame();
              } while(true);
              history.push([p.x,p.y,p.z]);
            }
          } finally{ drive(new Set()); }
          return history;
        }""", points)

    initial=wait_for("p?.clip?.startsWith('Stand')",'idle')
    assert initial['weaponGripError']<1e-8 and len(initial['assets'])==4
    expect(arena.locator('.tg-unit-player .tg-portrait img')).to_be_visible()
    expect(arena.locator('.tg-unit-player .tg-unit-bar').first).to_contain_text('1000 / 1000')
    expect(arena.locator('.tg-unit-target')).to_be_hidden()
    if not world_only:
        arena.locator('.tg-world-target').click()
        expect(arena.locator('.tg-unit-target .tg-portrait img')).to_be_visible()
        expect(arena.locator('.tg-unit-target .tg-unit-bar')).to_contain_text('1000000 / 1000000')
        shot('01-unit-frames',True)
        page.keyboard.press('1')
        expect(arena.locator('#tg-feedback')).to_contain_text('Out of range',ignore_case=True)
        page.keyboard.down('KeyW')
        wait_for("p.clip?.startsWith('Run')",'default run')
        shot('04-running')
        page.keyboard.up('KeyW')
        go([[-25,-23]])
        page.keyboard.press('1')
        wait_for("p.clip?.startsWith('Attack1H')",'basic attack')
        shot('05-melee')
        expect(arena.locator('[data-event=damage].tg-critical')).to_have_count(1)
        expect(arena.locator('.tg-unit-target .tg-unit-bar')).not_to_contain_text('1000000 / 1000000')
        shot('07-target-health')
        canvas.evaluate('''async canvas => {
          document.querySelector('[data-world-slot="2"]').click();
          await new Promise(requestAnimationFrame);
          document.querySelector('#tg-pause').click();
          canvas.focus();
        }''')
        expect(arena.locator('#tg-cast')).to_be_visible()
        shot('06-cast')
        page.keyboard.press('Escape')
        expect(arena.locator('#tg-cast')).to_be_hidden()
        expect(arena.locator('.tg-unit-resource')).to_contain_text('80 / 100')
        arena.locator('#tg-pause').click()
        canvas.focus()
        page.keyboard.press('3')
        wait_for("p.clip?.startsWith('ChannelCastDirected')",'channel')
        expect(arena.locator('#tg-cast')).to_be_hidden(timeout=15000)
        page.keyboard.press('2')
        expect(arena.locator('.tg-unit-resource')).to_contain_text('75 / 100',timeout=20000)
        expect(arena.locator('[data-world-slot="2"] span')).not_to_be_empty()
        arena.locator('.tg-target-reset').click()
        expect(arena.locator('.tg-unit-target .tg-unit-bar')).to_contain_text('1000000 / 1000000')
        slots=arena.locator('.tg-world-actions details')
        slots.locator('summary').click()
        slot=slots.locator('select').nth(7)
        slot.select_option(label='Practice spark')
        expect(arena.locator('[data-world-slot="8"]')).to_have_attribute('aria-label','Practice spark')
        assert page.evaluate("Object.keys(localStorage).some(k=>k.startsWith('talentforge-action-slots-v1:') && JSON.parse(localStorage[k])[7]?.startsWith('__training_spark'))")
        assert not page.evaluate("JSON.parse(localStorage.getItem('talentforge-draft')).abilities.some(a=>a.id.startsWith('__training_'))")
        slots.locator('summary').click()
        print('Actual portraits and HUD, manual Attack1H, cast, Escape, channel, projectile, critical hit, resource and reset passed',flush=True)

    if combat_only:
        assert not errors, errors
        return

    canvas.focus()
    page.keyboard.down('ShiftLeft')
    page.keyboard.down('KeyS')
    wait_for("p.clip?.startsWith('Walkbackwards')",'shift backward walk')
    page.keyboard.up('KeyS')
    page.keyboard.up('ShiftLeft')
    page.keyboard.press('Space')
    wait_for("p.animation==='jump'",'jump')
    wait_for("p.animation==='fall'",'fall')
    wait_for("p.grounded",'landing')

    go([[-25,-22],[-33.8,-22],[-34,-20.2],[-34.3,-17],[-34.5,-13],[-34.7,-9],[-34.7,-7.9],
        [-33.6,-7.9],[-32.6,-6.95],[-25,-6.95]])
    upper=state()
    assert upper['player']['y']>6.5 and upper['player']['grounded'],upper
    shot('03-upper-floor')
    print('Actual stairs and upper gallery passed',flush=True)
    go([[-32.6,-6.95],[-33.6,-7.9],[-34.7,-8.5],[-34.4,-13],[-34.2,-17],[-34,-20.2],[-33.8,-22],[-25,-22]])
    assert state()['player']['y']<.2
    print('Actual descent returned to the ground floor',flush=True)
    return_route=[[-24.7,-18.8],[-20.4,-14.35],[-15.2,-9.3],[-12.8,-6.7],[-11.25,-5.7],
                  [-9.8,-5.7],[-8.4,-4.85],[-3.7,-.23],[1.7,1.25],[7.5,1.8],[8.2,3.5],[8.2,17]]
    go(return_route)
    street=state()
    assert street['player']['z']>16 and street['player']['grounded'],street
    shot('02-exterior')
    print('Actual entrance and outside terrain reached',flush=True)
    go(list(reversed(return_route[6:-1]))+[[-9.8,-5.7],[-11.1,-5.7],[-12.5,-5.7]]
       +list(reversed(return_route[:4]))+[[-25,-22]])
    assert abs(state()['player']['y'])<.2
    assert not errors, errors
    print('Exterior, return through the entrance, stairs descent, grounding and camera traversal passed',flush=True)


def main():
    screenshots=Path(sys.argv[1]) if len(sys.argv)>1 else None
    if screenshots: screenshots.mkdir(parents=True,exist_ok=True)
    os.environ['TALENT_LOCAL_WOW_ASSETS']='1'
    with temporary_database() as folder, sync_playwright() as p:
        server.DB=str(Path(folder)/'exploration.sqlite')
        server.initialize()
        http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler)
        start_server(http)
        browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),
                                  args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        try:
            verify(browser.new_page(viewport={'width':1440,'height':1000}),http.server_port,screenshots,world_only='--world-only' in sys.argv[2:],
                   combat_only='--combat-only' in sys.argv[2:])
        finally:
            browser.close()


if __name__=='__main__':
    main()
