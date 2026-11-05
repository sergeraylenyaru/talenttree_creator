import copy
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
        for _ in range(12):self.request(owner,'/api/publish',{'projectId':pid,'visibility':'public'})
        first=self.request(guest,'/api/rankings?sort=latest')[1];self.assertEqual(len(first['publications']),12);self.assertTrue(first['hasMore'])
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
