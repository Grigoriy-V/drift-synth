#!/usr/bin/env python3
"""Локальный сервер для Drift: отдаёт файлы без кэширования, чтобы правки были видны сразу."""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


os.chdir(os.path.dirname(os.path.abspath(__file__)))
print(f"Drift: http://localhost:{PORT}/")
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
