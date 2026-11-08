import copy,unittest
from concurrent.futures import ThreadPoolExecutor
import test_server as base
import server

class EditorMetadataAPI(unittest.TestCase):
    setUpClass=classmethod(base.API.setUpClass.__func__)
    tearDownClass=classmethod(base.API.tearDownClass.__func__)
    client=base.API.client
    request=base.API.request
    register=base.API.register
    def setUp(self):
        with server.connect() as db:
            for table in ('share_votes','share_views','share_allocations','share_saves','shares','projects','sessions','attempts','favorites','users'):db.execute('DELETE FROM '+table)
    def test_full_title_unique_per_account_and_publications_are_unlimited(self):
        a,b=self.client(),self.client();self.register(a,'first');self.register(b,'second')
        d=copy.deepcopy(base.DOCUMENT);d.update(name='Паладин',subtitle='v1 воин света',description='История класса')
        pid=self.request(a,'/api/projects',{'document':d})[1]['id']
        same=copy.deepcopy(d);same.update(name='  ПАЛАДИН ',subtitle='v1   воин света ')
        self.assertEqual(self.request(a,'/api/projects',{'document':same})[0],409)
        full=copy.deepcopy(d);full.update(name='Паладин v1 воин света',subtitle='')
        self.assertEqual(self.request(a,'/api/projects',{'document':full})[0],409)
        self.assertEqual(self.request(b,'/api/projects',{'document':d})[0],200)
        self.assertEqual(self.request(a,'/api/projects',{'id':pid,'document':d})[0],200)
        for version in range(1,4):
            status,result,_=self.request(a,'/api/publish',{'projectId':pid,'visibility':'public'});self.assertEqual(status,200);self.assertEqual(result['publication']['version'],version);self.assertEqual(result['publication']['subtitle'],d['subtitle'])
        second=copy.deepcopy(d);second['subtitle']='v2'
        other=self.request(a,'/api/projects',{'document':second})[1]['id']
        self.assertEqual(self.request(a,'/api/projects',{'id':other,'document':d})[0],409)
        self.assertEqual(self.request(a,'/api/projects',{'document':d,'copy':True})[0],200)
        self.request(a,'/api/projects/'+pid,{},'DELETE');new=self.request(a,'/api/projects',{'document':d});self.assertEqual(new[0],200)
        self.assertEqual(self.request(a,'/api/projects/'+pid+'/restore',{})[0],409)

    def test_concurrent_saves_cannot_create_duplicate_drafts(self):
        a,b=self.client(),self.client();self.register(a,'concurrent')
        self.request(b,'/api/login',{'login':'concurrent','password':'test-password-123'})
        with ThreadPoolExecutor(max_workers=2) as pool:statuses=list(pool.map(lambda c:self.request(c,'/api/projects',{'document':copy.deepcopy(base.DOCUMENT)})[0],(a,b)))
        self.assertEqual(sorted(statuses),[200,409])

    def test_new_fields_preserved_and_invalid_data_rejected(self):
        a=self.client();self.register(a,'metadata')
        d=copy.deepcopy(base.DOCUMENT);d.update(subtitle='v1',description='История')
        d['character']={'hp':100,'hpDescription':'Жизнь','race':'Человек','gender':'Мужской','armory':'','resources':[{'name':'Кровь','description':'Накапливается за попадания','max':100,'current':0,'display':'bar','shape':'circle','color':'#ff0000'}]}
        d['abilities']=[{'id':'a','name':'Удар','icon':'inv_misc_book_09','description':'Урон','requirements':['Кинжалы','Латы'],'learningMode':'base','range':0,'cast':0,'resource':0,'cooldown':0,'resourceType':'Кровь'}]
        pid=self.request(a,'/api/projects',{'document':d})[1]['id'];self.assertEqual(self.request(a,'/api/projects/'+pid)[1]['document'],d)
        d['abilities'][0]['requirements']='Щит и свободная рука; стойка Стража'
        self.assertEqual(self.request(a,'/api/projects',{'id':pid,'document':d})[0],200)
        self.assertEqual(self.request(a,'/api/projects/'+pid)[1]['document'],d)
        for change in ('subtitle','description','requirements','resource','learning','requirement_text'):
            bad=copy.deepcopy(d)
            if change=='subtitle':bad['subtitle']='x'*121
            if change=='description':bad['description']=[]
            if change=='requirements':bad['abilities'][0]['requirements']=['Кинжалы','Кинжалы']
            if change=='resource':bad['character']['resources'][0]['description']='x'*3001
            if change=='learning':bad['abilities'][0]['learningMode']='unknown'
            if change=='requirement_text':bad['abilities'][0]['requirements']='x'*1001
            self.assertEqual(self.request(a,'/api/projects',{'id':pid,'document':bad})[0],400)

    def test_resource_costs_and_primary_choice_are_validated_and_publish_without_build_state(self):
        a=self.client();self.register(a,'resource_author')
        d=copy.deepcopy(base.DOCUMENT);d['specialization']={'requiredPoints':31};d['primaryBranchId']='a'
        d['character']={'hp':1000,'race':'Человек','gender':'Мужской','armory':'','resources':[{'id':'mana','name':'Мана','max':100,'current':100,'display':'bar','shape':'circle','color':'#397de1','unit':'percent'}]}
        d['abilities']=[{'id':'cost','name':'Удар','description':'Текст','icon':'inv_misc_book_09','kind':'active','learningMode':'specialization','branchId':'a','cast':0,'cooldown':0,'range':0,'resourceCosts':[{'resourceId':'health','resourceName':'Здоровье','amount':5,'unit':'percent'},{'resourceId':'mana','amount':25,'unit':'points'}]}]
        status,result,_=self.request(a,'/api/projects',{'document':d});self.assertEqual(status,200);pid=result['id'];stored=self.request(a,'/api/projects/'+pid)[1]['document'];self.assertNotIn('primaryBranchId',stored);self.assertEqual(len(stored['abilities'][0]['resourceCosts']),2)
        token=self.request(a,'/api/publish',{'projectId':pid,'visibility':'public'})[1]['token'];shared=self.request(a,'/api/shared/'+token)[1]['document'];self.assertNotIn('primaryBranchId',shared)
        for costs in ([{'resourceId':'missing','amount':1,'unit':'points'}],[{'resourceId':'mana','amount':-1,'unit':'points'}],[{'resourceId':'mana','amount':1,'unit':'bad'}],[{'resourceId':'mana','amount':1,'unit':'points'}]*2):
            bad=copy.deepcopy(d);bad['abilities'][0]['resourceCosts']=costs;self.assertEqual(self.request(a,'/api/projects',{'id':pid,'document':bad})[0],400)

    def test_modern_irregular_icon_is_valid_for_class_and_avatar(self):
        a=self.client();self.register(a,'modern_icon')
        d=copy.deepcopy(base.DOCUMENT);d['classIcon']={'layers':[{'icon':'retail:132134','opacity':1}]}
        self.assertEqual(self.request(a,'/api/projects',{'document':d})[0],200)
        self.assertEqual(self.request(a,'/api/profile/avatar',{'avatar':d['classIcon']})[0],200)
        d['classIcon']['layers'][0]['icon']='retail:unknown'
        self.assertEqual(self.request(a,'/api/projects',{'document':d})[0],400)
