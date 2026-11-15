"""Resource ownership checks that do not depend on garbage collection or sleeps."""
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sqlite3
import threading
import unittest
import urllib.request
from unittest.mock import patch

import server
import test_server as base
from server_lifecycle import temporary_database, start_server, stop_server


class SQLiteLifecycle(unittest.TestCase):
    def test_context_commits_and_closes_with_a_retained_reference(self):
        original = server.DB
        with temporary_database() as directory:
            path = Path(directory) / 'commit.sqlite'
            server.DB = str(path)
            with server.connect() as db:
                self.assertIsInstance(db, sqlite3.Connection)
                self.assertEqual(db.execute('PRAGMA foreign_keys').fetchone()[0], 1)
                db.execute('CREATE TABLE example(value INTEGER)')
                db.execute('INSERT INTO example VALUES(7)')
            # Keep db alive: cleanup must not rely on its destructor or gc.collect().
            with self.assertRaises(sqlite3.ProgrammingError):
                db.execute('SELECT 1')
            with closing(sqlite3.connect(path)) as reader:
                self.assertEqual(reader.execute('SELECT value FROM example').fetchall(), [(7,)])
        self.assertEqual(server.DB, original)
        self.assertFalse(path.exists())

    def test_exception_rolls_back_and_closes(self):
        with temporary_database() as directory:
            server.DB = str(Path(directory) / 'rollback.sqlite')
            with server.connect() as setup:
                setup.execute('CREATE TABLE example(value INTEGER)')
            with self.assertRaisesRegex(ValueError, 'rollback'):
                with server.connect() as db:
                    db.execute('INSERT INTO example VALUES(8)')
                    raise ValueError('rollback')
            with self.assertRaises(sqlite3.ProgrammingError):
                db.execute('SELECT 1')
            with server.connect() as reader:
                self.assertEqual(reader.execute('SELECT COUNT(*) FROM example').fetchone()[0], 0)

    def test_explicit_commit_remains_committed_when_later_work_rolls_back(self):
        with temporary_database() as directory:
            server.DB = str(Path(directory) / 'explicit.sqlite')
            with server.connect() as setup:
                setup.execute('CREATE TABLE example(value INTEGER)')
            with self.assertRaises(ValueError):
                with server.connect() as db:
                    db.execute('INSERT INTO example VALUES(1)')
                    db.commit()
                    db.execute('INSERT INTO example VALUES(2)')
                    raise ValueError('rollback second insert only')
            with server.connect() as reader:
                self.assertEqual(reader.execute('SELECT value FROM example').fetchall(), [(1,)])

    def test_failed_commit_also_closes(self):
        with temporary_database() as directory:
            server.DB = str(Path(directory) / 'failed-commit.sqlite')
            with server.connect() as setup:
                setup.executescript('CREATE TABLE parent(id INTEGER PRIMARY KEY);'
                    'CREATE TABLE child(parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);')
            with self.assertRaises(sqlite3.IntegrityError):
                with server.connect() as db:
                    db.execute('INSERT INTO child VALUES(42)')
            with self.assertRaises(sqlite3.ProgrammingError):
                db.execute('SELECT 1')
            with server.connect() as reader:
                self.assertEqual(reader.execute('SELECT COUNT(*) FROM child').fetchone()[0], 0)

    def test_connection_initialization_failure_closes(self):
        class BrokenConnection:
            closed = False
            def execute(self, query):
                raise sqlite3.OperationalError('pragma failed')
            def close(self):
                self.closed = True
        db = BrokenConnection()
        with patch('server.sqlite3.connect', return_value=db):
            with self.assertRaisesRegex(sqlite3.OperationalError, 'pragma failed'):
                server.connect()
        self.assertTrue(db.closed)


class HTTPLifecycle(unittest.TestCase):
    def test_cleanup_waits_for_a_handler_after_its_response_has_been_read(self):
        original = server.DB
        holding_db, release_handler, entered_close, closed = (threading.Event() for _ in range(4))
        connections, handlers, errors = [], [], []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                with server.connect() as db:
                    connections.append(db)
                    handlers.append(threading.current_thread())
                    db.execute('SELECT 1')
                    self.send_response(200)
                    self.send_header('Content-Length', '2')
                    self.end_headers()
                    self.wfile.write(b'ok')
                    self.wfile.flush()
                    holding_db.set()
                    release_handler.wait()

        class HTTPServer(ThreadingHTTPServer):
            def server_close(self):
                entered_close.set()
                super().server_close()
                closed.set()

        with temporary_database() as directory:
            path = Path(directory) / 'active.sqlite'
            server.DB = str(path)
            server.initialize()
            http = HTTPServer(('127.0.0.1', 0), Handler)
            serving = start_server(http)
            self.assertFalse(http.daemon_threads)
            self.assertTrue(http.block_on_close)
            self.assertFalse(serving.daemon)
            closer = None
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{http.server_port}/') as response:
                    self.assertEqual(response.read(), b'ok')
                self.assertTrue(holding_db.wait(5), 'Handler did not open its database')
                self.assertFalse(handlers[0].daemon)
                def close_server():
                    try:
                        stop_server(http)
                    except BaseException as error:
                        errors.append(error)
                closer = threading.Thread(target=close_server)
                closer.start()
                self.assertTrue(entered_close.wait(5), 'Server did not reach handler join')
                self.assertFalse(serving.is_alive())
                self.assertFalse(closed.is_set(), 'server_close returned while a handler held SQLite')
                self.assertTrue(closer.is_alive())
                self.assertEqual(server.DB, str(path))
                self.assertTrue(path.exists())
            finally:
                release_handler.set()
                if closer is not None:
                    closer.join(5)
                    self.assertFalse(closer.is_alive(), 'Server cleanup thread did not finish')
            self.assertEqual(errors, [])
            self.assertTrue(closed.is_set())
            self.assertFalse(handlers[0].is_alive())
            self.assertEqual(http.fileno(), -1)
            with self.assertRaises(sqlite3.ProgrammingError):
                connections[0].execute('SELECT 1')
            # Calling cleanup again is safe for fixture and class cleanup paths.
            stop_server(http)
        self.assertEqual(server.DB, original)
        self.assertFalse(path.exists())

    def test_context_stops_started_server_on_setup_failure(self):
        original = server.DB
        with self.assertRaisesRegex(RuntimeError, 'setup failed'):
            with temporary_database() as directory:
                server.DB = str(Path(directory) / 'setup.sqlite')
                server.initialize()
                http = server.ArchiveHTTPServer(('127.0.0.1', 0), server.Handler)
                thread = start_server(http)
                raise RuntimeError('setup failed')
        self.assertFalse(thread.is_alive())
        self.assertEqual(http.fileno(), -1)
        self.assertEqual(server.DB, original)
        self.assertFalse(Path(directory).exists())

    def test_unittest_class_setup_failure_runs_registered_database_cleanup(self):
        original = server.DB
        resources = {}
        class BrokenAPI(unittest.TestCase):
            @classmethod
            def setUpClass(cls):
                base.API.setUpClass.__func__(cls)
                resources.update(http=cls.http, thread=cls.thread, path=Path(server.DB))
                raise RuntimeError('class setup failed')
            def test_not_reached(self):
                raise AssertionError('Failed setup must prevent execution')
        result = unittest.TestResult()
        unittest.defaultTestLoader.loadTestsFromTestCase(BrokenAPI).run(result)
        self.assertEqual(len(result.errors), 1)
        self.assertIn('class setup failed', result.errors[0][1])
        self.assertFalse(resources['thread'].is_alive())
        self.assertEqual(resources['http'].fileno(), -1)
        self.assertFalse(resources['path'].parent.exists())
        self.assertEqual(server.DB, original)
