"""Local static server for Human Generator Studio.

Python's plain http.server sends no Cache-Control header, so browsers may keep
serving old modules after the project is updated. This server asks the browser
to revalidate every file and gives module scripts and textures explicit types.
"""
import http.server
import os
import socket
import sys
import threading
from functools import partial
from pathlib import Path


class StudioHandler(http.server.SimpleHTTPRequestHandler):
    # Persistent connections: the page and the generation worker fetch ~100
    # modules; HTTP/1.0 opened a new connection for each one. Every response
    # of SimpleHTTPRequestHandler carries Content-Length, as HTTP/1.1 requires.
    protocol_version = "HTTP/1.1"
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".webp": "image/webp",
        ".bin": "application/octet-stream",
        ".glb": "model/gltf-binary",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    # Port: the command-line argument, else the PORT variable (set by the preview
    # tooling when it assigns a free port), else 8765.
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8765"))
    root = Path(__file__).resolve().parent
    handler = partial(StudioHandler, directory=str(root))
    http.server.ThreadingHTTPServer.daemon_threads = True
    # Browsers resolve "localhost" to ::1 first; with nothing listening there each
    # new connection waited for the refusal (~200 ms on Windows) before IPv4.
    # A second server on the IPv6 loopback answers it (loopback only).
    try:
        class LoopbackV6(http.server.ThreadingHTTPServer):
            address_family = socket.AF_INET6
        v6 = LoopbackV6(("::1", port), handler)
        threading.Thread(target=v6.serve_forever, daemon=True).start()
    except OSError:
        pass
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"Serving {root} at http://127.0.0.1:{port}/ (Ctrl+C to stop)")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
