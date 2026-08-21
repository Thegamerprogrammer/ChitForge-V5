"""Launch DDGS API with the DuckDuckGo text-search transport fix ChitForge needs.

DDGS 9.15.0 posts to https://html.duckduckgo.com/html/ for text searches.
DuckDuckGo currently returns an anomaly challenge for that POST flow in some
Windows/Python environments, causing DDGS to raise "No results found." The
DuckDuckGo Lite/HTML GET endpoint returns normal, parseable, genuine results.

Run with:
    python scripts/chitforge_ddgs_api.py --host 127.0.0.1 --port 4479
"""
from __future__ import annotations

import argparse
import json
from urllib.parse import parse_qs, urlparse

import httpx

from ddgs.engines.duckduckgo import Duckduckgo
from ddgs.engines.duckduckgo_news import DuckduckgoNews
from ddgs.results import NewsResult, TextResult
from ddgs.utils import _extract_vqd

CHITFORGE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
CHITFORGE_BROWSER_HEADERS = {
    "User-Agent": CHITFORGE_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,text/plain,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://duckduckgo.com/",
}


def _decode_duckduckgo_redirect(href: str) -> str:
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlparse(href)
    if parsed.netloc.endswith("duckduckgo.com") and parsed.path == "/l/":
        return parse_qs(parsed.query).get("uddg", [href])[0]
    return href


def _lite_search(self, query, region="us-en", safesearch="moderate", timelimit=None, page=1, **kwargs):
    payload = {"q": query}
    if page > 1:
        payload["s"] = f"{10 + (page - 2) * 15}"
    resp = self.http_client.request("GET", "https://lite.duckduckgo.com/lite/", params=payload, headers=CHITFORGE_BROWSER_HEADERS)
    html_text = resp.text if resp.status_code == 200 else ""
    if not html_text or "anomaly" in html_text.lower():
        resp = self.http_client.request("GET", "https://html.duckduckgo.com/html/", params={"q": query, "b": "", "l": region}, headers=CHITFORGE_BROWSER_HEADERS)
        html_text = resp.text if resp.status_code == 200 else ""
    if not html_text or "anomaly" in html_text.lower():
        return None
    tree = self.extract_tree(html_text)
    results = []
    for link in tree.xpath('//a[contains(@class, "result-link")]'):
        result = TextResult()
        result.title = " ".join(link.xpath(".//text()"))
        result.href = _decode_duckduckgo_redirect(link.get("href") or "")
        row = link.getparent()
        snippet = ""
        for sibling in row.itersiblings():
            text = " ".join(" ".join(sibling.xpath(".//text()")).split())
            if text:
                snippet = text
                break
        result.body = snippet
        if result.href and not result.href.startswith("https://duckduckgo.com/y.js?"):
            results.append(result)
    return results



def _duckduckgo_news_search(self, query, region="us-en", safesearch="moderate", timelimit=None, page=1, **kwargs):
    headers = {
        **CHITFORGE_BROWSER_HEADERS,
        "Accept": "application/json, text/javascript, */*; q=0.01",
    }
    with httpx.Client(headers=headers, timeout=self.http_client.client.timeout if hasattr(self.http_client.client, "timeout") else 10, follow_redirects=False) as client:
        home = client.get("https://duckduckgo.com/", params={"q": query})
        if home.status_code != 200 or "anomaly" in home.text.lower():
            return None
        vqd = _extract_vqd(home.content, query)
        safesearch_base = {"on": "1", "moderate": "-1", "off": "-2"}
        payload = {"l": region, "o": "json", "noamp": "1", "q": query, "vqd": vqd, "p": safesearch_base[safesearch.lower()]}
        if timelimit:
            payload["df"] = timelimit
        if page > 1:
            payload["s"] = f"{(page - 1) * 30}"
        resp = client.get("https://duckduckgo.com/news.js", params=payload)
    if resp.status_code != 200 or "anomaly" in resp.text.lower():
        return None
    data = json.loads(resp.text)
    results = []
    for item in data.get("results", []):
        result = NewsResult()
        result.date = item.get("date")
        result.title = item.get("title")
        result.body = item.get("excerpt")
        result.url = item.get("url")
        result.image = item.get("image")
        result.source = item.get("source")
        results.append(result)
    return results

Duckduckgo.search = _lite_search
DuckduckgoNews.search = _duckduckgo_news_search

from ddgs.api_server.api import app  # noqa: E402  (patch must happen before requests)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run DDGS API with ChitForge DuckDuckGo compatibility patch.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4479)
    args = parser.parse_args()
    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
