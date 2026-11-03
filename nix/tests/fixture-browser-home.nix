# Real pinned Chromium launch in the builder, deliberately invalid inherited
# HOME. The fixture wrapper, not a browser flag/skip, must provide private XDG.
{ pkgs, fixtureTools }:
let dependencies=pkgs.callPackage ../pkg/haystack/test-dependencies.nix {};
in pkgs.runCommand "owned-fixture-browser-private-home" {} ''
  export HOME=/homeless-shelter
  unset XDG_CONFIG_HOME XDG_CACHE_HOME XDG_RUNTIME_DIR XDG_DATA_HOME
  ${fixtureTools}/bin/with-service-postgres \
    ${fixtureTools}/bin/with-browser-environment \
    ${pkgs.nodejs_24}/bin/node --input-type=module - <<'JS'
  import assert from 'node:assert/strict';
  import fs from 'node:fs';
  import path from 'node:path';
  import {chromium} from '${dependencies}/lib/node_modules/playwright-core/index.mjs';
  const browser=await chromium.launch({executablePath:process.env.HAYSTACK_CHROMIUM,headless:true,args:['--no-sandbox']});
  try {
    const page=await browser.newPage();await page.goto('about:blank');
    for(const key of ['HOME','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_RUNTIME_DIR','XDG_DATA_HOME']) {
      const value=process.env[key];assert.ok(value && value.startsWith(process.env.PONYGIRLS_OWNED_FIXTURE_ROOT+path.sep));
      assert.equal(fs.statSync(value).mode & 0o777,0o700);
    }
    fs.mkdirSync(process.env.out);fs.writeFileSync(path.join(process.env.out,'receipt.json'),JSON.stringify({cases:['real-pinned-Chromium-launch-from-invalid-inherited-HOME','owned-private-home-and-all-XDG-directories'],skips:0})+'\n');
  } finally {await browser.close();}
  JS
''
