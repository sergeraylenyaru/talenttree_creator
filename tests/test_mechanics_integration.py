"""Client/server parity for authored mechanics; no private model fixtures."""
import copy
import json
from pathlib import Path
import subprocess
import unittest
import server
from rpg_fixture import document

ROOT=Path(__file__).resolve().parents[1]
class MechanicsIntegrationValidation(unittest.TestCase):
    def configured(self):
        doc=document();rpg=doc['rpg']
        rpg['incoming'].update(castTime=2)
        rpg['resources']['mana'].update(kind='mana')
        rpg['bonuses']=[{'id':'mastery','owner':{'kind':'ability','id':'flame'},'spell':'flame','stat':'damage','amount':10,'masteryScale':2,
          'condition':{'type':'all','conditions':[{'type':'state','key':'stance','value':'battle'},{'type':'resourceAbove','resource':'mana','value':10},{'type':'talentRank','value':'fire-talent','rank':1},{'type':'previousEvent','value':'damage','window':5,'abilityId':'flame'}]}}]
        rpg['procs'][0].update(ppm=6,attackType='auto')
        doc['abilities'][0]['workshop']={'version':1,'attackType':'spell','attackSchool':'fire','weaponHand':'mainHand','normalizedWeapon':True,'swingPolicy':'pause','cooldownGroup':'test','groupCooldown':8}
        doc['abilities'][0]['combatEffects'][1].update(tickPolicy='restart',category='burn')
        return doc

    def client_valid(self,doc):
        script="import {normalize} from './static/engine.js';let raw='';for await(const part of process.stdin)raw+=part;try{normalize(JSON.parse(raw));process.stdout.write('yes')}catch{process.stdout.write('no')}"
        result=subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,input=json.dumps(doc),text=True,capture_output=True,check=True)
        return result.stdout=='yes'

    def test_new_fields_round_trip_and_client_server_agree(self):
        doc=self.configured();saved=server.validate(copy.deepcopy(doc))
        self.assertEqual(saved['rpg'],doc['rpg']);self.assertEqual(saved['abilities'],doc['abilities']);self.assertTrue(self.client_valid(doc))

    def test_invalid_mechanics_are_rejected_on_both_sides(self):
        changes=[
          lambda d:d['rpg']['incoming'].update(castTime=True),
          lambda d:d['rpg']['resources']['mana'].update(kind='runic-pet'),
          lambda d:d['rpg']['procs'][0].update(ppm=61),
          lambda d:d['rpg']['procs'][0].update(attackType='direct'),
          lambda d:d['rpg']['bonuses'][0].update(masteryScale=-1),
          lambda d:d['rpg']['bonuses'][0].update(stat='attackPower'),
          lambda d:d['rpg']['bonuses'][0]['condition'].update(conditions=[]),
          lambda d:d['rpg']['bonuses'][0].update(condition={'type':'previousEvent','value':'damage','window':301}),
          lambda d:d['rpg']['bonuses'][0].update(condition={'type':'talentRank','value':'missing','rank':1}),
          lambda d:d['abilities'][0]['workshop'].update(channelPayment='never'),
          lambda d:d['abilities'][0]['workshop'].pop('cooldownGroup'),
          lambda d:d['abilities'][0]['combatEffects'][1].update(tickPolicy='pandemic'),
          lambda d:d['abilities'][0]['combatEffects'][1].update(category=''),
        ]
        for change in changes:
            doc=self.configured();change(doc)
            with self.subTest(document=doc):
                with self.assertRaises(ValueError):server.validate(doc)
                self.assertFalse(self.client_valid(doc))

    def test_typed_rune_conversion_round_trip_and_references(self):
        doc=self.configured();doc['rpg']['resources']={'mana':{'rune':True},'charges':{'rune':True}}
        doc['abilities'][0]['combatEffects']=[{'id':'convert','type':'rune','trigger':'onCast','fromResource':'mana','toResource':'charges','count':1}]
        doc['abilities'][0]['workshop']['runeSubstitute']='charges'
        self.assertTrue(self.client_valid(doc));self.assertEqual(server.validate(copy.deepcopy(doc))['abilities'],doc['abilities'])
        doc['rpg']['resources']['charges']['rune']=False
        with self.assertRaises(ValueError):server.validate(doc)
        self.assertFalse(self.client_valid(doc))

    def test_nested_template_conditions_remap_the_root(self):
        doc=self.configured();ability=copy.deepcopy(doc['abilities'][0]);ability.update(learningMode='base',talentId='')
        ability['templateRules']={'bonuses':[{'id':'copy-rule','owner':{'kind':'ability','id':'flame'},'spell':'flame','stat':'damage','amount':10,
           'condition':{'type':'all','conditions':[{'type':'previousEvent','value':'damage','window':5,'abilityId':'flame'},{'type':'resourceAbove','value':5,'resource':'mana'}]}}]}
        saved=server.prepare_favorite_ability(ability)
        self.assertEqual(saved['templateRules']['bonuses'][0]['condition']['conditions'][0]['abilityId'],saved['id'])
