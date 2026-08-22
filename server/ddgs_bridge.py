"""Local DDGS bridge used by the browser client.

Run with: ``python server/ddgs_bridge.py`` after ``pip install -r requirements.txt``.
The bridge deliberately exposes DDGS, not a provider-specific scraper.
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ddgs import DDGS


class Handler(BaseHTTPRequestHandler):
    def _json(self, status, payload):
        encoded = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()

    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            with DDGS(timeout=15) as ddgs:
                if self.path in ("/search/text", "/search/news"):
                    method = ddgs.text if self.path.endswith("text") else ddgs.news
                    results = method(body.get("query", ""), backend=body.get("backend", "auto"), max_results=min(int(body.get("max_results", 6)), 25), region=body.get("region", "us-en"), safesearch=body.get("safesearch", "moderate"))
                    return self._json(200, {"results": results})
                if self.path == "/extract":
                    results = ddgs.extract(body.get("url", ""))
                    content = results.get("content", "") if isinstance(results, dict) else (results[0].get("content", "") if results else "")
                    return self._json(200, {"content": content})
            self._json(404, {"error": "Unknown DDGS endpoint"})
        except Exception as error:  # Client code handles this as a partial retrieval failure.
            self._json(502, {"error": str(error)})


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 4479), Handler).serve_forever()
