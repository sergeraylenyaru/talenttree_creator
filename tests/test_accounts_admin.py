import base64,copy,io,os,re
from unittest.mock import patch
import unittest
import test_server as base
import server,accounts
from PIL import Image

class AccountsAdminAPI(unittest.TestCase):
    setUpClass=classmethod(base.API.setUpClass.__func__)
    tearDownClass=classmethod(base.API.tearDownClass.__func__)
    client=base.API.client
    request=base.API.request
    register=base.API.register
    def setUp(self):
        self.env=patch.dict(os.environ,{'REQUIRE_EMAIL_VERIFICATION':'0','SMTP_HOST':'','SMTP_FROM':'','APP_URL':''});self.env.start();self.addCleanup(self.env.stop)
        with server.connect() as db:
            for table in ('admin_events','admin_sessions','email_tokens','icon_assets','share_votes','share_views','share_allocations','share_saves','shares','publication_sequences','projects','sessions','attempts','favorites','users'):db.execute('DELETE FROM '+table)
    def admin(self):
        client=self.client();self.register(client,'administrator')
        with server.connect() as db:db.execute("UPDATE users SET is_admin=1,email_verified=1 WHERE login='administrator'")
        admin=self.client();self.assertEqual(self.request(admin,'/api/admin/login',{'login':'administrator@example.test','password':'test-password-123'})[0],200)
        return client,admin
    def test_email_registration_and_legacy_username(self):
        user=self.client()
        self.assertEqual(self.request(user,'/api/register',{'login':'new_user','password':'test-password-123'})[0],400)
        self.assertEqual(self.request(user,'/api/register',{'login':'new_user','email':'not an email','password':'test-password-123'})[0],400)
        self.assertEqual(self.request(user,'/api/register',{'login':'new_user','email':'Person@example.test','password':'test-password-123','is_admin':True})[0],200)
        profile=self.request(user,'/api/me')[1]['user'];self.assertEqual(profile['email'],'person@example.test');self.assertFalse(profile['isAdmin']);self.assertFalse(profile['emailVerified'])
        self.assertEqual(self.request(self.client(),'/api/register',{'login':'another','email':'PERSON@example.test','password':'test-password-123'})[0],409)
        self.assertEqual(self.request(self.client(),'/api/login',{'login':'PERSON@example.test','password':'test-password-123'})[0],200)
        with server.connect() as db:
            salt='12'*16;db.execute('INSERT INTO users(login,salt,password) VALUES(?,?,?)',('legacy',salt,server.password_hash('test-password-123',salt)))
        self.assertEqual(self.request(self.client(),'/api/login',{'login':'legacy','password':'test-password-123'})[0],200)
    def test_admin_session_is_separate_and_block_revokes_both_realms(self):
        normal,admin=self.admin();regular=self.client();self.register(regular,'regular')
        self.assertEqual(self.request(normal,'/api/admin/users')[0],403)
        self.assertEqual(self.request(regular,'/api/admin/login',{'login':'regular','password':'test-password-123'})[0],401)
        self.assertIsNone(self.request(admin,'/api/me')[1]['user'])
        users=self.request(admin,'/api/admin/users')[1]['users'];uid=next(u['id'] for u in users if u['login']=='regular');own=next(u['id'] for u in users if u['login']=='administrator')
        self.assertEqual(self.request(admin,'/api/admin/users/'+str(own),{'action':'block'})[0],409)
        self.assertEqual(self.request(admin,'/api/admin/users/'+str(own),{'action':'demote'})[0],409)
        self.assertEqual(self.request(admin,'/api/admin/users/'+str(own),{'action':'delete'})[0],409)
        self.assertEqual(self.request(admin,'/api/admin/users/'+str(uid),{'action':'block'})[0],200)
        self.assertIsNone(self.request(regular,'/api/me')[1]['user'])
        self.assertEqual(self.request(regular,'/api/login',{'login':'regular','password':'test-password-123'})[0],401)
        self.assertEqual(self.request(admin,'/api/admin/users/'+str(uid),{'action':'unblock'})[0],200)
        self.assertEqual(self.request(regular,'/api/login',{'login':'regular','password':'test-password-123'})[0],200)
        self.assertEqual(self.request(admin,'/api/admin/users/'+str(uid),{'action':'promote'})[0],200)
        other=self.client();self.assertEqual(self.request(other,'/api/admin/login',{'login':'regular','password':'test-password-123'})[0],200)
        self.assertEqual(self.request(admin,'/api/admin/users/'+str(uid),{'action':'demote'})[0],200)
        self.assertEqual(self.request(other,'/api/admin/users')[0],403)
        with server.connect() as db:self.assertGreater(db.execute('SELECT COUNT(*) FROM admin_events').fetchone()[0],0)
    def test_admin_delete_removes_owned_data_without_deleting_independent_copies(self):
        normal,admin=self.admin();user=self.client();self.register(user,'deleted_user');other=self.client();self.register(other,'copy_user')
        pid=self.request(user,'/api/projects',{'document':copy.deepcopy(base.DOCUMENT)})[1]['id'];token=self.request(user,'/api/publish',{'projectId':pid,'visibility':'public'})[1]['token'];copyid=self.request(other,'/api/projects',{'document':copy.deepcopy(base.DOCUMENT),'sourceShare':token})[1]['id'];self.request(other,'/api/shared/'+token+'/vote',{'vote':1})
        uid=next(u['id'] for u in self.request(admin,'/api/admin/users')[1]['users'] if u['login']=='deleted_user')
        self.assertEqual(self.request(admin,'/api/admin/users/'+str(uid),{'action':'delete','confirm':'deleted_user'})[0],200)
        self.assertEqual(self.request(other,'/api/shared/'+token)[0],404);self.assertEqual(self.request(other,'/api/projects/'+copyid)[0],200)
        self.assertIsNone(self.request(user,'/api/me')[1]['user'])
    def test_icon_upload_is_admin_only_sanitized_and_removal_preserves_existing_trees(self):
        normal,admin=self.admin();output=io.BytesIO();Image.new('RGBA',(32,32),(200,100,0,100)).save(output,'PNG');data={'name':'New icon','category':'armor','image':base64.b64encode(output.getvalue()).decode()}
        self.assertEqual(self.request(normal,'/api/admin/icons',data)[0],403)
        status,result,_=self.request(admin,'/api/admin/icons',data);self.assertEqual(status,201,result);ident=result['id']
        self.assertEqual(self.request(normal,'/api/icons')[1]['icons'][0]['id'],ident)
        doc=copy.deepcopy(base.DOCUMENT);doc['classIcon']={'layers':[{'icon':ident,'opacity':1}]};self.assertEqual(self.request(normal,'/api/projects',{'document':doc})[0],200)
        self.assertEqual(self.request(normal,'/api/profile/avatar',{'avatar':ident})[0],200)
        with normal.open(self.url+'/media/icons/'+ident[7:]+'.png') as response:
            self.assertEqual(response.headers['Content-Type'],'image/png');self.assertEqual(Image.open(io.BytesIO(response.read())).size,(128,128))
        self.assertEqual(self.request(admin,'/api/admin/icons/'+ident[7:],{},'DELETE')[0],200);self.assertEqual(self.request(normal,'/api/icons')[1]['icons'],[])
        self.assertEqual(self.request(normal,'/api/projects',{'document':doc})[0],200)
        self.assertEqual(self.request(admin,'/api/admin/icons/'+ident[7:],{})[0],200)
        bad=dict(data,image=base64.b64encode(b'<svg><script>alert(1)</script></svg>').decode());self.assertEqual(self.request(admin,'/api/admin/icons',bad)[0],400)
        self.assertEqual(self.request(admin,'/api/admin/icons',data,origin='https://other.example')[0],403)
    def test_icon_category_management_reassignment_and_access(self):
        normal,admin=self.admin()
        self.assertEqual(self.request(normal,'/api/admin/categories',{'name':'Denied'})[0],403)
        self.assertEqual(self.request(normal,'/api/admin/categories')[0],403)
        self.assertEqual(self.request(admin,'/api/admin/categories',{'name':'   '})[0],400)
        status,result,_=self.request(admin,'/api/admin/categories',{'name':'Astral blades','kind':'weapon'})
        self.assertEqual(status,201,result);category=result['id']
        self.assertEqual(self.request(admin,'/api/admin/categories',{'name':'astral blades'})[0],409)
        output=io.BytesIO();Image.new('RGB',(32,32),'gold').save(output,'PNG')
        payload={'name':'Astral blade','category':category,'image':base64.b64encode(output.getvalue()).decode()}
        status,result,_=self.request(admin,'/api/admin/icons',payload);self.assertEqual(status,201,result);icon=result['id']
        catalog=self.request(normal,'/api/icons')[1];item=next(i for i in catalog['icons'] if i['id']==icon)
        self.assertEqual(item['category'],category);self.assertEqual(item['categoryKind'],'weapon')
        self.assertIn({'id':category,'name':'Astral blades','kind':'weapon'},catalog['categories'])
        self.assertEqual(self.request(admin,'/api/admin/categories/'+category,{},'DELETE')[0],409)
        self.assertEqual(self.request(admin,'/api/admin/categories/'+category,{'name':'Astral armor','kind':'armor'})[0],200)
        self.assertEqual(self.request(normal,'/api/icons')[1]['icons'][0]['categoryKind'],'armor')
        self.assertEqual(self.request(admin,'/api/admin/icons/'+icon[7:],{'category':'missing'})[0],400)
        self.assertEqual(self.request(normal,'/api/admin/icons/'+icon[7:],{'category':'armor'})[0],403)
        self.assertEqual(self.request(admin,'/api/admin/icons/'+icon[7:],{},'DELETE')[0],200)
        self.assertEqual(self.request(admin,'/api/admin/icons/'+icon[7:],{'category':'general'})[0],200)
        self.assertEqual(self.request(normal,'/api/icons')[1]['icons'],[]) # Editing never restores a removed icon.
        self.assertEqual(self.request(admin,'/api/admin/categories/'+category,{},'DELETE')[0],200)
        self.assertEqual(self.request(admin,'/api/admin/icons/'+icon[7:],{})[0],200)
        self.assertEqual(self.request(normal,'/api/icons')[1]['icons'][0]['category'],'general')
        self.assertEqual(self.request(admin,'/api/admin/categories/general',{},'DELETE')[0],409)
        self.assertEqual(self.request(admin,'/api/admin/categories/weapon',{'name':'Weapons','kind':'armor'})[0],409)
        self.assertEqual(self.request(admin,'/api/admin/icons',payload)[0],400) # Deleted category rejected on upload.

    def test_email_verification_and_reset_are_single_use_and_revoke_sessions(self):
        mail=[]
        with patch.dict(os.environ,{'SMTP_HOST':'smtp.example.test','SMTP_FROM':'noreply@example.test','APP_URL':'https://talent.example.test','REQUIRE_EMAIL_VERIFICATION':'1'}),patch('accounts.send_mail',side_effect=lambda *args:mail.append(args)):
            user=self.client();payload={'login':'mail_user','email':'mail@example.test','password':'test-password-123'}
            status,result,headers=self.request(user,'/api/register',payload);self.assertEqual(status,201,result);self.assertTrue(result['verificationPending']);self.assertNotIn('Set-Cookie',headers)
            self.assertEqual(self.request(user,'/api/login',payload)[0],403)
            raw=re.search(r'#verify=([\w-]+)',mail[-1][2])[1];self.assertEqual(self.request(user,'/api/auth/verify',{'token':raw})[0],200);self.assertEqual(self.request(user,'/api/auth/verify',{'token':raw})[0],400)
            self.assertEqual(self.request(user,'/api/login',payload)[0],200)
            self.assertEqual(self.request(self.client(),'/api/auth/forgot',{'email':'mail@example.test'})[0],202);raw=re.search(r'#reset=([\w-]+)',mail[-1][2])[1]
            self.assertEqual(self.request(self.client(),'/api/auth/reset',{'token':raw,'password':'replacement-password'})[0],200)
            self.assertIsNone(self.request(user,'/api/me')[1]['user']);self.assertEqual(self.request(user,'/api/login',payload)[0],401)
            self.assertEqual(self.request(user,'/api/login',dict(payload,password='replacement-password'))[0],200)
            self.assertEqual(self.request(user,'/api/auth/reset',{'token':raw,'password':'another-password'})[0],400)
            with server.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM email_tokens').fetchone()[0],0)
    def test_mail_unconfigured_and_change_address_requires_password(self):
        user=self.client();self.register(user,'address_user')
        self.assertEqual(self.request(user,'/api/auth/forgot',{'email':'address_user@example.test'})[0],503)
        self.assertEqual(self.request(user,'/api/auth/email',{'email':'changed@example.test','password':'wrong-password'})[0],401)
        self.assertEqual(self.request(user,'/api/auth/email',{'email':'changed@example.test','password':'test-password-123'})[0],200)
        profile=self.request(user,'/api/me')[1]['user'];self.assertEqual(profile['email'],'changed@example.test');self.assertFalse(profile['emailVerified'])
