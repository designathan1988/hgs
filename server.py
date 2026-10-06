"""Local static server for Human Generator Studio.

Python's plain http.server sends no Cache-Control header, so browsers may keep
serving old modules after the project is updated. This server asks the browser
to revalidate every file and gives module scripts and textures explicit types.
"""
import http.server
import sys
from functools import partial
from pathlib import Path


class StudioHandler(http.server.SimpleHTTPRequestHandler):
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
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    root = Path(__file__).resolve().parent
    handler = partial(StudioHandler, directory=str(root))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"Serving {root} at http://127.0.0.1:{port}/ (Ctrl+C to stop)")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
