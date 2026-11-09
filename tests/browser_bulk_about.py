"""Bulk icon review and administrator-editable About, temporary database/files."""
from browser_helpers import open_icons, close_icons
import base64,sys,tempfile,threading,os
from pathlib import Path
from unittest.mock import patch
from PIL import Image,PngImagePlugin
from playwright.sync_api import sync_playwright,expect
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server,accounts

with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'SMTP_HOST':'','SMTP_FROM':'','APP_URL':'','REQUIRE_EMAIL_VERIFICATION':'0'}):
    tmp=Path(tmp);server.DB=str(tmp/'bulk-about.sqlite');server.initialize()
    def image(name,color,size=(64,64),metadata=''):
        path=tmp/name;info=PngImagePlugin.PngInfo();info.add_text('Comment',metadata)
        Image.new('RGBA',size,color).save(path,'PNG',pnginfo=info);return path
    existing=image('already-there.png','gold')
    with server.connect() as db:accounts.register(db,{'login':'project_admin','email':'admin@example.test','password':'admin-password-123'},server.password_hash,bootstrap=True)
    with server.connect() as db:accounts.upload_icon(db,{'name':'Existing gold','category':'general','image':base64.b64encode(existing.read_bytes()).decode()})
    blue=image('spell_blue.png','blue');green=image('spell_green.png','green');repeat=image('blue_renamed.png','blue',metadata='new metadata')
    duplicate=image('renamed_existing.png','gold',metadata='different metadata');invalid=tmp/'invalid.svg';invalid.write_text('<svg onload="alert(1)"></svg>')
    banner=image('project-banner.png','#b88236',(640,180))
    http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);threading.Thread(target=http.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{http.server_port}'
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            admin=browser.new_context(viewport={'width':1440,'height':1100});admin.route('https://**/*',lambda route:route.abort())
            a=admin.new_page();errors=[];a.on('pageerror',lambda e:errors.append(str(e)));a.goto(base+'/admin')
            a.locator('#adminEmail').fill('admin@example.test');a.locator('#adminPassword').fill('admin-password-123');a.locator('#adminLoginForm button').click()
            a.locator('#iconsTab').click();a.wait_for_selector('[data-icon-id]');a.locator('#uploadCategory').select_option('weapon');a.locator('#uploadTags').fill('magic, магия')
            a.locator('#uploadFile').set_input_files([str(f) for f in (blue,green,repeat,duplicate,invalid)])
            expect(a.locator('#uploadSummary')).to_contain_text('5 files · 2 ready')
            expect(a.locator('.upload-status.repeat')).to_have_count(1);expect(a.locator('.upload-status.duplicate')).to_have_count(1);expect(a.locator('.upload-status.invalid')).to_have_count(1)
            expect(a.locator('[data-upload-name]').nth(0)).to_have_value('spell blue')
            expect(a.locator('[data-upload-tags]').nth(0)).to_have_value('magic, магия');expect(a.locator('[data-upload-tags]').nth(1)).to_have_value('magic, магия')
            a.locator('[data-upload-tags]').nth(0).fill('Лёд, frost, mage');a.locator('[data-upload-tags]').nth(1).fill('природа, poison, яд')
            a.locator('[data-upload-name]').nth(0).fill('Blue comet');a.locator('[data-upload-name]').nth(1).fill('Emerald comet')
            expect(a.locator('[data-upload-name]').nth(3)).to_be_disabled()
            a.screenshot(path='work/bulk-icons-desktop.png',full_page=True)
            a.locator('#uploadIcons').click();expect(a.locator('#uploadSummary')).to_contain_text('2 uploaded')
            # The duplicate from the selected batch stays blocked after its original was uploaded.
            expect(a.locator('.upload-status.duplicate')).to_have_count(2);expect(a.locator('#uploadIcons')).to_be_disabled()
            icons=admin.request.get(base+'/api/admin/icons').json()['icons'];assert len(icons)==3
            assert {i['name'] for i in icons}=={'Existing gold','Blue comet','Emerald comet'},(icons,errors)
            assert all(i['category']=='weapon' for i in icons if i['name']!='Existing gold')
            assert next(i for i in icons if i['name']=='Blue comet')['tags']=='Лёд, frost, mage'
            a.locator('#adminIconSearch').fill('лед mage');expect(a.locator('#adminIconGrid article')).to_have_count(1);expect(a.locator('#adminIconGrid')).to_contain_text('Blue comet')
            a.locator('[data-edit-icon-category]').click();a.locator('#editIconTags').fill('Лёд, frost, mage, burst');a.locator('#adminActionSave').click();expect(a.locator('#adminDialog')).not_to_be_visible();a.locator('#adminIconSearch').fill('burst');expect(a.locator('#adminIconGrid')).to_contain_text('Blue comet');a.locator('#adminIconSearch').fill('')
            a.locator('#clearUploadQueue').click();a.locator('#uploadFile').set_input_files(str(blue))
            expect(a.locator('.upload-status.duplicate')).to_contain_text('Blue comet');expect(a.locator('#uploadIcons')).to_be_disabled()
            # A failed request does not lose earlier successes or prevent retrying only that row.
            orange=image('retry_orange.png','orange');a.locator('#clearUploadQueue').click();a.locator('#uploadFile').set_input_files(str(orange));expect(a.locator('#uploadIcons')).to_be_enabled()
            a.route('**/api/admin/icons',lambda route:route.fulfill(status=503,json={'error':'Temporary upload failure'}) if route.request.method=='POST' else route.continue_())
            a.locator('#uploadIcons').click();expect(a.locator('.upload-status.failed')).to_contain_text('Temporary upload failure');expect(a.locator('#uploadIcons')).to_be_enabled()
            a.unroute('**/api/admin/icons');a.locator('#uploadIcons').click();expect(a.locator('.upload-status.uploaded')).to_have_count(1)
            a.locator('#projectTab').click();expect(a.locator('#projectDescription')).not_to_have_value('')
            while a.locator('[data-remove-method]').count():a.locator('[data-remove-method]').first.click()
            a.locator('#projectDescription').fill('Create your own class.\nA community workshop for talent trees.')
            a.locator('#addSupportCard').click();card=a.locator('[data-support-editor]').first
            card.locator('[data-translated="title"]').fill('Support development');card.locator('[data-translated="text"]').fill('Мои деревья\nHelp keep the workshop growing.')
            card.locator('[data-translated="linkLabel"]').fill('Support now');card.locator('[data-field="linkUrl"]').fill('https://example.test/help')
            card.locator('[data-method-file]').set_input_files(str(banner));expect(card.locator('[data-field="imageUrl"]')).to_have_value(__import__('re').compile(r'/media/project/[a-f0-9]{32}\.png'))
            card.locator('[data-field="imageLink"]').fill('https://example.test/banner-help');card.locator('[data-translated="imageAlt"]').fill('Workshop support banner')
            a.locator('#addSupportCard').click();second=a.locator('[data-support-editor]').nth(1)
            second.locator('[data-translated="title"]').fill('Help us test');second.locator('[data-translated="text"]').fill('Try a new class and share feedback.');second.locator('[data-direction="-1"]').click()
            a.locator('[data-project-language="ru"]').click();a.locator('#projectDescription').fill('Создавай свой класс.\nМастерская деревьев талантов.')
            card=a.locator('[data-support-editor]').nth(1);card.locator('[data-translated="title"]').fill('Помощь в разработке');card.locator('[data-translated="text"]').fill('Поддержи развитие мастерской.');card.locator('[data-translated="linkLabel"]').fill('Помочь проекту')
            a.locator('#saveProjectSettings').click();expect(a.locator('#adminNotice')).to_have_text('Project settings saved. The About page is updated.')
            a.screenshot(path='work/project-settings-desktop.png',full_page=True)
            saved=admin.request.get(base+'/api/admin/project').json()['content'];assert saved['methods'][0]['title']['en']=='Help us test';assert saved['methods'][1]['title']['ru']=='Помощь в разработке'
            guest=browser.new_context(viewport={'width':1440,'height':1100});guest.route('https://**/*',lambda route:route.abort())
            g=guest.new_page();g.on('pageerror',lambda e:errors.append(str(e)));g.goto(base+'/#about')
            expect(g.locator('#aboutTitle')).to_have_text('About');expect(g.locator('.about-description')).to_contain_text('Create your own class.')
            expect(g.locator('.intro')).not_to_be_visible();expect(g.locator('#treeHero')).not_to_be_visible();expect(g.locator('#aboutContent .support-card')).to_have_count(2)
            expect(g.locator('.support-card').nth(1).locator('p')).to_contain_text('Мои деревья') # Authored text is never auto-translated.
            expect(g.locator('.support-image a')).to_have_attribute('href','https://example.test/banner-help')
            expect(g.locator('.support-link')).to_have_attribute('href','https://example.test/help')
            assert g.locator('.support-image img').evaluate('img=>img.complete&&img.naturalWidth===640')
            g.screenshot(path='work/about-desktop.png',full_page=True)
            g.locator('#aboutReturnEditor').click();expect(g.locator('#aboutPage')).not_to_be_visible();g.locator('#about').click();expect(g.locator('#aboutPage')).to_be_visible()
            for width in [1440,1024,768,390,320]:
                g.set_viewport_size({'width':width,'height':1000});assert g.evaluate('document.documentElement.scrollWidth<=innerWidth'),('public',width)
                a.set_viewport_size({'width':width,'height':1000});assert a.evaluate('document.documentElement.scrollWidth<=innerWidth'),('admin project',width)
            g.screenshot(path='work/about-mobile.png',full_page=True)
            a.locator('#iconsTab').click();assert a.evaluate('document.documentElement.scrollWidth<=innerWidth'),'admin upload';a.screenshot(path='work/bulk-icons-mobile.png',full_page=True)
            member=browser.new_context(viewport={'width':1440,'height':1000});member.route('https://**/*',lambda route:route.abort())
            member.request.post(base+'/api/register',data={'login':'about_member','email':'member@example.test','password':'member-password-123'});member.request.post(base+'/api/profile/settings',data={'language':'ru'})
            m=member.new_page();m.on('pageerror',lambda e:errors.append(str(e)));m.goto(base+'/#about')
            expect(m.locator('#aboutTitle')).to_have_text('О проекте');expect(m.locator('.about-description')).to_contain_text('Создавай свой класс.')
            for width in [1440,1100,1024,960,768,320]:
                m.set_viewport_size({'width':width,'height':1000});assert m.evaluate('document.documentElement.scrollWidth<=innerWidth'),('Russian member',width)
            m.set_viewport_size({'width':1440,'height':1000})
            m.locator('#accountMenu').click();m.locator('#profileSettings').click();m.locator('#profileLanguage').select_option('en');m.locator('#submitModal').click()
            expect(m.locator('.about-description')).to_contain_text('Create your own class.')
            m.locator('#aboutReturnEditor').click();m.locator('#className').fill('Unsaved local idea');m.locator('#className').dispatch_event('change');m.locator('#about').click();m.locator('#aboutReturnEditor').click();expect(m.locator('#className')).to_have_value('Unsaved local idea')
            m.locator('#classIcon').click();m.locator('[data-emblem-layer="0"]').click();open_icons(m);m.locator('#iconSearch').fill('лед mage');expect(m.locator('#iconGrid [data-icon]')).to_have_count(1);expect(m.locator('#iconGrid button')).to_have_attribute('title',__import__('re').compile('Blue comet.*burst'));open_icons(m);m.locator('#iconSearch').fill('poison яд');expect(m.locator('#iconGrid [data-icon]')).to_have_count(1);expect(m.locator('#iconGrid button')).to_have_attribute('title',__import__('re').compile('Emerald comet'));close_icons(m);m.locator('#closeModal').click();m.wait_for_selector('#emblemOpacity');close_icons(m);m.locator('#closeModal').click()
            # Reload reads persistent settings, not the in-memory editor draft.
            a.set_viewport_size({'width':1440,'height':1000});a.reload();a.locator('#projectTab').click();expect(a.locator('#projectDescription')).to_have_value('Create your own class.\nA community workshop for talent trees.')
            assert not errors,errors
            browser.close();print('PASS: multi-file review, names/categories/tags, admin editing and tag search, DB and selection duplicates, invalid file, retry, project text/links/linked images, card order, bilingual persistence, guest access and mobile widths down to 320px.')
    finally:http.shutdown();http.server_close()
