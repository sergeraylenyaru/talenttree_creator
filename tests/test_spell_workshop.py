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
