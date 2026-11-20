import copy
import json
import unittest
from pathlib import Path
import test_server as server_tests
DOCUMENT = server_tests.DOCUMENT
import server

FIXTURES = json.loads((Path(__file__).parent / 'fixtures/combat-effects.json').read_text())
DAMAGE = FIXTURES['valid'][1][0]
HEALING = FIXTURES['valid'][2][0]

def document(effects):
    doc = copy.deepcopy(DOCUMENT)
    doc['abilities'] = [dict(id='ability', name='Fireball', description='Text', icon='spell_fire_flamebolt', combatEffects=copy.deepcopy(effects))]
    return doc

class CombatEffects(unittest.TestCase):
    def test_valid_and_legacy(self):
        server.validate(copy.deepcopy(DOCUMENT))
        for effects in FIXTURES['valid'] + [[DAMAGE, HEALING]]:
            with self.subTest(effects=effects):
                doc = document(effects)
                self.assertEqual(server.validate(json.loads(json.dumps(doc))), doc)
        legacy = document([])
        del legacy['abilities'][0]['combatEffects']
        self.assertNotIn('combatEffects', server.validate(legacy)['abilities'][0])

    def test_rejections(self):
        invalid = [None, {}, 'text', [None], [[DAMAGE]], [DAMAGE, DAMAGE],
                   [dict(DAMAGE, id=f'e-{i}') for i in range(33)],
                   [dict(DAMAGE, baseAmount=float('nan'))], [dict(DAMAGE, coefficient=float('inf'))],
                   [dict(HEALING, school='holy')]]
        invalid += [[dict(DAMAGE, **patch)] for patch in FIXTURES['invalidPatches']]
        for key in DAMAGE:
            effect = dict(DAMAGE)
            del effect[key]
            invalid.append([effect])
        for effects in invalid:
            with self.subTest(effects=effects), self.assertRaises(ValueError):
                server.validate(document(effects))

    def test_optional_presentation(self):
        doc = document([DAMAGE])
        values = {'projectile': 'homing', 'projectileSpeed': 12, 'channelDuration': 2.5, 'attackAnimation': 'cast'}
        doc['abilities'][0]['presentation'] = values
        self.assertEqual(server.validate(doc)['abilities'][0]['presentation'], values)
        for invalid in (None, [], {'projectileSpeed': True}, {'channelDuration': 121},
                        {'impact': 'external.svg'}, {'extra': 'value'}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                doc['abilities'][0]['presentation'] = invalid
                server.validate(doc)

    def test_limits_and_schools(self):
        server.validate(document([dict(DAMAGE, id=f'e-{i}', school=school, baseAmount=1e9, coefficient=1000)
                                  for i, school in enumerate(('physical','fire','frost','arcane','nature','shadow','holy'))]))
        server.validate(document([dict(HEALING, id=f'e-{i}') for i in range(32)]))

class CombatEffectsAPI(unittest.TestCase):
    setUpClass = classmethod(server_tests.API.setUpClass.__func__)
    tearDownClass = classmethod(server_tests.API.tearDownClass.__func__)
    client = server_tests.API.client
    request = server_tests.API.request
    register = server_tests.API.register

    def test_combat_storage_public_build_and_favorite(self):
        client = self.client()
        self.register(client, 'combat-author')
        doc = document([DAMAGE, HEALING])
        status, result, _ = self.request(client, '/api/projects', {'document':doc})
        self.assertEqual(status, 200)
        loaded = self.request(client, '/api/projects/'+result['id'])[1]['document']
        self.assertEqual(loaded['abilities'][0]['combatEffects'], doc['abilities'][0]['combatEffects'])
        status, shared, _ = self.request(client, '/api/publish', {'projectId':result['id'], 'visibility':'public'})
        self.assertEqual(status, 200)
        self.assertEqual(self.request(self.client(), '/api/shared/'+shared['token'])[1]['document']['abilities'][0]['combatEffects'], doc['abilities'][0]['combatEffects'])
        self.assertEqual(self.request(client, '/api/favorites', {'kind':'ability','item':doc['abilities'][0]})[0], 200)
        items = self.request(client, '/api/favorites')[1]['favorites']
        self.assertEqual(items[0]['item']['combatEffects'], doc['abilities'][0]['combatEffects'])
        bad = document([dict(DAMAGE, canCrit='true')])
        self.assertEqual(self.request(client, '/api/projects', {'document':bad})[0], 400)
