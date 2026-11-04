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
        status, _, headers = self.request(client, '/api/register', {'login': name, 'password': 'test-password-123'})
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
        self.assertEqual(self.request(alice, '/api/login', {'login': 'alice', 'password': 'wrong-password'})[0], 401)
        self.assertEqual(self.request(alice, '/api/login', {'login': 'ALICE', 'password': 'test-password-123'})[0], 200)
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
        self.assertEqual(self.request(client, '/api/login', {'login': 'valid', 'password': 'password'}, origin='https://other.example')[0], 403)
        self.register(client, 'validator')
        bad = copy.deepcopy(DOCUMENT)
        bad['branches'] *= 6
        self.assertEqual(self.request(client, '/api/projects', {'document': bad})[0], 400)
        self.assertEqual(self.request(client, '/api/projects', {'id': [], 'document': DOCUMENT})[0], 400)
        self.assertEqual(self.request(client, '/api/projects', {'id': ['bad'], 'document': DOCUMENT})[0], 400)

    def test_presets_validate_on_server(self):
        files = list((server.ROOT / 'static' / 'presets').glob('*.json'))
        self.assertEqual(len(files), 11)
        for path in files:
            if path.name != 'index.json':
                server.validate(json.loads(path.read_text()))

if __name__ == '__main__':
    unittest.main()
