import copy
import time
from unittest.mock import patch
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
import test_server as base
import server
import publications

class PublicationAPI(unittest.TestCase):
    setUpClass = classmethod(base.API.setUpClass.__func__)
    tearDownClass = classmethod(base.API.tearDownClass.__func__)
    client = base.API.client
    request = base.API.request
    register = base.API.register

    def setUp(self):
        with server.connect() as db:
            for table in ('share_votes','share_views','share_allocations','share_saves','shares','projects','sessions','attempts','favorites','users'):
                db.execute('DELETE FROM '+table)

    def publish(self, name='Test', visibility='public'):
        owner=self.client();self.register(owner,'author')
        document=copy.deepcopy(base.DOCUMENT);document['name']=name
        pid=self.request(owner,'/api/projects',{'document':document})[1]['id']
        status,result,_=self.request(owner,'/api/publish',{'projectId':pid,'visibility':visibility})
        self.assertEqual(status,200,result)
        return owner,pid,result['token'],document

    def test_builds_stay_out_of_server_documents_and_legacy_links(self):
        owner,pid,token,document=self.publish(visibility='unlisted')
        document['branches'][0]['talents']=[{'id':'talent','name':'Сила','row':0,'col':0,'icon':'inv_misc_questionmark','maxRank':5,'descriptions':['1','2','3','4','5'],'requires':''}]
        document['build']={'talent':3}
        self.assertEqual(self.request(owner,'/api/projects',{'id':pid,'document':document})[0],200)
        self.assertEqual(self.request(owner,'/api/projects/'+pid)[1]['document']['build'],{})
        for endpoint,payload in [('/api/publish',{'projectId':pid}),('/api/share',{'document':document})]:
            status,result,_=self.request(owner,endpoint,payload)
            self.assertEqual(status,200,result)
            new_token=result['token']
            self.assertEqual(self.request(self.client(),'/api/shared/'+new_token)[1]['document']['build'],{})
            with server.connect() as db:
                self.assertEqual(json.loads(db.execute('SELECT document FROM shares WHERE token=?',(new_token,)).fetchone()[0])['build'],{})
        # Old database rows must also open empty without republishing or rewriting the snapshot.
        with server.connect() as db:
            db.execute('UPDATE shares SET document=? WHERE token=?',(json.dumps(document),token))
            db.execute('UPDATE projects SET document=? WHERE id=?',(json.dumps(document),pid))
        self.assertEqual(self.request(self.client(),'/api/shared/'+token)[1]['document']['build'],{})
        self.assertEqual(self.request(owner,'/api/projects/'+pid)[1]['document']['build'],{})
        with server.connect() as db:
            self.assertEqual(json.loads(db.execute('SELECT document FROM projects WHERE id=?',(pid,)).fetchone()[0])['build'],{'talent':3})
        self.assertEqual(document['build'],{'talent':3})

    def test_visibility_ownership_and_immutable_versions(self):
        owner,pid,token,document=self.publish(visibility='unlisted');guest=self.client()
        self.assertEqual(self.request(guest,'/api/rankings')[1]['publications'],[])
        self.assertEqual(self.request(guest,'/api/shared/'+token)[0],200)
        initial=self.request(owner,'/api/publications')[1]['publications'][0]['published']
        self.assertEqual(self.request(owner,'/api/publications/'+token+'/visibility',{'visibility':'public'})[0],200)
        self.assertEqual(self.request(guest,'/api/rankings')[1]['publications'][0]['token'],token)
        document['name']='Changed draft'
        self.request(owner,'/api/projects',{'id':pid,'document':document})
        self.assertEqual(self.request(guest,'/api/shared/'+token)[1]['document']['name'],'Test')
        second=self.request(owner,'/api/publish',{'projectId':pid,'visibility':'public'})[1]
        self.assertEqual(second['publication']['version'],2)
        self.assertEqual(self.request(guest,'/api/shared/'+second['token'])[1]['document']['name'],'Changed draft')
        self.request(owner,'/api/publications/'+token+'/visibility',{'visibility':'unlisted'})
        self.request(owner,'/api/publications/'+token+'/visibility',{'visibility':'public'})
        self.assertEqual(self.request(guest,'/api/shared/'+token)[1]['publication']['published'],initial)
        attacker=self.client();self.register(attacker,'intruder')
        self.assertEqual(self.request(attacker,'/api/publications/'+token+'/visibility',{'visibility':'unlisted'})[0],404)
        self.assertEqual(self.request(attacker,'/api/publish',{'projectId':pid,'visibility':'public'})[0],404)
        self.assertEqual(self.request(guest,'/api/publications')[0],401)

    def test_votes_toggle_switch_and_private_dislikes(self):
        owner,pid,token,_=self.publish();guest=self.client();voter=self.client();self.register(voter,'voter');path='/api/shared/'+token
        self.assertEqual(self.request(guest,path+'/vote',{'vote':1})[0],401)
        self.assertEqual(self.request(owner,path+'/vote',{'vote':1})[0],403)
        first=self.request(voter,path+'/vote',{'vote':1})[1]['publication'];self.assertEqual(first['likes'],1);self.assertEqual(first['myVote'],1);self.assertNotIn('dislikes',first)
        switched=self.request(voter,path+'/vote',{'vote':-1})[1]['publication'];self.assertEqual(switched['likes'],0);self.assertEqual(switched['myVote'],-1);self.assertNotIn('dislikes',switched)
        author=self.request(owner,path)[1]['publication'];self.assertEqual(author['dislikes'],1)
        public=self.request(guest,path)[1]['publication'];self.assertNotIn('dislikes',public);self.assertNotIn('projectId',public)
        ranking=self.request(guest,'/api/rankings')[1]['publications'][0];self.assertNotIn('dislikes',ranking)
        others=self.request(voter,'/api/rankings')[1]['publications'][0];self.assertNotIn('dislikes',others)
        self.assertEqual(self.request(owner,'/api/publications')[1]['publications'][0]['dislikes'],1)
        self.request(voter,path+'/vote',{'vote':-1});self.assertEqual(self.request(owner,path)[1]['publication']['dislikes'],0)
        self.assertEqual(self.request(voter,path+'/vote',{'vote':2})[0],400)

    def test_rankings_sort_unique_views_usage_and_pagination(self):
        owner,pid,token,_=self.publish('First');guest=self.client()
        second=self.request(owner,'/api/publish',{'projectId':pid,'visibility':'public'})[1]['token']
        hidden=self.request(owner,'/api/publish',{'projectId':pid,'visibility':'unlisted'})[1]['token']
        for _ in range(3):self.request(guest,'/api/shared/'+token)
        for visitor in [self.client(),self.client()]:self.request(visitor,'/api/shared/'+hidden)
        self.assertEqual(self.request(guest,'/api/shared/'+token)[1]['publication']['views'],1)
        self.request(guest,'/api/shared/'+second+'/interact',{})
        self.assertEqual(self.request(guest,'/api/rankings?sort=views')[1]['publications'][0]['token'],token)
        self.assertEqual(self.request(guest,'/api/rankings?sort=usage')[1]['publications'][0]['token'],second)
        self.assertEqual(self.request(guest,'/api/rankings?sort=latest')[1]['publications'][0]['token'],second)
        self.assertNotIn(hidden,[r['token'] for r in self.request(guest,'/api/rankings')[1]['publications']])
        for _ in range(20):self.request(owner,'/api/publish',{'projectId':pid,'visibility':'public'})
        first=self.request(guest,'/api/rankings?sort=latest')[1];self.assertEqual(len(first['publications']),20);self.assertTrue(first['hasMore'])
        next=self.request(guest,'/api/rankings?sort=latest&page=1')[1];self.assertEqual(len(next['publications']),2);self.assertFalse(next['hasMore'])
        self.assertEqual(self.request(guest,'/api/rankings?sort=invalid')[0],400)

    def test_likes_sort_and_branch_icons(self):
        owner,pid,first,document=self.publish('First')
        document['branches'][0]['icon']='spell_fire_flamebolt'
        self.request(owner,'/api/projects',{'id':pid,'document':document})
        second=self.request(owner,'/api/publish',{'projectId':pid,'visibility':'public'})[1]['token']
        hidden=self.request(owner,'/api/publish',{'projectId':pid,'visibility':'unlisted'})[1]['token']
        one,two,three=self.client(),self.client(),self.client()
        self.register(one,'like_one');self.register(two,'like_two');self.register(three,'like_three')
        for token in [first,second,hidden]:self.request(one,'/api/shared/'+token+'/vote',{'vote':1})
        self.request(two,'/api/shared/'+second+'/vote',{'vote':1})
        self.request(three,'/api/shared/'+first+'/vote',{'vote':-1})
        cards=self.request(self.client(),'/api/rankings?sort=likes')[1]['publications']
        self.assertEqual([card['token'] for card in cards],[second,first])
        self.assertEqual([card['likes'] for card in cards],[2,1])
        self.assertEqual(cards[0]['branches'][0]['icon'],'spell_fire_flamebolt')
        self.assertNotIn('dislikes',cards[1])

    def test_avatar_profile_is_author_owned_and_updates_publications(self):
        owner,pid,token,_=self.publish()
        guest=self.client();other=self.client();self.register(other,'avatar_other')
        self.assertEqual(self.request(guest,'/api/profile/avatar',{'avatar':'spell_fire_flamebolt'})[0],401)
        self.assertEqual(self.request(owner,'/api/profile/avatar',{'avatar':'https://example.com/avatar.png'})[0],400)
        profile=self.request(owner,'/api/profile/avatar',{'avatar':'spell_fire_flamebolt'})
        self.assertEqual(profile[0],200)
        self.assertEqual(self.request(owner,'/api/me')[1]['user']['avatar'],'spell_fire_flamebolt')
        self.assertEqual(self.request(other,'/api/me')[1]['user']['avatar'],'inv_misc_questionmark')
        publication=self.request(guest,'/api/shared/'+token)[1]
        self.assertEqual(publication['publication']['avatar'],'spell_fire_flamebolt')
        self.assertNotIn('avatar',publication['document'])
        self.assertEqual(self.request(guest,'/api/rankings')[1]['publications'][0]['avatar'],'spell_fire_flamebolt')

    def test_private_publications_deny_every_non_owner_access(self):
        owner,pid,token,document=self.publish(visibility='private')
        guest=self.client();other=self.client();self.register(other,'private_other')
        self.assertEqual(self.request(guest,'/api/rankings')[1]['publications'],[])
        self.assertEqual(self.request(owner,'/api/rankings')[1]['publications'],[])
        self.assertEqual(self.request(owner,'/api/publications')[1]['publications'][0]['visibility'],'private')
        for client in (guest,other):
            self.assertEqual(self.request(client,'/api/shared/'+token)[0],404)
            self.assertEqual(self.request(client,'/api/shared/'+token+'/interact',{})[0],404)
            self.assertEqual(self.request(client,'/api/shared/'+token+'/vote',{'vote':1})[0],404)
        self.assertEqual(self.request(other,'/api/projects',{'document':document,'sourceShare':token})[0],404)
        self.assertEqual(self.request(other,'/api/projects')[1]['projects'],[])
        with server.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM share_views WHERE token=?',(token,)).fetchone()[0],0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM share_allocations WHERE token=?',(token,)).fetchone()[0],0)
            uid=db.execute('SELECT id FROM users WHERE login=?',('private_other',)).fetchone()[0]
            self.assertIsNone(publications.info(db,token,uid))
        legacy=self.request(owner,'/api/share',{'document':document,'visibility':'private'})
        self.assertEqual(legacy[0],200)
        self.assertEqual(self.request(guest,'/api/shared/'+legacy[1]['token'])[0],404)
        self.assertEqual(self.request(owner,'/api/shared/'+token)[0],200)
        self.assertEqual(self.request(owner,'/api/publications/'+token+'/visibility',{'visibility':'unlisted'})[0],200)
        self.assertEqual(self.request(other,'/api/shared/'+token)[0],200)
        self.assertEqual(self.request(owner,'/api/publications/'+token+'/visibility',{'visibility':'private'})[0],200)
        self.assertEqual(self.request(other,'/api/shared/'+token)[0],404)
        self.assertEqual(self.request(owner,'/api/publications/'+token+'/visibility',{'visibility':'public'})[0],200)
        self.assertEqual(len(self.request(guest,'/api/rankings')[1]['publications']),1)

    def test_layered_class_icon_round_trip_and_snapshot(self):
        owner=self.client();self.register(owner,'emblem_owner')
        document=copy.deepcopy(base.DOCUMENT)
        emblem={'background':'#234567','layers':[{'icon':'inv_sword_04','opacity':.45},{'icon':'inv_shield_04','opacity':.7}]}
        document['classIcon']=emblem
        status,result,_=self.request(owner,'/api/projects',{'document':document})
        self.assertEqual(status,200);pid=result['id']
        self.assertEqual(self.request(owner,'/api/projects')[1]['projects'][0]['classIcon'],emblem)
        token=self.request(owner,'/api/publish',{'projectId':pid,'visibility':'private'})[1]['token']
        saved=self.request(owner,'/api/shared/'+token)[1]
        self.assertEqual(saved['publication']['classIcon'],emblem)
        self.assertEqual(saved['document']['classIcon'],emblem)
        document['classIcon']={'background':'#000000','layers':[{'icon':'inv_axe_09','opacity':1}]}
        self.request(owner,'/api/projects',{'id':pid,'document':document})
        self.assertEqual(self.request(owner,'/api/shared/'+token)[1]['document']['classIcon'],emblem)
        for bad in [None,{}, {'background':'red','layers':emblem['layers']}, {'background':'#ffffff','layers':[]}, {'background':'#ffffff','layers':emblem['layers']*2}, {'background':'#ffffff','layers':[{'icon':'javascript:alert(1)','opacity':1}]}, {'background':'#ffffff','layers':[{'icon':'inv_sword_04','opacity':2}]}, {'background':'#ffffff','layers':[{'icon':'inv_sword_04','opacity':True}]}]:
            document['classIcon']=bad
            self.assertEqual(self.request(owner,'/api/projects',{'document':document})[0],400,bad)

    def test_archive_restore_preserves_access_policy_stats_and_deadline(self):
        owner,pid,token,document=self.publish()
        guest=self.client();other=self.client();self.register(other,'archive_other')
        self.request(guest,'/api/shared/'+token)
        self.request(other,'/api/shared/'+token+'/vote',{'vote':1})
        self.assertEqual(self.request(other,'/api/publications/'+token+'/archive',{})[0],404)
        archived=self.request(owner,'/api/publications/'+token+'/archive',{})
        self.assertEqual(archived[0],200);info=archived[1]['publication']
        self.assertTrue(info['archived']);self.assertEqual(info['expiresAt']-info['archivedAt'],30*86400)
        with patch('server.time.time',return_value=info['archivedAt']+100):
            again=self.request(owner,'/api/publications/'+token+'/archive',{})[1]['publication']
            self.assertEqual(again['archivedAt'],info['archivedAt'])
        for path,data in [('/api/shared/'+token,None),('/api/shared/'+token+'/interact',{}),('/api/shared/'+token+'/vote',{'vote':1})]:
            self.assertEqual(self.request(other,path,data)[0],404)
        self.assertEqual(self.request(other,'/api/projects',{'document':document,'sourceShare':token})[0],404)
        self.assertEqual(self.request(guest,'/api/rankings')[1]['publications'],[])
        self.assertEqual(self.request(owner,'/api/publications')[1]['publications'],[])
        self.assertEqual(len(self.request(owner,'/api/publications?archived=1')[1]['publications']),1)
        self.assertEqual(self.request(owner,'/api/publications/'+token+'/visibility',{'visibility':'private'})[0],409)
        restored=self.request(owner,'/api/publications/'+token+'/restore',{})[1]['publication']
        self.assertFalse(restored['archived']);self.assertIsNone(restored['expiresAt']);self.assertEqual(restored['visibility'],'public');self.assertEqual(restored['likes'],1)
        self.assertEqual(self.request(guest,'/api/shared/'+token)[0],200)
        self.assertEqual(len(self.request(guest,'/api/rankings')[1]['publications']),1)

    def test_archive_expires_at_thirty_days_and_keeps_working_project_and_versions(self):
        owner,pid,token,document=self.publish()
        self.request(self.client(),'/api/shared/'+token)
        self.request(owner,'/api/shared/'+token+'/interact',{})
        self.request(owner,'/api/projects',{'document':document,'sourceShare':token})
        clock=int(time.time())
        with server.connect() as db:db.execute('UPDATE shares SET archived_at=? WHERE token=?',(clock-30*86400+1,token))
        with patch('server.time.time',return_value=clock):
            self.assertEqual(self.request(owner,'/api/shared/'+token)[0],200)
            with server.connect() as db:db.execute('UPDATE shares SET archived_at=? WHERE token=?',(clock-30*86400,token))
            self.assertEqual(self.request(owner,'/api/publications/'+token+'/restore',{})[0],404)
        with server.connect() as db:
            for table in ('shares','share_views','share_allocations','share_saves','share_votes'):
                self.assertEqual(db.execute(f'SELECT COUNT(*) FROM {table} WHERE token=?',(token,)).fetchone()[0],0)
            self.assertIsNotNone(db.execute('SELECT id FROM projects WHERE id=?',(pid,)).fetchone())
        created=self.request(owner,'/api/publish',{'projectId':pid,'visibility':'public'})
        self.assertEqual(created[0],200);self.assertEqual(created[1]['publication']['version'],2)

    def test_emblem_transform_and_glow_validation(self):
        owner=self.client();self.register(owner,'transform_owner')
        document=copy.deepcopy(base.DOCUMENT)
        model={'glow':{'color':'#fedcba','radius':100,'strength':80},'layers':[{'icon':'inv_sword_04','opacity':.8,'x':25,'y':-20,'scale':1.5,'rotation':90}]}
        document['classIcon']=model
        status,result,_=self.request(owner,'/api/projects',{'document':document});self.assertEqual(status,200)
        self.assertEqual(self.request(owner,'/api/projects/'+result['id'])[1]['document']['classIcon'],model)
        for field,value in [('x',101),('y',-101),('scale',.74),('scale',1.51),('rotation',181)]:
            bad=copy.deepcopy(model);bad['layers'][0][field]=value;document['classIcon']=bad
            self.assertEqual(self.request(owner,'/api/projects',{'document':document})[0],400)
        for field,value in [('radius',-1),('strength',101),('color','url(x)')]:
            bad=copy.deepcopy(model);bad['glow'][field]=value;document['classIcon']=bad
            self.assertEqual(self.request(owner,'/api/projects',{'document':document})[0],400)

class PublicationMigration(unittest.TestCase):
    def test_existing_shares_stay_unlisted_without_claimed_owner(self):
        with tempfile.TemporaryDirectory() as tmp:
            db=sqlite3.connect(str(Path(tmp)/'old.sqlite'))
            db.execute('CREATE TABLE shares(token TEXT PRIMARY KEY,document TEXT,created INTEGER)')
            db.execute('INSERT INTO shares VALUES(?,?,?)',('old',json.dumps(base.DOCUMENT),123))
            publications.migrate(db);publications.migrate(db)
            row=db.execute('SELECT visibility,owner_id,published_at,document FROM shares').fetchone()
            self.assertEqual(row[:3],('unlisted',None,123));self.assertEqual(json.loads(row[3]),base.DOCUMENT)
            db.close()

class AvatarMigration(unittest.TestCase):
    def test_existing_users_get_default_avatar_without_password_changes(self):
        previous=server.DB
        with tempfile.TemporaryDirectory() as tmp:
            try:
                server.DB=str(Path(tmp)/'old-users.sqlite')
                db=sqlite3.connect(server.DB)
                db.execute('CREATE TABLE users(id INTEGER PRIMARY KEY,login TEXT UNIQUE COLLATE NOCASE,salt TEXT,password TEXT)')
                db.execute('INSERT INTO users VALUES(1,?,?,?)',('old_author','old_salt','old_hash'));db.commit();db.close()
                server.initialize();server.initialize()
                with server.connect() as db:
                    self.assertEqual(db.execute('SELECT login,salt,password,avatar FROM users').fetchone(),('old_author','old_salt','old_hash','inv_misc_questionmark'))
            finally:
                server.DB=previous

class ArchiveMaintenance(unittest.TestCase):
    def test_idle_server_purges_expired_snapshots_without_an_api_request(self):
        previous=server.DB
        with tempfile.TemporaryDirectory() as tmp:
            try:
                server.DB=str(Path(tmp)/'maintenance.sqlite');server.initialize()
                with server.connect() as db:
                    token=publications.create(db,copy.deepcopy(base.DOCUMENT),None)
                    db.execute('UPDATE shares SET archived_at=? WHERE token=?',(int(time.time())-30*86400-10,token))
                    db.execute('INSERT INTO share_views VALUES(?,?)',(token,'visitor'))
                http=server.ArchiveHTTPServer.__new__(server.ArchiveHTTPServer)
                with patch('server.time.monotonic',return_value=1000):http.service_actions()
                self.assertEqual(http._next_archive_cleanup,1060)
                with server.connect() as db:
                    self.assertIsNone(db.execute('SELECT token FROM shares WHERE token=?',(token,)).fetchone())
                    self.assertEqual(db.execute('SELECT COUNT(*) FROM share_views').fetchone()[0],0)
            finally:server.DB=previous
