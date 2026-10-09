#!/usr/bin/env python3
"""manure installed-default shells probe (owned helper, narrow, guest-run).

Runs INSIDE the edge VM guest (via environment.etc + edge.succeed), not on
the host. Verifies M2 on the INSTALLED package with default asset
resolution (no checkout fallback):

- derives the installed package path from the actual manure.service PID
  cmdline (NixOS does not put the binary in global PATH; corrected from
  an earlier assumed-PATH failure);
- dashboard / + /app.js + /styles.css bytes EQUAL the installed package
  assets, with expected Referrer-Policy (strict-origin for HTML,
  no-referrer for JS/CSS);
- external zero-file init/publish yields locked HTML (strict-origin) plus
  exactly 2 JS/CSS resources whose bytes EQUAL the installed unlock shell.

TLS scope (bounded, do NOT overclaim): this probe uses CERT_NONE and
Host-directed 127.0.0.1:443 to verify TLS TRANSPORT + Host routing +
installed bytes, NOT certificate trust/SAN. Production trust/SAN is
covered separately in the VM testScript via --cacert + --resolve
positive (correct SAN passes verification) and wrong-SAN negative
(verification fails). No public deployment or DNS changes.
"""
import hashlib
from html.parser import HTMLParser
import http.client
import json
from pathlib import Path
import subprocess
import ssl
from urllib.parse import urlsplit, urljoin

config = json.loads(Path('/run/manure/manure-config.json').read_text())
api = config['api_origin']
pid = int(subprocess.check_output(['systemctl', 'show', '-p', 'MainPID', '--value', 'manure.service']))
arguments = Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\x00')
packages = [Path(argument.decode()).parents[1] for argument in arguments
            if b'/bin/.manure-server-wrapped' in argument or b'/bin/manure-server' in argument]
assert len(packages) == 1
package = packages[0]
web_roots = list(package.glob('lib/python*/site-packages/manure/web'))
assert len(web_roots) == 1
web = web_roots[0]
# Transport-only context (see module docstring): verifies encryption +
# routing + bytes, not trust/SAN (covered by --cacert tests).
context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
context.check_hostname = False
context.verify_mode = ssl.CERT_NONE


def request(url, method='GET', payload=None, bearer=False):
    parsed = urlsplit(url)
    connection = http.client.HTTPSConnection('127.0.0.1', 443, context=context, timeout=30)
    headers = {'Host': parsed.netloc}
    body = None
    if bearer:
        headers['Authorization'] = 'Bearer ' + 'A' * 43
    if payload is not None:
        body = json.dumps(payload).encode()
        headers['Content-Type'] = 'application/json'
    try:
        connection.request(method, parsed.path or '/', body=body, headers=headers)
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read()
    finally:
        connection.close()


for route, file in (('/', 'index.html'), ('/app.js', 'app.js'), ('/styles.css', 'styles.css')):
    status, headers, body = request(api + route)
    assert status == 200, (route, status)
    assert body == (web / 'dashboard' / file).read_bytes(), route
    expected_policy = 'strict-origin' if route == '/' else 'no-referrer'
    assert headers['Referrer-Policy'] == expected_policy, route
print('Installed default dashboard: HTML, JavaScript, CSS match packaged bytes')

status, _, raw = request(api + '/api/v1/artifacts:init', 'POST', {
    'name': 'installed-unlock-shell', 'kind': 'dir', 'visibility': 'external',
    'files': [{'path': 'index.html', 'kind': 'file', 'size': 0,
               'sha256': hashlib.sha256(b'').hexdigest()}]}, True)
assert status == 200, status
artifact = json.loads(raw)
status, _, raw = request(api + '/api/v1/artifacts/' + artifact['artifact_id'] + '/publish',
                         'POST', bearer=True)
assert status == 200, status
content = json.loads(raw)['content_url']
status, headers, html = request(content)
assert status == 200 and headers['Referrer-Policy'] == 'strict-origin', (status, headers)


class Resources(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []
    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'script' and 'src' in values:
            self.urls.append(values['src'])
        if tag == 'link' and values.get('rel') == 'stylesheet':
            self.urls.append(values['href'])


resources = Resources()
resources.feed(html.decode())
assert len(resources.urls) == 2, resources.urls
for relative in resources.urls:
    resource = urljoin(content, relative)
    assert urlsplit(resource).netloc == urlsplit(content).netloc
    status, _, body = request(resource)
    assert status == 200, (relative, status)
    name = Path(urlsplit(resource).path).name
    assert body == (web / 'unlock' / name).read_bytes(), name
print('Installed default external unlock: trusted HTML, JavaScript, CSS served')
