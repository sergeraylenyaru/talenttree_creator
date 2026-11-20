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
