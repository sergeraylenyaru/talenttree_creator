import copy
import json
from pathlib import Path
import unittest

import server


class WorkshopValidation(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads((Path(__file__).parent / 'fixtures' / 'training-grounds.json').read_text())
        self.doc['abilities'] = self.doc['abilities'][:2]
        self.doc['branches'][0]['talents'] = self.doc['branches'][0]['talents'][:1]
        ability = self.doc['abilities'][0]
        ability.update(
            presentation={'delivery': 'ranged', 'projectile': 'none', 'targeting': 'ground',
                          'castingAnimation': 'clip:SpellCastDirected (ID 53 variation 0)'},
            workshop={'version': 1, 'radius': 5, 'charges': 2, 'recharge': 12, 'minRange': 2},
            combatEffects=[
                {**ability['combatEffects'][0], 'duration': 5, 'interval': 1, 'stacks': 3},
                {'id': 'buff', 'type': 'status', 'trigger': 'onCast', 'target': 'player',
                 'name': 'Focus', 'stat': 'spellPower', 'amount': 15, 'duration': 4},
                {'id': 'gain', 'type': 'resource', 'trigger': 'onCast', 'resourceId': 'mana', 'amount': 2, 'unit': 'percent'}
            ]
        )

    def test_schema_round_trips_with_legacy_abilities(self):
        self.assertEqual(server.validate(copy.deepcopy(self.doc))['abilities'], self.doc['abilities'])

    def test_visual_preset_and_arced_projectile_validation(self):
        ability = self.doc['abilities'][0]
        ability['presentation'].update(
            targeting='dummy', projectile='straight', projectileOrigin='hand', trajectory='arc',
            arcHeight=.8, projectilePreset='frostbolt', effectPreset='frostImpact', impactAnchor='target',
            startAnimation='guard', finishAnimation='cast', impactAnimation='clip:CombatWound (ID 9 variation 0)'
        )
        ability['workshop']['criticalSound'] = 'strike'
        self.assertEqual(server.validate(copy.deepcopy(self.doc))['abilities'][0], ability)
        for key, value in [('arcHeight', 6), ('effectPreset', 'missing'), ('projectileOrigin', 'leftHip')]:
            with self.subTest(key=key):
                invalid = copy.deepcopy(self.doc)
                invalid['abilities'][0]['presentation'][key] = value
                with self.assertRaises(ValueError):
                    server.validate(invalid)

    def test_instance_provenance_and_owned_rules_round_trip(self):
        ability = self.doc['abilities'][0]
        ability['templateSource'] = {'id': 'fireball-template', 'name': 'Fireball'}
        self.doc['rpg'] = {'version': 1, 'bonuses': [
            {'id': 'bonus', 'owner': {'kind': 'ability', 'id': ability['id']},
             'spell': ability['id'], 'stat': 'damage', 'amount': 10}
        ]}
        saved = server.validate(copy.deepcopy(self.doc))
        self.assertEqual(saved['abilities'][0]['templateSource'], ability['templateSource'])
        self.assertEqual(saved['rpg'], self.doc['rpg'])
        ability['templateSource']['id'] = None
        with self.assertRaises(ValueError):
            server.validate(self.doc)

    def test_control_dispel_and_cooldown_effects_round_trip(self):
        ability = self.doc['abilities'][0]
        ability['combatEffects'] = [
            {'id':'stun','type':'control','trigger':'onHit','target':'dummy','name':'Stun',
             'controlType':'stun','duration':4,'drGroup':'stun','dispelType':'magic','removable':True},
            {'id':'cleanse','type':'dispel','trigger':'onCast','target':'player','dispelType':'magic','count':1},
            {'id':'reset','type':'cooldown','trigger':'onCast','abilityId':'self','seconds':0,'reset':True}
        ]
        self.assertEqual(server.validate(copy.deepcopy(self.doc))['abilities'][0], ability)
        for key, value in [('controlType', 'unknown'), ('duration', -1), ('drGroup', {}), ('removable', 1)]:
            invalid = copy.deepcopy(self.doc)
            invalid['abilities'][0]['combatEffects'][0][key] = value
            with self.assertRaises(ValueError):
                server.validate(invalid)

    def test_linked_ids_remain_distinct_with_matching_metadata(self):
        original = self.doc['abilities'][0]
        copy_ability = copy.deepcopy(original)
        copy_ability['id'] = 'another-flame'
        self.doc['abilities'].append(copy_ability)
        first = self.doc['branches'][0]['talents'][0]
        second = {**first, 'id': 'second-link', 'col': 1, 'grantedAbilityId': copy_ability['id']}
        self.doc['branches'][0]['talents'].append(second)
        saved = server.validate(self.doc)
        self.assertEqual([node['grantedAbilityId'] for node in saved['branches'][0]['talents']],
                         [original['id'], copy_ability['id']])
        for malformed in (['flame'], False, 'missing'):
            broken = copy.deepcopy(self.doc)
            broken['branches'][0]['talents'][0]['grantedAbilityId'] = malformed
            with self.assertRaisesRegex(ValueError, 'Способность таланта'):
                server.validate(broken)

    def test_invalid_settings_are_rejected(self):
        for key, value in [('version', 2), ('minRange', 35), ('charges', 2.5), ('collisionRadius', 0), ('tickInterval', 1)]:
            with self.subTest(key=key):
                draft = copy.deepcopy(self.doc)
                draft['abilities'][0]['workshop'][key] = value
                with self.assertRaises(ValueError):
                    server.validate(draft)
        with self.assertRaises(ValueError):
            self.doc['abilities'][0]['combatEffects'][-1]['resourceId'] = 'missing'
            server.validate(self.doc)
