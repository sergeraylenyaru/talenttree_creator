import copy
import http.cookiejar
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

DOCUMENT = {'version': 1, 'name': 'Тестовый класс', 'budget': 71, 'rowCost': 5,
            'branches': [{'id': 'a', 'name': 'Ветка', 'rows': 5, 'talents': []}], 'abilities': [], 'build': {}}

class API(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        server.DB = str(Path(cls.temp.name) / 'test.sqlite3')
        server.initialize()
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.url = f'http://127.0.0.1:{cls.http.server_port}'
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.temp.cleanup()

    def client(self):
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, client, path, data=None, method=None, origin=None):
        headers = {'Content-Type': 'application/json'}
        if origin:
            headers['Origin'] = origin
        req = urllib.request.Request(self.url + path, data=json.dumps(data).encode() if data is not None else None, headers=headers, method=method)
        try:
            with client.open(req) as response:
                return response.status, json.load(response), response.headers
        except urllib.error.HTTPError as error:
            return error.code, json.load(error), error.headers

    def register(self, client, name):
        status, _, headers = self.request(client, '/api/register', {'login': name, 'email': name+'@example.test', 'password': 'test-password-123'})
        self.assertEqual(status, 200)
        self.assertIn('HttpOnly', headers['Set-Cookie'])
        self.assertIn('SameSite=Lax', headers['Set-Cookie'])

    def test_auth_save_reload_isolation_and_logout(self):
        alice, bob = self.client(), self.client()
        self.assertEqual(self.request(alice, '/api/projects')[0], 401)
        self.register(alice, 'alice')
        status, result, _ = self.request(alice, '/api/projects', {'document': DOCUMENT})
        self.assertEqual(status, 200)
        pid = result['id']
        self.assertEqual(self.request(alice, '/api/projects/'+pid)[1]['document'], DOCUMENT)
        self.register(bob, 'bob')
        self.assertEqual(self.request(bob, '/api/projects')[1]['projects'], [])
        self.assertEqual(self.request(bob, '/api/projects/'+pid)[0], 404)
        self.assertEqual(self.request(bob, '/api/projects', {'id': pid, 'document': DOCUMENT})[0], 404)
        self.assertEqual(self.request(bob, '/api/projects/'+pid, {}, 'DELETE')[0], 404)
        self.assertEqual(self.request(alice, '/api/logout', {})[0], 200)
        self.assertEqual(self.request(alice, '/api/projects')[0], 401)
        self.assertEqual(self.request(alice, '/api/login', {'login': 'alice', 'email': 'alice@example.test', 'password': 'wrong-password'})[0], 401)
        self.assertEqual(self.request(alice, '/api/login', {'login': 'ALICE', 'email': 'alice@example.test', 'password': 'test-password-123'})[0], 200)
        self.assertEqual(self.request(alice, '/api/projects/'+pid)[0], 200)
        with server.connect() as db:
            salt, hashed = db.execute('SELECT salt,password FROM users WHERE login=?', ('alice',)).fetchone()
            self.assertNotEqual(hashed, 'test-password-123')
            self.assertEqual(hashed, server.password_hash('test-password-123', salt))

    def test_public_share_is_an_immutable_snapshot(self):
        client, visitor = self.client(), self.client()
        self.register(client, 'sharer')
        status, result, _ = self.request(client, '/api/share', {'document': DOCUMENT})
        self.assertEqual(status, 200)
        snapshot = self.request(visitor, '/api/shared/'+result['token'])
        self.assertEqual(snapshot[0], 200)
        self.assertEqual(snapshot[1]['document']['name'], DOCUMENT['name'])
        self.assertNotIn('login', snapshot[1])
        self.assertEqual(self.request(visitor, '/api/share', {'document': DOCUMENT})[0], 401)

    def test_cross_origin_requests_and_invalid_inputs(self):
        client = self.client()
        self.assertEqual(self.request(client, '/api/register', {'login': 'xx', 'password': 'x'})[0], 400)
        self.assertEqual(self.request(client, '/api/login', {'login': 'valid', 'email': 'valid@example.test', 'password': 'password'}, origin='https://other.example')[0], 403)
        self.register(client, 'validator')
        bad = copy.deepcopy(DOCUMENT)
        bad['branches'] *= 6
        self.assertEqual(self.request(client, '/api/projects', {'document': bad})[0], 400)
        self.assertEqual(self.request(client, '/api/projects', {'id': [], 'document': DOCUMENT})[0], 400)
        self.assertEqual(self.request(client, '/api/projects', {'id': ['bad'], 'document': DOCUMENT})[0], 400)

    def test_favorites_persist_and_are_private(self):
        alice, bob = self.client(), self.client()
        self.register(alice, 'fav_alice')
        self.register(bob, 'fav_bob')
        item = {'id': 'a', 'name': 'Flame', 'icon': 'spell_fire_fireball02', 'row': 0, 'col': 0, 'maxRank': 1, 'descriptions': ['Fire'], 'requires': 'old-id'}
        status, result, _ = self.request(alice, '/api/favorites', {'kind': 'talent', 'item': item})
        self.assertEqual(status, 200)
        fid = result['id']
        favorite = self.request(alice, '/api/favorites')[1]['favorites'][0]
        self.assertEqual(favorite['item']['requires'], '')
        self.assertEqual(self.request(bob, '/api/favorites')[1]['favorites'], [])
        self.assertEqual(self.request(bob, '/api/favorites/'+fid, {}, 'DELETE')[0], 404)
        self.assertEqual(self.request(alice, '/api/favorites/'+fid, {}, 'DELETE')[0], 200)
        self.assertEqual(self.request(alice, '/api/favorites')[1]['favorites'], [])

    def test_share_counters_deduplicate_browsers_and_accounts(self):
        owner, visitor, saver, second = self.client(), self.client(), self.client(), self.client()
        self.register(owner, 'counter_owner')
        token = self.request(owner, '/api/share', {'document': DOCUMENT})[1]['token']
        path = '/api/shared/' + token
        self.assertEqual(self.request(visitor, path)[1]['stats'], {'allocated': 0, 'saved': 0})
        for _ in range(3):
            self.assertEqual(self.request(visitor, path+'/interact', {})[1]['stats']['allocated'], 1)
        self.assertEqual(self.request(visitor, path)[1]['stats']['allocated'], 1)
        self.request(second, path)
        self.assertEqual(self.request(second, path+'/interact', {})[1]['stats']['allocated'], 2)
        self.assertEqual(self.request(visitor, '/api/projects', {'document': DOCUMENT, 'sourceShare': token, 'copy': True})[0], 401)
        self.register(saver, 'counter_saver')
        for _ in range(2):
            self.assertEqual(self.request(saver, '/api/projects', {'document': DOCUMENT, 'sourceShare': token, 'copy': True})[0], 200)
        self.assertEqual(self.request(visitor, path)[1]['stats'], {'allocated': 2, 'saved': 1})

    def test_custom_icon_upload_is_rejected(self):
        client = self.client()
        self.register(client, 'icon_guard')
        bad = copy.deepcopy(DOCUMENT)
        bad['abilities'] = [{'id': 'a', 'name': 'Custom', 'description': 'x', 'icon': 'data:image/png;base64,YWJj'}]
        status, result, _ = self.request(client, '/api/projects', {'document': bad})
        self.assertEqual(status, 400)
        self.assertIn('собственных иконок отключена', result['error'])

    def test_four_branch_limit(self):
        document = copy.deepcopy(DOCUMENT)
        document['branches'] = [{'id': str(i), 'name': 'Branch', 'rows': 5, 'talents': []} for i in range(4)]
        server.validate(document)
        document['branches'].append({'id': 'fifth', 'name': 'Old branch', 'rows': 5, 'talents': []})
        with self.assertRaisesRegex(ValueError, '4 веток'):
            server.validate(document)

    def test_rank_template_roundtrip_and_consistency(self):
        client = self.client()
        self.register(client, 'template_author')
        document = copy.deepcopy(DOCUMENT)
        model = {'text': 'Урон {число1}%, время {число2} сек.', 'variables': [
            {'key': 'число1', 'label': 'Урон', 'values': ['2', '9', '20']},
            {'key': 'число2', 'label': 'Время', 'values': ['0,1', '0,2', '0,3']}]}
        talent = {'id': 'template', 'name': 'Flame', 'icon': 'spell_fire_fireball02', 'row': 0, 'col': 0, 'maxRank': 3, 'requires': '', 'rankTemplate': model, 'descriptions': server.render_rank_template(model, 3)}
        document['branches'][0]['talents'] = [talent]
        status, result, _ = self.request(client, '/api/projects', {'document': document})
        self.assertEqual(status, 200)
        saved = self.request(client, '/api/projects/'+result['id'])[1]['document']['branches'][0]['talents'][0]
        self.assertEqual(saved['rankTemplate'], model)
        self.assertEqual(saved['descriptions'][1], 'Урон 9%, время 0,2 сек.')
        talent['descriptions'][1] = 'Wrong description'
        self.assertEqual(self.request(client, '/api/projects', {'document': document})[0], 400)
        talent['rankTemplate'] = {}
        self.assertEqual(self.request(client, '/api/projects', {'document': document})[0], 400)

    def test_linked_talents_use_ability_as_source(self):
        document = copy.deepcopy(DOCUMENT)
        document['abilities'] = [{'id': 'source', 'name': 'Fire', 'icon': 'spell_fire_fireball02', 'description': 'Damage'}]
        document['branches'][0]['talents'] = [{'id': 't'+str(i), 'row': 0, 'col': i, 'maxRank': 1, 'requires': '', 'grantedAbilityId': 'source', 'name': 'Stale', 'icon': 'inv_misc_questionmark', 'descriptions': ['Stale']} for i in range(2)]
        server.validate(document)
        document['abilities'][0]['name'] = 'Greater Fire'
        document['abilities'][0]['description'] = 'New damage'
        server.validate(document)
        self.assertEqual(len(document['abilities']), 1)
        for talent in document['branches'][0]['talents']:
            self.assertEqual(talent['name'], 'Greater Fire')
            self.assertEqual(talent['descriptions'], ['New damage'])
        document['branches'][0]['talents'][0]['grantedAbilityId'] = 'missing'
        with self.assertRaisesRegex(ValueError, 'не найдена'):
            server.validate(document)

    def test_crossing_dependencies_are_rejected(self):
        document = copy.deepcopy(DOCUMENT)
        positions = [('a', 0, 0, ''), ('b', 0, 3, ''), ('c', 2, 3, 'a'), ('d', 2, 0, 'b')]
        document['branches'][0]['rows'] = 3
        document['branches'][0]['talents'] = [{'id': id, 'row': row, 'col': col, 'requires': parent, 'name': id, 'icon': 'inv_misc_questionmark', 'maxRank': 1, 'descriptions': ['x']} for id,row,col,parent in positions]
        with self.assertRaisesRegex(ValueError, 'пересекаются'):
            server.validate(document)

    def test_ability_kind_and_branch_membership(self):
        document=copy.deepcopy(DOCUMENT)
        document['branches'][0]['icon']='spell_fire_flamebolt'
        document['abilities']=[{'id':'passive','name':'Armor','icon':'inv_shield_04','description':'More armor','kind':'passive','branchId':'a'}]
        server.validate(document)
        document['abilities'][0]['branchId']='missing'
        with self.assertRaisesRegex(ValueError,'Ветка'):
            server.validate(document)
        document['abilities'][0]['branchId']='auto';document['abilities'][0]['kind']='wrong'
        with self.assertRaisesRegex(ValueError,'тип'):
            server.validate(document)

    def test_presets_validate_on_server(self):
        files = list((server.ROOT / 'static' / 'presets').glob('*.json'))
        self.assertEqual(len(files), 39)
        for path in files:
            if path.name != 'index.json':
                server.validate(json.loads(path.read_text()))

if __name__ == '__main__':
    unittest.main()
