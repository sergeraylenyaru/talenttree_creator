"""Icon artwork scales up/down in previews, existing uploads and main picker."""
import base64,sys,tempfile,threading,os
from pathlib import Path
from unittest.mock import patch
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright,expect
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server,accounts

with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'SMTP_HOST':'','SMTP_FROM':'','APP_URL':'','REQUIRE_EMAIL_VERIFICATION':'0'}):
    tmp=Path(tmp);server.DB=str(tmp/'icons.sqlite');server.initialize()
    with server.connect() as db:accounts.register(db,{'login':'icon_admin','email':'admin@example.test','password':'test-password-123'},server.password_hash,bootstrap=True)
    fixtures=[]
    for name,size,background,rect,color in [('small',16,'blue',None,None),('large',512,'purple',None,None),('transparent_padding',64,(0,0,0,0),(16,16,47,47),'cyan'),('black_padding',128,'black',(32,32,95,95),'orange')]:
        img=Image.new('RGBA',(size,size),background)
        if rect:ImageDraw.Draw(img).rectangle(rect,fill=color)
        path=tmp/(name+'.png');img.save(path)
        with server.connect() as db:
            ident=accounts.upload_icon(db,{'name':name,'category':'general','image':base64.b64encode(path.read_bytes()).decode()})
        fixtures.append((name,path,ident))
    http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);threading.Thread(target=http.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{http.server_port}'
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':1440,'height':1000});ctx.route('https://**/*',lambda route:route.abort())
            page=ctx.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)));page.goto(base+'/admin')
            page.locator('#adminEmail').fill('admin@example.test');page.locator('#adminPassword').fill('test-password-123');page.locator('#adminLoginForm button').click();page.locator('#iconsTab').click();expect(page.locator('#adminIconGrid img')).to_have_count(4)
            def filled(selector):
                page.wait_for_function('''selector=>Array.from(document.querySelectorAll(selector)).every(img=>{
                    if(!img.complete||!img.naturalWidth)return false;
                    const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const context=canvas.getContext('2d');context.drawImage(img,0,0,16,16);
                    const pixels=context.getImageData(0,0,16,16).data;return [0,15*4,15*16*4,(16*16-1)*4].every(i=>pixels[i+3]>0&&(pixels[i]||pixels[i+1]||pixels[i+2]));
                })''',arg=selector)
            filled('#adminIconGrid img')
            for width in [1440,1024,768,390,320]:
                page.set_viewport_size({'width':width,'height':1000})
                assert page.locator('#adminIconGrid img').evaluate_all('images=>images.every(img=>img.getBoundingClientRect().width===48&&img.getBoundingClientRect().height===48)')
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
            page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path='work/fitted-icons-desktop.png',full_page=True)
            page.locator('#uploadFile').set_input_files([str(path) for _,path,_ in fixtures]);expect(page.locator('.upload-status.duplicate')).to_have_count(4);filled('#uploadQueue img')
            # Main site uses the same fitting for already uploaded assets.
            assert ctx.request.post(base+'/api/login',data={'login':'admin@example.test','password':'test-password-123'}).status==200
            page.goto(base);expect(page.locator('#user')).to_have_text('icon_admin');page.locator('#classIcon').click();page.locator('[data-emblem-layer="0"]').click()
            for name,_,ident in fixtures:
                page.locator('#iconSearch').fill(name);expect(page.locator('[data-icon="custom:'+ident+'"]')).to_be_visible();filled('[data-icon="custom:'+ident+'"] img')
            assert not errors,errors
            print('PASS: small/large icons, transparent and black padding fill frames in existing catalog, upload previews and main picker; 48px frames and no overflow down to 320px.');browser.close()
    finally:http.shutdown();http.server_close()
