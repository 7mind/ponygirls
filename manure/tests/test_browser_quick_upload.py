"""Specified Blackbox/Good-Communication upload acceptance on the actual target."""
import base64
import unittest

import browser_fixtures as bf


class QuickUploadBrowserTests(unittest.TestCase):
    def fixture(self):
        fix = bf.start_server(suffix_mode="path", config_overrides={
            "api_origin": "http://manure-http.test:0",
            "loopback_dev": False, "allow_insecure_http": True})
        self.addCleanup(fix.close)
        return fix

    def run_browser(self, fix, steps):
        out = bf.run_steps(steps, host_resolver_rules="MAP manure-http.test 127.0.0.1")
        self.assertTrue(all(step["ok"] for step in out), [step for step in out if not step["ok"]])
        bf.assert_no_secrets_in_request_urls(self, out, [fix.identity.token])
        return [step["value"] for step in out if step["op"] == "eval"]

    def login(self, fix):
        return [
            {"op": "fill", "selector": "#token-input", "value": fix.identity.token},
            {"op": "click", "selector": "#login-form button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status", "contains": "shown"},
        ]

    def test_http_paste_picker_drop_stage_then_publish_exact_bytes(self):
        fix = self.fixture()
        # Valid tiny PNG and PDF fixture bytes; compare persisted original bytes,
        # not formatted viewer HTML. No external renderers or live services.
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=")
        pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n"
        stage = """() => {
          const transfer=new DataTransfer();transfer.items.add(new File(['ignored'],'before.png',{type:'image/png'}));
          document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
          return document.querySelectorAll('#upload-list li').length;
        }"""
        paste = """(base64) => {
          const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'shot.png',{type:'image/png'}));
          document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
          const text=new DataTransfer();text.setData('text/plain','ordinary paste');
          const event=new ClipboardEvent('paste',{clipboardData:text,bubbles:true,cancelable:true});
          document.querySelector('#filter-text').dispatchEvent(event);
          return {count:document.querySelectorAll('#upload-list li').length,textPrevented:event.defaultPrevented,inits:window.__inits};
        }"""
        verify = """async (expected) => {
          const rows=[...document.querySelectorAll('#upload-list li')];
          const results=[];
          for(let i=0;i<rows.length;i++) {
            const row=rows[i], id=/ID ([0-9a-f]{32})/.exec(row.textContent)[1];
            const path=['shot.png','report.pdf','empty.txt'][i];
            const res=await fetch('/api/current/artifacts/'+id+'/files/'+path+'/content');
            const data=new Uint8Array(await res.arrayBuffer());
            const actual=btoa(String.fromCharCode(...data));
            const url=new URL(row.querySelector('input').value);
            results.push(res.status===200 && actual===expected[i] && url.pathname==='/view/'+id && !url.search && !url.hash);
          }
          return {results,inits:window.__inits,passwords:document.querySelectorAll('#upload-list code').length,external:rows.every(row=>row.querySelector('strong').textContent.endsWith('external'))};
        }"""
        values = self.run_browser(fix, [
            {"op": "addInitScript", "fn": """() => {const original=window.fetch.bind(window);window.__inits=0;window.fetch=(url,options)=>{if(options?.body && typeof options.body==='string' && JSON.parse(options.body).command?.InitUpload)window.__inits++;return original(url,options);};}"""},
            {"op": "goto", "url": fix.api_base + "/"},
            {"op": "waitForEval", "fn": "() => !document.querySelector('#login-section').hidden && !isSecureContext && !crypto.subtle"},
            {"op": "eval", "fn": stage},
            *self.login(fix),
            {"op": "eval", "fn": paste, "arg": base64.b64encode(png).decode()},
            {"op": "eval", "fn": "() => {return true;}"},
            {"op": "setInputFiles", "selector": "#upload-files", "files": [{"name": "report.pdf", "mimeType": "application/pdf", "base64": base64.b64encode(pdf).decode()}]},
            {"op": "eval", "fn": """() => {document.querySelector('#upload-visibility').value='external';const t=new DataTransfer();t.items.add(new File([],'empty.txt'));document.querySelector('#quick-upload').dispatchEvent(new DragEvent('drop',{dataTransfer:t,bubbles:true,cancelable:true}));return {count:document.querySelectorAll('#upload-list li').length,inits:window.__inits};}"""},
            {"op": "click", "selector": "#upload-submit"},
            {"op": "waitForEval", "fn": "() => document.querySelectorAll('#upload-list input[readonly]').length===3"},
            {"op": "eval", "fn": verify, "arg": [base64.b64encode(png).decode(), base64.b64encode(pdf).decode(), ""]},
            {"op": "click", "selector": "#upload-list button:has-text('Dismiss password') >> nth=0"},
            {"op": "eval", "fn": "() => document.querySelectorAll('#upload-list code').length"},
            {"op": "click", "selector": "#logout-button"},
            {"op": "waitForEval", "fn": "() => !document.querySelector('#login-section').hidden"},
            {"op": "eval", "fn": "() => ({rows:document.querySelectorAll('#upload-list li').length,storage:localStorage.length+sessionStorage.length})"},
        ])
        self.assertEqual(values, [0, {"count": 1, "textPrevented": False, "inits": 0}, True,
                                  {"count": 3, "inits": 0}, {"results": [True, True, True], "inits": 3, "passwords": 3, "external": True},
                                  2, {"rows": 0, "storage": 0}])

    def test_lost_chunk_finish_retry_and_late_init_after_logout(self):
        fix = self.fixture()
        inject = """() => {
          const original=window.fetch;window.__uploadTest={inits:0,lostChunk:false,lostFinish:false,hold:false,release:null};
          window.fetch=async(url,options)=>{
            const state=window.__uploadTest;
            let command=null;if(typeof options?.body==='string')command=JSON.parse(options.body).command;
            if(command?.InitUpload)state.inits++;
            const response=await original(url,options);
            if(options?.method==='PUT' && !state.lostChunk){state.lostChunk=true;throw new Error('controlled-offline');}
            if(command?.FinishUpload && !state.lostFinish){state.lostFinish=true;throw new Error('controlled-offline');}
            if(command?.InitUpload && state.hold)return new Promise(resolve=>{state.release=()=>resolve(response);});
            return response;
          };return true;
        }"""
        values = self.run_browser(fix, [
            {"op": "addInitScript", "fn": inject},
            {"op": "goto", "url": fix.api_base + "/"}, *self.login(fix),
            {"op": "setInputFiles", "selector": "#upload-files", "files": [{"name": "retry.txt", "mimeType": "text/plain", "base64": "cmV0cnk="}]},
            {"op": "click", "selector": "#upload-submit"},
            {"op": "waitForText", "selector": "#upload-list", "contains": "Upload failed"},
            {"op": "click", "selector": "#upload-submit"},
            {"op": "waitForText", "selector": "#upload-list", "contains": "Publication is uncertain"},
            {"op": "click", "selector": "#upload-submit"},
            {"op": "waitForEval", "fn": "() => document.querySelectorAll('#upload-list input[readonly]').length===1"},
            {"op": "eval", "fn": "() => ({inits:window.__uploadTest.inits,chunk:window.__uploadTest.lostChunk,finish:window.__uploadTest.lostFinish})"},
            {"op": "click", "selector": "#upload-clear"},
            {"op": "eval", "fn": "() => {window.__uploadTest.hold=true;document.querySelector('#upload-visibility').value='external';return true;}"},
            {"op": "setInputFiles", "selector": "#upload-files", "files": [{"name": "late.txt", "mimeType": "text/plain", "base64": "bGF0ZQ=="}]},
            {"op": "click", "selector": "#upload-submit"},
            {"op": "waitForEval", "fn": "() => typeof window.__uploadTest.release==='function'"},
            {"op": "click", "selector": "#logout-button"},
            {"op": "waitForEval", "fn": "() => !document.querySelector('#login-section').hidden"},
            {"op": "eval", "fn": "async () => {window.__uploadTest.release();await new Promise(resolve=>setTimeout(resolve,150));return {rows:document.querySelectorAll('#upload-list li').length,passwords:document.querySelectorAll('#upload-list code').length};}"},
        ])
        self.assertEqual(values, [{"inits": 1, "chunk": True, "finish": True}, True, {"rows": 0, "passwords": 0}])

    def test_public_multichunk_binary_link_is_anonymously_readable_on_http(self):
        fix = self.fixture()
        values = self.run_browser(fix, [
            {"op": "addInitScript", "fn": """() => {
                const original=window.fetch.bind(window);window.__chunkLengths=[];
                window.fetch=(url,options)=>{if(options?.method==='PUT')window.__chunkLengths.push(options.body.size);return original(url,options);};
            }"""},
            {"op": "goto", "url": fix.api_base + "/"}, *self.login(fix),
            {"op": "eval", "fn": """async () => {
              const res=await fetch('/api/current',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'00000000-0000-4000-8000-000000000001',apiVersion:'1.0.0',command:{GetCapabilities:{}}})});
              const cap=(await res.json()).result.CapabilityInfo.capabilities;
              window.__binarySize=cap.chunkBytes*2+17;window.__chunkSize=cap.chunkBytes;
              const data=new Uint8Array(window.__binarySize);for(let i=0;i<data.length;i++)data[i]=(i*31+17)%256;
              const transfer=new DataTransfer();transfer.items.add(new File([data],'binary.bin',{type:'application/octet-stream'}));
              document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
              document.querySelector('#upload-visibility').value='public';
              return document.querySelector('#upload-list strong').textContent.endsWith('internal');
            }"""},
            {"op": "click", "selector": "#upload-submit"},
            {"op": "waitForEval", "fn": "() => document.querySelectorAll('#upload-list input[readonly]').length===1"},
            {"op": "click", "selector": "#upload-list button:has-text('Copy content link')"},
            {"op": "waitForText", "selector": "#upload-status", "contains": "copy it manually"},
            {"op": "eval", "fn": """async () => {
              const row=document.querySelector('#upload-list li'), input=row.querySelector('input[readonly]');
              const res=await fetch(input.value,{credentials:'omit',headers:{Accept:'application/octet-stream'}});
              const data=new Uint8Array(await res.arrayBuffer());
              let exact=data.length===window.__binarySize;for(let i=0;i<data.length;i++)if(data[i]!==((i*31+17)%256))exact=false;
              return {exact,anonymousStatus:res.status,public:row.querySelector('strong').textContent.endsWith('public'),
                chunks:window.__chunkLengths,chunkSize:window.__chunkSize,link:input.value};
            }"""},
        ])
        self.assertTrue(values[0], "initial staging must default to Internal")
        result = values[1]
        self.assertEqual({key: result[key] for key in ("exact", "anonymousStatus", "public")},
                         {"exact": True, "anonymousStatus": 200, "public": True})
        self.assertEqual(result["chunks"], [result["chunkSize"], result["chunkSize"], 17])
        # A separate client has no browser session or bearer token. The public
        # content URL itself must suffice for a remote agent, not just the API.
        import urllib.request
        import socket
        from unittest.mock import patch
        lookup = socket.getaddrinfo
        def local_dns(host, port, *args, **kw):
            return lookup("127.0.0.1" if host == "manure-http.test" else host, port, *args, **kw)
        with patch("socket.getaddrinfo", local_dns):
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(urllib.request.Request(result["link"], headers={"Accept": "application/octet-stream"}), timeout=15) as response:
                raw = response.read(result["chunkSize"]*2+18)
        self.assertEqual(raw, bytes((i*31+17)%256 for i in range(result["chunkSize"]*2+17)))
