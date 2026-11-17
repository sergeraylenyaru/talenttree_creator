import http.client
import os
from pathlib import Path
import unittest
from unittest.mock import patch

import server
from server_lifecycle import start_server, temporary_database


class LocalWorldAssetsTest(unittest.TestCase):
    def test_opt_in_loopback_file_types_scope_and_revalidation(self):
        with temporary_database() as folder, patch.object(server, 'ROOT', Path(folder)):
            root = Path(folder) / 'local-assets' / 'wow'
            character = root / 'character'
            character.mkdir(parents=True)
            (root / 'manifest.json').write_text('{"model":"character/hero.glb"}', encoding='utf-8')
            (character / 'Hero Test.glb').write_bytes(b'fixture')
            (character / 'private.js').write_text('private', encoding='utf-8')
            for directory in ('targets', 'weapons', 'world'):
                nested = root / directory / 'nested'
                nested.mkdir(parents=True)
                (nested / 'Model.glb').write_bytes(directory.encode())
            server.DB = str(Path(folder) / 'test.sqlite3')
            server.initialize()
            http_server = server.ArchiveHTTPServer(('127.0.0.1', 0), server.Handler)
            start_server(http_server)

            def get(path, headers=None):
                client = http.client.HTTPConnection('127.0.0.1', http_server_port)
                try:
                    client.request('GET', '/local-world-assets/' + path, headers=headers or {})
                    response = client.getresponse()
                    return response.status, dict(response.getheaders()), response.read()
                finally:
                    client.close()

            http_server_port = http_server.server_port
            with patch.dict(os.environ, {'TALENT_LOCAL_WOW_ASSETS': ''}):
                self.assertEqual(get('manifest.json')[0], 404)
            with patch.dict(os.environ, {'TALENT_LOCAL_WOW_ASSETS': '1'}):
                self.assertEqual(get('manifest.json')[0], 200)
                self.assertEqual(get('manifest.json', {'Host': 'example.test'})[0], 404)
                self.assertEqual(get('manifest.json', {'X-Forwarded-For': '203.0.113.5'})[0], 404)
                for path in ('character/%2e%2e/manifest.json', 'character%5cHero%20Test.glb', 'character/private.js', 'character/'):
                    self.assertEqual(get(path)[0], 404)
                for directory in ('targets', 'weapons', 'world'):
                    self.assertEqual(get(f'{directory}/nested/Model.glb')[2], directory.encode())
                for invalid in ('world/%2fabsolute.glb', 'world/nested/../../manifest.json', 'world/https:%2F%2Fevil.glb', 'other/model.glb'):
                    self.assertEqual(get(invalid)[0], 404)
                status, headers, data = get('character/Hero%20Test.glb')
                self.assertEqual((status, data), (200, b'fixture'))
                self.assertEqual(headers['Content-Type'], 'model/gltf-binary')
                self.assertEqual(get('character/Hero%20Test.glb', {'If-None-Match': headers['ETag']})[0], 304)
