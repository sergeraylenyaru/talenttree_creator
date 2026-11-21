"""Fixed synthetic XML fixtures. A live response is a separate, opt-in check."""
import copy
from io import BytesIO
import json
from pathlib import Path
import subprocess
import unittest
import threading
from unittest.mock import patch,MagicMock
from urllib.error import HTTPError,URLError
from xml.etree import ElementTree as ET
import wowhead_items as wh
from rpg_profile import validate_item
import server
import test_server as base

ROOT=Path(__file__).resolve().parents[1]
FIX=ROOT/'tests/fixtures/wowhead-cata'
def fixture(name='weapon'):return (FIX/(name+'.xml')).read_bytes()
def parse(name='weapon'):return wh.parse_item_xml(fixture(name),{'weapon':900001,'armor':900002,'ring':900003,'trinket':900004}[name],'2026-11-21T00:00:00Z')
def changed(**values):
 root=ET.fromstring(fixture());node=root.find('item/jsonEquip');data=wh.fragment(node.text);data.update(values);node.text=json.dumps(data)
 return ET.tostring(root)

class WowheadParser(unittest.TestCase):
 def test_fixed_weapon_armor_ring_and_trinket_exact_values(self):
  sword=parse();self.assertEqual(sword['stats'],{'strength':20,'stamina':30,'hitRating':12,'spellHitRating':12});self.assertEqual((sword['minDamage'],sword['maxDamage'],sword['speed']),(100,140,2));self.assertEqual(sword['requiredClasses'],['warrior','paladin'])
  armor=parse('armor');self.assertEqual(armor['stats'],{'strength':40,'stamina':60,'masteryRating':25});self.assertEqual(armor['armor'],2400);self.assertIn('sockets',armor['source']['unmodeled'])
  self.assertEqual(parse('ring')['allowedSlots'],['ring1','ring2']);self.assertEqual(parse('trinket')['allowedSlots'],['trinket1','trinket2'])
  for name in ('weapon','armor','ring','trinket'):validate_item(parse(name))
  extra=wh.parse_item_xml(changed(health=200,splpen=20,str=-5),900001);validate_item(extra);self.assertEqual(extra['stats']['maxHealth'],200);self.assertEqual(extra['stats']['spellPenetration'],20);self.assertEqual(extra['stats']['strength'],-5)
 def test_reference_is_canonical_and_rejects_other_versions_and_arbitrary_urls(self):
  for value in (19019,'19019','https://wowhead.com/cata/item=19019','https://www.wowhead.com/cata/ru/item=19019/name#comments','https://www.wowhead.com/cata/item=19019&xml','https://www.wowhead.com/cata/item=19019?xml'):
   self.assertEqual(wh.parse_reference(value),19019)
  for value in ('https://www.wowhead.com/item=19019','https://www.wowhead.com/wotlk/item=19019','https://www.wowhead.com/classic/item=19019','https://www.wowhead.com/cata/item=19019?bonus=1','https://www.wowhead.com.evil.test/cata/item=1','https://evil.test/cata/item=1','https://wowhead.com@127.0.0.1/cata/item=1','https://www.wowhead.com:443/cata/item=1','http://127.0.0.1','https://www.wowhead.com/cata/item=1/../../x',True,0,-1,'1e3','99999999999'):
   with self.subTest(value=value),self.assertRaises(wh.ImportError):wh.parse_reference(value)
  with self.assertRaises(wh.ImportError):wh.parse_reference(19019,'retail')
 def test_tooltip_and_optional_effects_are_plain_text_and_never_activated(self):
  item=parse();self.assertNotIn('script',item['source']['tooltipText']);self.assertNotIn('fixtureExecuted',item['source']['tooltipText']);self.assertNotIn('https://invalid',item['description']);self.assertIn('Test effect',item['description'])
  self.assertNotIn('procs',item);self.assertNotIn('setId',parse('trinket'));self.assertIn('setBonus',parse('trinket')['source']['unmodeled'])
  item=wh.parse_item_xml(changed(dmgmin2=10,dmgmax2=20,dmgtype2=2),900001);self.assertEqual(item['minDamage'],100);self.assertIn('additionalDamage',item['source']['unmodeled'])
 def test_unsupported_requirements_stats_schools_variants_and_malformed_data(self):
  for raw in (changed(reqskill=164),changed(rgdatkpwr=20),changed(manargn=10),changed(dmgtype1=2),changed(newrating=5),changed(speed=0),changed(reqlevel=90),changed(reqclass=1<<9),changed(classes=[8]),changed(str=True),changed(str=float('nan')),
      fixture().replace(b'"subclass": 7',b'"subclass": 99'),fixture().replace(b'"id": 900001',b'"id": 19019'),fixture().replace(b'"str": 20',b'"str": 20, "str": 30'),b'<!DOCTYPE x [<!ENTITY a "boom">]><wowhead/>',b'<html>CAPTCHA</html>',b'<wowhead><item>'):
   with self.subTest(raw=raw[:80]),self.assertRaises(wh.ImportError):wh.parse_item_xml(raw,900001)
  with self.assertRaises(wh.ImportError) as error:wh.parse_item_xml(b'<wowhead><error>Item not found!</error></wowhead>',900001)
  self.assertEqual(error.exception.code,'not_found')
 def test_html_challenge_is_distinct_from_malformed_xml_and_not_found(self):
  for raw,code in [(b'<html><body>CAPTCHA</body></html>','source_blocked'),(b'<!DOCTYPE html><html>blocked</html>','source_blocked'),(b'<wowhead><error>Service unavailable</error></wowhead>','source_unavailable')]:
   with self.assertRaises(wh.ImportError) as error:wh.parse_item_xml(raw,900001)
   self.assertEqual(error.exception.code,code)
 def test_weapon_hands_holdables_shields_and_two_hand_types(self):
  for category,subclass,slot,kind,slots in [(2,1,17,'axe2',['mainHand']),(2,5,17,'mace2',['mainHand']),(2,6,17,'polearm',['mainHand']),(2,3,15,'gun',['ranged']),(2,7,21,'sword1',['mainHand']),(2,7,22,'sword1',['offHand']),(4,6,14,'shield',['offHand']),(4,0,23,'holdable',['offHand'])]:
   root=ET.fromstring(fixture());root.find('item/class').set('id',str(category));root.find('item/subclass').set('id',str(subclass));root.find('item/inventorySlot').set('id',str(slot));root.find('item/json').text=json.dumps({'id':900001,'classs':category,'subclass':subclass,'slot':slot,'level':100})
   if category==4:root.find('item/jsonEquip').text='"armor":200,"reqlevel":60'
   item=wh.parse_item_xml(ET.tostring(root),900001);validate_item(item);self.assertEqual(item['type'],kind);self.assertEqual(item['allowedSlots'],slots)
 def test_client_and_server_validate_source_and_restrictions_consistently(self):
  cases=[(parse(),True),(parse('ring'),True)]
  for key,value in [('allowedSlots',['head']),('allowedSlots',['mainHand','ranged']),('requiredClasses',['monk']),('uniqueGroup','<script>')]:
   bad=parse();bad[key]=value;cases.append((bad,False))
  for key,value in [('url','http://127.0.0.1'),('version','retail'),('itemId',True),('responseSha256','x')]:
   bad=parse();bad['source'][key]=value;cases.append((bad,False))
  script="import {validateItem} from './static/combat/rpg-profile.js';let s='';for await(const x of process.stdin)s+=x;console.log(JSON.stringify(JSON.parse(s).map(item=>{try{validateItem(item);return true}catch{return false}})))"
  result=subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,input=json.dumps([item for item,_ in cases]),text=True,capture_output=True,check=True)
  self.assertEqual(json.loads(result.stdout),[expected for _,expected in cases])
  for item,expected in cases:
   if expected:validate_item(item)
   else:
    with self.assertRaises(ValueError):validate_item(item)
 def test_fetch_uses_only_fixed_xml_url_size_timeout_and_no_redirect(self):
  response=MagicMock();response.status=200;response.headers={};response.fp=None;response.read1.side_effect=[fixture(),b''];response.__enter__.return_value=response
  opener=MagicMock();opener.open.return_value=response
  with patch.object(wh,'build_opener',return_value=opener):self.assertEqual(wh.fetch_xml(19019),fixture())
  request=opener.open.call_args.args[0];self.assertEqual(request.full_url,'https://www.wowhead.com/cata/item=19019&xml');self.assertEqual(opener.open.call_args.kwargs['timeout'],8)
  with self.assertRaises(wh.ImportError):wh.NoRedirect().redirect_request(request,None,302,'',{},'http://127.0.0.1/')
  response.headers={'Content-Length':str(wh.MAX_BYTES+1)}
  with patch.object(wh,'build_opener',return_value=opener),self.assertRaises(wh.ImportError) as error:wh.fetch_xml(19019)
  self.assertEqual(error.exception.code,'source_too_large')
  for remote,code in [(HTTPError(request.full_url,404,'',{},BytesIO()),'not_found'),(HTTPError(request.full_url,403,'',{},BytesIO()),'source_blocked'),(URLError(TimeoutError()),'source_timeout'),(URLError('network blocked'),'source_unavailable')]:
   with patch.object(opener,'open',side_effect=remote),patch.object(wh,'build_opener',return_value=opener),self.assertRaises(wh.ImportError) as error:wh.fetch_xml(19019)
   self.assertEqual(error.exception.code,code)

class WowheadLimits(unittest.TestCase):
 def test_stream_size_and_total_deadline_without_content_length(self):
  response=MagicMock();response.status=200;response.headers={};response.fp=None;response.__enter__.return_value=response;response.read1.return_value=b'x'*(wh.MAX_BYTES+1)
  opener=MagicMock();opener.open.return_value=response
  with patch.object(wh,'build_opener',return_value=opener),self.assertRaises(wh.ImportError) as error:wh.fetch_xml(900001)
  self.assertEqual(error.exception.code,'source_too_large')
  with patch.object(wh,'build_opener',return_value=opener),patch.object(wh.time,'monotonic',side_effect=[0,13]),self.assertRaises(wh.ImportError) as error:wh.fetch_xml(900001)
  self.assertEqual(error.exception.code,'source_timeout')
 def test_wall_timeout_also_covers_a_stalled_transport_and_releases_its_permit(self):
  release=threading.Event();finished=threading.Event()
  def stalled(_):
   try:release.wait(1);return b''
   finally:finished.set()
  try:
   with patch.object(wh,'TOTAL_SECONDS',.02),patch.object(wh,'_download_item',side_effect=stalled),self.assertRaises(wh.ImportError) as error:wh.fetch_xml(900001)
   self.assertEqual(error.exception.code,'source_timeout')
  finally:release.set();self.assertTrue(finished.wait(1))
 def test_imported_equipment_document_round_trip_and_server_gates(self):
  from rpg_fixture import document
  doc=document();doc['rpg'].update(level=85,combatRules={'version':'cataclysm-4.3.4','classId':'warrior'},items=[parse(),parse('ring')],equipped={})
  # Synthetic fixture class resources and abilities remain unchanged.
  doc['rpg']['equipped']={'mainHand':doc['rpg']['items'][0]['id'],'ring2':doc['rpg']['items'][1]['id']}
  saved=server.validate(copy.deepcopy(doc));self.assertEqual(saved['rpg']['items'],doc['rpg']['items'])
  doc['rpg']['combatRules']['classId']='mage'
  with self.assertRaises(ValueError):server.validate(doc)
  doc['rpg']['combatRules']['classId']='warrior';doc['rpg']['equipped']['ring1']=doc['rpg']['items'][1]['id']
  with self.assertRaises(ValueError):server.validate(doc)

class WowheadAPI(unittest.TestCase):
 setUpClass=classmethod(base.API.setUpClass.__func__)
 tearDownClass=classmethod(base.API.tearDownClass.__func__)
 client=base.API.client
 request=base.API.request
 register=base.API.register
 def setUp(self):
  with server.connect() as db:
   for table in ('projects','sessions','attempts','users'):db.execute('DELETE FROM '+table)
 def test_authenticated_preview_does_not_save_or_equip_and_rejects_urls_before_network(self):
  client=self.client();path='/api/items/wowhead/preview'
  with patch.object(wh,'fetch_xml',return_value=fixture()) as fetch:
   self.assertEqual(self.request(client,path,{'reference':'900001','version':'cataclysm'})[0],401);fetch.assert_not_called()
   self.register(client,'import-author')
   for reference in ('https://evil.test/cata/item=1','https://www.wowhead.com/item=1'):
    self.assertEqual(self.request(client,path,{'reference':reference,'version':'cataclysm'})[0],400)
   fetch.assert_not_called()
   status,result,_=self.request(client,path,{'reference':'900001','version':'cataclysm'});self.assertEqual(status,200,result);self.assertEqual(result['item']['minDamage'],100)
   second=self.request(client,path,{'reference':'900001','version':'cataclysm'})[1]['item'];self.assertNotEqual(second['id'],result['item']['id'])
   with server.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM projects').fetchone()[0],0)
  with patch.object(wh,'fetch_xml',side_effect=wh.ImportError('source_blocked','Blocked',502)):
   status,result,_=self.request(client,path,{'reference':'900001','version':'cataclysm'});self.assertEqual(status,502);self.assertEqual(result['code'],'source_blocked')
