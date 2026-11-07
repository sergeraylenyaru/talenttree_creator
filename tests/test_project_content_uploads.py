import base64,copy,io,json,unittest
from concurrent.futures import ThreadPoolExecutor
from PIL import Image,PngImagePlugin
import test_server as base
import test_accounts_admin as admin_base
import server,accounts,site_content

def encoded_image(color='gold',metadata=''):
    output=io.BytesIO();info=PngImagePlugin.PngInfo();info.add_text('Comment',metadata)
    Image.new('RGBA',(64,64),color).save(output,'PNG',pnginfo=info)
    return base64.b64encode(output.getvalue()).decode()

class ProjectContentUploads(unittest.TestCase):
    setUpClass=classmethod(base.API.setUpClass.__func__)
    tearDownClass=classmethod(base.API.tearDownClass.__func__)
    client=base.API.client
    request=base.API.request
    register=base.API.register
    admin=admin_base.AccountsAdminAPI.admin
    def setUp(self):
        admin_base.AccountsAdminAPI.setUp(self)
        with server.connect() as db:
            db.execute('DELETE FROM project_content');db.execute('DELETE FROM project_images');site_content.migrate(db)

    def test_normalized_duplicates_include_renamed_removed_and_legacy_icons(self):
        normal,admin=self.admin();image=encoded_image(metadata='first')
        self.assertEqual(self.request(normal,'/api/admin/icons/check',{'image':image})[0],403)
        initial=self.request(admin,'/api/admin/icons/check',{'image':image})[1]
        self.assertIsNone(initial['duplicate'])
        payload={'name':'Original','category':'general','image':image}
        ident=self.request(admin,'/api/admin/icons',payload)[1]['id']
        changed=dict(payload,name='Renamed',image=encoded_image(metadata='different filename and metadata'))
        check=self.request(admin,'/api/admin/icons/check',{'image':changed['image']})[1]
        self.assertEqual(check['fingerprint'],initial['fingerprint']);self.assertEqual(check['duplicate']['id'],ident)
        status,result,_=self.request(admin,'/api/admin/icons',changed)
        self.assertEqual(status,409);self.assertEqual(result['duplicate']['name'],'Original')
        self.request(admin,'/api/admin/icons/'+ident[7:],{},'DELETE')
        self.assertFalse(self.request(admin,'/api/admin/icons/check',{'image':image})[1]['duplicate']['enabled'])
        self.assertEqual(self.request(admin,'/api/admin/icons',changed)[0],409)
        with server.connect() as db:
            db.execute('DELETE FROM icon_fingerprints');accounts.migrate(db);accounts.migrate(db)
        self.assertEqual(self.request(admin,'/api/admin/icons',changed)[0],409)
        self.assertEqual(self.request(admin,'/api/admin/icons',dict(payload,image=encoded_image('purple')))[0],201)
        with server.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM icon_assets').fetchone()[0],2)

    def test_final_duplicate_check_serializes_competing_uploads(self):
        _,admin=self.admin();other=self.client()
        self.assertEqual(self.request(other,'/api/admin/login',{'login':'administrator','password':'test-password-123'})[0],200)
        payload={'name':'Concurrent','category':'general','image':encoded_image('cyan')}
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda client:self.request(client,'/api/admin/icons',payload)[0],(admin,other)))
        self.assertEqual(sorted(results),[201,409])

    def test_public_about_and_admin_only_atomic_edits_language_and_order(self):
        guest=self.client();initial=self.request(guest,'/api/about')[1]
        self.assertIn('TalentForge',initial['content']['description']['en'])
        normal,admin=self.admin()
        self.assertEqual(self.request(normal,'/api/admin/project')[0],403)
        self.assertEqual(self.request(normal,'/api/admin/project',initial)[0],403)
        document={'description':{'en':'My project','ru':'Мой проект'},'methods':[
            {'id':'second','title':{'en':'Help with code'},'text':{'ru':'Текст с переносом\nВторая строка'},'linkUrl':'https://example.test/code','linkLabel':{'en':'Code'}},
            {'id':'first','title':{'ru':'Поддержать'},'imageUrl':'https://example.test/banner.png','imageLink':'https://example.test/help','imageAlt':{'ru':'Помощь'}}]}
        status,result,_=self.request(admin,'/api/admin/project',{'content':document,'revision':initial['revision']})
        self.assertEqual(status,200,result);self.assertEqual(result['revision'],initial['revision']+1)
        public=self.request(guest,'/api/about')[1]['content'];self.assertEqual(public['description'],document['description'])
        self.assertEqual([c['id'] for c in public['methods']],['second','first'])
        self.assertEqual(public['methods'][0]['text']['ru'],'Текст с переносом\nВторая строка')
        self.assertEqual(self.request(admin,'/api/admin/project',{'content':document,'revision':initial['revision']})[0],409)
        self.assertEqual(self.request(admin,'/api/admin/project',{'content':document,'revision':result['revision']},origin='https://other.example')[0],403)
        with server.connect() as db:server.initialize()
        self.assertEqual(self.request(guest,'/api/about')[1]['content'],public)

    def test_content_validation_rejects_unsafe_urls_and_invalid_cards_without_changes(self):
        _,admin=self.admin();initial=self.request(admin,'/api/admin/project')[1]
        for url in ('javascript:alert(1)','data:text/html,hello','//other.test','https://user:pass@example.test','https://example.test/\nfoo'):
            document=copy.deepcopy(initial['content']);document['methods'][0]['linkUrl']=url
            self.assertEqual(self.request(admin,'/api/admin/project',dict(initial,content=document))[0],400,url)
        for change in ('duplicate_id','long_description','missing_title','missing_image','unknown_image'):
            document=copy.deepcopy(initial['content'])
            if change=='duplicate_id':document['methods'][1]['id']=document['methods'][0]['id']
            if change=='long_description':document['description']['en']='x'*8001
            if change=='missing_title':document['methods'][0]['title']={'en':'','ru':''}
            if change=='missing_image':document['methods'][0]['imageLink']='https://example.test'
            if change=='unknown_image':document['methods'][0]['imageUrl']='/media/project/'+'a'*32+'.png'
            self.assertEqual(self.request(admin,'/api/admin/project',dict(initial,content=document))[0],400,change)
        self.assertEqual(self.request(self.client(),'/api/about')[1],initial)

    def test_project_image_upload_is_admin_only_sanitized_and_supports_linked_images(self):
        normal,admin=self.admin();image=encoded_image(metadata='private file metadata')
        self.assertEqual(self.request(normal,'/api/admin/project/images',{'image':image})[0],403)
        status,result,_=self.request(admin,'/api/admin/project/images',{'image':image});self.assertEqual(status,201)
        self.assertEqual(self.request(admin,'/api/admin/project/images',{'image':image})[1]['url'],result['url'])
        with normal.open(self.url+result['url']) as response:
            self.assertEqual(response.headers['Content-Type'],'image/png');png=Image.open(io.BytesIO(response.read()))
            self.assertEqual(png.size,(64,64));self.assertNotIn('Comment',png.info)
        initial=self.request(admin,'/api/admin/project')[1];initial['content']['methods'][0].update(imageUrl=result['url'],imageLink='https://example.test/support')
        self.assertEqual(self.request(admin,'/api/admin/project',initial)[0],200)
        self.assertEqual(self.request(self.client(),'/api/about')[1]['content']['methods'][0]['imageUrl'],result['url'])
        bad=base64.b64encode(b'<svg onload="alert(1)"></svg>').decode()
        self.assertEqual(self.request(admin,'/api/admin/project/images',{'image':bad})[0],400)
        self.assertEqual(self.request(admin,'/api/admin/icons/check',{'image':bad})[0],400)
