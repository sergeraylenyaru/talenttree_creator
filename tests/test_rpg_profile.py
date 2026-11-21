import copy
import json
import unittest

import server
from rpg_fixture import document


class RpgProfileValidation(unittest.TestCase):
    def setUp(self):
        self.doc = document()
        self.item = {'id': 'blade', 'name': 'Test blade', 'slot': 'mainHand', 'type': 'sword1',
                     'icon': 'forge-steel', 'level': 10, 'quality': 'rare', 'speed': 1.5,
                     'minDamage': 15, 'maxDamage': 35, 'stats': {'critChance': .15}}
        self.doc['rpg'].update(items=[self.item], equipped={'mainHand': 'blade'}, builds=[
            {'id': 'test', 'name': 'Test', 'talents': {'fire-talent': 1}, 'equipped': {'mainHand': 'blade'}}])

    def test_profile_and_existing_ability_fields_round_trip(self):
        saved = server.validate(json.loads(json.dumps(self.doc)))
        self.assertEqual(saved['rpg'], self.doc['rpg'])
        self.assertEqual(saved['abilities'], self.doc['abilities'])
        legacy = copy.deepcopy(self.doc)
        del legacy['rpg']
        self.assertNotIn('rpg', server.validate(legacy))

    def test_explicit_cataclysm_profile_and_rating_fields(self):
        self.doc['rpg']['combatRules'] = {'version': 'cataclysm-4.3.4', 'classId': 'mage',
                                          'targetLevel': 88, 'position': 'behind'}
        self.doc['rpg']['attributes']['spellHitRating'] = 1741.582
        self.assertEqual(server.validate(copy.deepcopy(self.doc))['rpg'], self.doc['rpg'])
        for field, value in [('version', 'retail'), ('classId', 'monk'), ('targetLevel', True), ('ratingScale', 0)]:
            bad = copy.deepcopy(self.doc)
            bad['rpg']['combatRules'][field] = value
            with self.assertRaises(ValueError):
                server.validate(bad)

    def test_extended_combat_profile_round_trip(self):
        self.doc['rpg']['trainingMode'] = 'survival'
        self.doc['rpg']['states'] = {'form':'cat'}
        self.doc['rpg']['bonuses']=[{'id':'form-bonus','owner':{'kind':'ability','id':'flame'},'state':{'key':'form','value':'cat'},'stat':'armor','amount':100}]
        self.doc['rpg']['incoming'] = {'school':'physical','amount':100,'interval':2,
                                        'canCrit':True,'critChance':.2,'critMultiplier':2}
        self.doc['rpg']['progression']={'baseLevel':1,'healthPerLevel':10,'attributesPerLevel':{'intellect':2},'resourcePerLevel':{'mana':2}}
        self.doc['rpg']['resources'] = {'mana':{'rune':True,'recharge':10}}
        self.assertEqual(server.validate(copy.deepcopy(self.doc))['rpg'], self.doc['rpg'])
        for field, value in [('trainingMode','arena'),('states',{'form':5})]:
            invalid = copy.deepcopy(self.doc)
            invalid['rpg'][field] = value
            with self.assertRaises(ValueError):
                server.validate(invalid)

    def test_detached_build_snapshot_is_validated_and_rejects_nested_builds(self):
        build=self.doc['rpg']['builds'][0]
        snapshot=copy.deepcopy(self.doc)
        snapshot['rpg']['builds']=[]
        snapshot['build']=copy.deepcopy(build['talents'])
        build['combatSnapshot']=snapshot
        saved=server.validate(copy.deepcopy(self.doc))
        self.assertEqual(saved['rpg']['builds'][0]['combatSnapshot']['abilities'],snapshot['abilities'])
        self.assertEqual(saved['rpg']['builds'][0]['combatSnapshot']['build'],snapshot['build'])
        # Changing the active ability does not update the historical snapshot.
        self.doc['abilities'][0]['combatEffects'][0]['baseAmount']=999
        self.assertNotEqual(snapshot['abilities'][0]['combatEffects'][0]['baseAmount'],999)
        invalid=copy.deepcopy(self.doc)
        invalid['rpg']['builds'][0]['combatSnapshot']['rpg']['builds']=[{'id':'nested'}]
        with self.assertRaises(ValueError):server.validate(invalid)
        invalid=copy.deepcopy(self.doc)
        invalid['rpg']['builds'][0]['combatSnapshot']['abilities'][0]['combatEffects'][0]['baseAmount']=-1
        with self.assertRaises(ValueError):server.validate(invalid)

    def test_equipment_sets_and_class_requirements(self):
        self.doc['rpg']['combatRules']={'version':'cataclysm-4.3.4','classId':'mage','targetLevel':60}
        self.item.update(setId='arcanist',requiredClass='mage',roll={'seed':13,'spread':.2,'baseStats':{'critChance':.15}})
        self.doc['rpg']['setBonuses']=[{'id':'two-piece','name':'Two pieces','setId':'arcanist','pieces':2,'stats':{'spellPower':20}}]
        self.assertEqual(server.validate(copy.deepcopy(self.doc))['rpg']['setBonuses'][0]['pieces'],2)
        self.item['requiredClass']='warrior'
        with self.assertRaises(ValueError):server.validate(copy.deepcopy(self.doc))

    def test_primary_budget_only_limits_base_attributes(self):
        self.doc['rpg']['primaryBudget'] = 30
        self.item['stats']['stamina'] = 100
        self.assertEqual(server.validate(self.doc)['rpg']['primaryBudget'], 30)
        for value in (29, True, 30.5):
            with self.subTest(value=value):
                self.doc['rpg']['primaryBudget'] = value
                with self.assertRaises(ValueError):
                    server.validate(self.doc)
        self.doc['rpg']['primaryBudget'] = 30
        self.doc['rpg']['attributes']['intellect'] = 19.5
        with self.assertRaises(ValueError):
            server.validate(self.doc)
        del self.doc['rpg']['primaryBudget']
        self.assertEqual(server.validate(self.doc)['rpg']['attributes']['intellect'], 19.5)

    def test_reject_invalid_configuration(self):
        for key, value in (
            ('version', 2), ('seed', True), ('testDuration', float('inf')),
            ('equipped', {'mainHand': 'missing'}), ('items', [self.item, self.item]),
            ('attributes', {'critChance': 1.25}), ('attributes', {'stamina': float('nan')}),
            ('resources', {'mana': {'regen': -1}}), ('resources', {'unknown': {'regen': 1}}),
            ('formulas', [{'from': 'stamina', 'to': 'resource:unknown', 'factor': 10}]),
            ('builds', [{'id': 'broken', 'name': 'Broken', 'equipped': {}, 'talents': {'unknown': 1}}]),
        ):
            with self.subTest(key=key, value=value):
                draft = copy.deepcopy(self.doc)
                draft['rpg'][key] = value
                with self.assertRaises(ValueError):
                    server.validate(draft)

    def test_reject_unknown_procs_and_unbounded_shields(self):
        for key, value in (('chance', 1.25), ('cooldown', -1), ('effect', 'missing'),
                           ('cost', {'resourceId': 'mana', 'amount': 110, 'unit': 'percent'})):
            with self.subTest(key=key):
                draft = copy.deepcopy(self.doc)
                draft['rpg']['procs'][0][key] = value
                with self.assertRaises(ValueError):
                    server.validate(draft)
        draft = copy.deepcopy(self.doc)
        draft['abilities'][1]['combatEffects'][0]['fraction'] = 1.25
        with self.assertRaises(ValueError):
            server.validate(draft)

    def test_two_handed_equipment_and_drain_schema(self):
        self.item['type'] = 'sword2'
        ward = {'id': 'shield', 'name': 'Shield', 'slot': 'offHand', 'type': 'shield',
                'icon': 'forge-steel', 'level': 8, 'quality': 'common'}
        self.doc['rpg']['items'].append(ward)
        self.doc['rpg']['equipped']['offHand'] = 'shield'
        with self.assertRaisesRegex(ValueError, 'two-handed'):
            server.validate(self.doc)
        del self.doc['rpg']['equipped']['offHand']
        effect = self.doc['abilities'][3]['combatEffects'][1]
        effect['direction'] = 'drain'
        self.assertEqual(server.validate(self.doc)['abilities'][3]['combatEffects'][1], effect)
        effect['direction'] = 'restore_everything'
        with self.assertRaises(ValueError):
            server.validate(self.doc)

class FavoriteAbilityBundles(unittest.TestCase):
    def test_favorite_remaps_root_and_checks_detached_proc_payload(self):
        source=document()['abilities'][0]
        source.update(id='source',learningMode='base',talentId='',branchId='',branchOnly=False)
        source['templateAbilities']=[{'id':'payload','name':'Payload','description':'Payload','icon':'forge-ember',
          'kind':'passive','learningMode':'base','cast':0,'cooldown':0,'range':0,'resourceCosts':[],
          'combatEffects':[{'id':'hit','type':'damage','trigger':'onHit','school':'fire','baseAmount':25,'coefficient':0,'scalingStat':'none','canCrit':False}]}]
        source['templateRules']={'bonuses':[],'procs':[{'id':'extra','name':'Extra','owner':{'kind':'ability','id':'source'},'event':'damage','chance':1,'cooldown':0,'spell':'payload','effect':'hit'}]}
        favorite=server.prepare_favorite_ability(source)
        self.assertNotEqual(favorite['id'],'source')
        self.assertEqual(favorite['templateRules']['procs'][0]['owner']['id'],favorite['id'])
        self.assertEqual(source['templateRules']['procs'][0]['owner']['id'],'source')
        broken=copy.deepcopy(source);broken['templateRules']['procs'][0]['spell']='missing'
        with self.assertRaises(ValueError):server.prepare_favorite_ability(broken)
