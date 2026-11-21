"""Regression against the actual /cata 19019 XML supplied from the user's browser.

Only the named mutation tests alter that captured document. No live network is
needed for these tests; browser/network verification is separate.
"""
import copy
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
from uuid import uuid4
from xml.etree import ElementTree as ET
import wowhead_items as wh
from rpg_profile import validate_item
import server
import test_server as base

RAW=(Path(__file__).parent/'fixtures/wowhead-cata/19019.xml').read_bytes()
STAMP='2026-11-21T00:00:00Z'
def parsed():return wh.parse_item_xml(RAW,19019,STAMP)
def mutation(**values):
 root=ET.fromstring(RAW);node=root.find('item/jsonEquip');equip=wh.fragment(node.text);equip.update(values);node.text=json.dumps(equip)
 return ET.tostring(root)

class ActualThunderfury(unittest.TestCase):
 def test_supplied_actual_xml_and_precise_physical_weapon_data(self):
  self.assertEqual(sha256(RAW).hexdigest(),'3db44df95a3e21f2dfbe081174fd02e557e97d3a1bffed2e13d60f9e877d516b')
  item=parsed();validate_item(item)
  self.assertEqual(item['name'],'Thunderfury, Blessed Blade of the Windseeker')
  self.assertEqual((item['quality'],item['level'],item['requiredLevel'],item['icon']),('legendary',80,60,'inv_sword_39'))
  self.assertEqual((item['type'],item['allowedSlots']),('sword1',['mainHand','offHand']))
  self.assertEqual(item['stats'],{'agility':5,'stamina':8})
  equip=wh.fragment(ET.fromstring(RAW).findtext('item/jsonEquip'))
  self.assertEqual((item['minDamage'],item['maxDamage'],item['speed']),(equip['dmgmin1'],equip['dmgmax1'],1.9))
  self.assertEqual(item['source']['responseSha256'],sha256(RAW).hexdigest())
  self.assertEqual(item['source']['url'],'https://www.wowhead.com/cata/item=19019')
  # DPS includes extra nature damage in the tooltip; it must not inflate physical damage.
  self.assertAlmostEqual((item['minDamage']+item['maxDamage'])/2/item['speed'],41.84210586)
  self.assertIn('16 - 30 Nature Damage',item['source']['tooltipText']);self.assertIn('300 Nature damage',item['description'])
  self.assertNotIn('natureResistance',item['stats']);self.assertNotIn('procs',item)
  self.assertIn('useEffects',item['source']['unmodeled'])  # jsonUse.natres=-25 is not equipment resistance.
  self.assertTrue(all('metadata:'+key in item['source']['unmodeled'] for key in wh.SERVICE_FIELDS))
 def test_metadata_never_changes_stats_slot_icon_or_damage(self):
  item=wh.parse_item_xml(mutation(displayid=123,dmgrange=.9,dura=999,sheathtype=7,slotbak=22),19019,STAMP)
  original=parsed()
  for key in ('stats','icon','type','slot','allowedSlots','minDamage','maxDamage','speed'):self.assertEqual(item[key],original[key])
 def test_unknown_stats_and_requirements_still_fail_after_known_metadata(self):
  for extra,code in [({'newrating':42},'unsupported_stats'),({'displayid_bonus':5},'unsupported_stats'),({'reqnew':1},'unsupported_requirement'),({'reqskill':164},'unsupported_requirement'),({'resirtng':20},'unsupported_stats')]:
   with self.subTest(extra=extra),self.assertRaises(wh.ImportError) as error:wh.parse_item_xml(mutation(**extra),19019)
   self.assertEqual(error.exception.code,code)
 def test_service_fields_are_validated_not_blindly_discarded(self):
  for extra in ({'displayid':True},{'dmgrange':'not a number'},{'dura':-1},{'sheathtype':1.5},{'slotbak':999},{'maxcount':-1}):
   with self.subTest(extra=extra),self.assertRaises(wh.ImportError) as error:wh.parse_item_xml(mutation(**extra),19019)
   self.assertEqual(error.exception.code,'source_format')
  root=ET.fromstring(RAW);node=root.find('item/json');data=wh.fragment(node.text);data['maxcount']=2;node.text=json.dumps(data)
  with self.assertRaises(wh.ImportError) as error:wh.parse_item_xml(ET.tostring(root),19019)
  self.assertEqual(error.exception.code,'source_format')
 def test_maxcount_is_enforced_without_relying_on_tooltip_unique_text(self):
  raw=mutation(maxcount=1).replace(b'Unique',b'No ownership hint')
  item=wh.parse_item_xml(raw,19019,STAMP);self.assertEqual(item['uniqueGroup'],'wowhead-cata-19019')
  item2=copy.deepcopy(item);item2['id']=str(uuid4())
  script="import {validateItem,itemEligibility} from './static/combat/rpg-profile.js';let s='';for await(const x of process.stdin)s+=x;const [a,b]=JSON.parse(s);validateItem(a);validateItem(b);console.log(itemEligibility(b,'offHand',{level:85,restrictions:{dualWield:true}},{mainHand:a}));"
  checked=subprocess.run(['node','--input-type=module','-e',script],input=json.dumps([item,item2]),cwd=Path(__file__).parents[1],text=True,capture_output=True,check=True)
  self.assertEqual(checked.stdout.strip(),'Unique-equipped item already equipped')
  from rpg_fixture import document
  doc=document();doc['rpg'].update(level=85,restrictions={'dualWield':True},items=[item,item2],equipped={'mainHand':item['id'],'offHand':item2['id']})
  with self.assertRaisesRegex(ValueError,'Unique-equipped'):server.validate(doc)

class ActualThunderfuryAPI(unittest.TestCase):
 setUpClass=classmethod(base.API.setUpClass.__func__)
 tearDownClass=classmethod(base.API.tearDownClass.__func__)
 client=base.API.client
 request=base.API.request
 register=base.API.register
 def setUp(self):
  with server.connect() as db:
   for table in ('projects','sessions','attempts','users'):db.execute('DELETE FROM '+table)
 def test_actual_response_preview_requires_confirmation_and_roundtrips_source(self):
  client=self.client();self.register(client,'actual-import');path='/api/items/wowhead/preview'
  with patch.object(wh,'fetch_xml',return_value=RAW) as fetch:
   status,body,_=self.request(client,path,{'reference':'19019','version':'cataclysm'})
   self.assertEqual(status,200,body);fetch.assert_called_once_with(19019);item=body['item']
   with server.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM projects').fetchone()[0],0)
  from rpg_fixture import document
  doc=document();doc['rpg'].update(level=85,items=[item],equipped={})
  status,saved,_=self.request(client,'/api/projects',{'document':doc});self.assertEqual(status,200,saved)
  result=self.request(client,'/api/projects/'+saved['id'])[1]['document']
  self.assertEqual(result['rpg']['items'],[item]);self.assertEqual(result['rpg'].get('equipped',{}),{})
