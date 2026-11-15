"""Deterministic HTTP/SQLite fixture cleanup, including on setup failures."""
from contextlib import contextmanager
from contextvars import ContextVar
import tempfile
import threading

import server

_active_servers = ContextVar('test_http_servers', default=None)


@contextmanager
def temporary_database():
    """Stop owned servers and restore DB before deleting temporary database files."""
    previous_db = server.DB
    temporary = tempfile.TemporaryDirectory()
    servers = []
    token = _active_servers.set(servers)
    try:
        yield temporary.name
    finally:
        try:
            for http in reversed(servers):
                stop_server(http)
            server.DB = previous_db
            temporary.cleanup()
        finally:
            _active_servers.reset(token)


def start_server(http):
    """Configure tracked non-daemon handlers before starting serve_forever."""
    servers = _active_servers.get()
    if servers is None:
        http.server_close()
        raise RuntimeError('Test server must belong to a temporary_database context')
    http.daemon_threads = False
    http.block_on_close = True
    thread = threading.Thread(target=http.serve_forever, name='test-http-server', daemon=False)
    http._test_server_thread = thread
    http._test_server_stopped = False
    try:
        thread.start()
    except BaseException:
        http.server_close()
        raise
    servers.append(http)
    return thread


def stop_server(http):
    """Stop the accept loop, join it, then close and join all request handlers."""
    if http._test_server_stopped:
        return
    thread = http._test_server_thread
    http.shutdown()
    thread.join()
    if thread.is_alive():
        raise RuntimeError('Test HTTP server did not stop')
    # ThreadingMixIn.server_close joins its tracked non-daemon request handlers.
    http.server_close()
    http._test_server_stopped = True
