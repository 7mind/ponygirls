// Behavioral-Active / Effectual-GoodCommunication: real Chromium/current API,
// owned PostgreSQL, controlled model only; no content bytes or external provider.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
let raw='';for await(const chunk of process.stdin) raw+=chunk;
const input=JSON.parse(raw);
const require=createRequire(path.join(input.core,'package.json'));
const { chromium }=require('playwright-core');
const browser=await chromium.launch({executablePath:input.browser,args:['--no-sandbox','--no-proxy-server']});
const context=await browser.newContext();
const page=await context.newPage();
const failures=[];page.on('pageerror',error=>failures.push(error.message));
const requests=[];
await page.addInitScript(() => {
  const original=window.fetch.bind(window);
  window.__retrieval={commands:[],hold:false,release:null};
  window.fetch=(url,options)=>{
    let envelope=null;try{envelope=JSON.parse(options?.body||'null');}catch(_error){}
    const command=envelope?.command;
    if(command?.Search)window.__retrieval.commands.push(command.Search.query);
    if(command?.ListArtifacts)window.__retrieval.commands.push({mode:'Catalogue'});
    const result=original(url,options);
    if(command?.Search && window.__retrieval.hold){
      window.__retrieval.hold=false;
      return result.then(response=>new Promise(resolve=>{window.__retrieval.release=()=>resolve(response);}));
    }
    return result;
  };
});
page.on('request',request=>requests.push(request.url()));
try{
  await page.goto(input.base+'/',{waitUntil:'domcontentloaded'});
  await page.locator('#token-input').fill(input.token);
  await page.locator('#login-form button[type=submit]').click();
  await page.locator('#whoami-text').waitFor({state:'visible',timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#list-status').textContent.includes('shown'),null,{timeout:15000});
  const mode=page.locator('#filter-mode'),query=page.locator('#filter-text');
  assert.equal(await mode.inputValue(),'catalogue');
  if(input.stage==='outage'){
    await mode.selectOption('hybrid');await query.fill('hayneedle');
    await page.locator('#list-form button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#list-error').textContent.includes('search-unavailable'),null,{timeout:15000});
    assert.equal(await page.locator('#retrieval-results').textContent(),'');
    assert.deepEqual(await page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode!=='Catalogue').map(c=>c.mode)),['Hybrid'],
      'hybrid failure must not fall back to lexical');
    await mode.selectOption('lexical');
    await page.locator('#list-form button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#retrieval-results').textContent.includes('hayneedle'),null,{timeout:15000});
    assert.deepEqual(await page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode!=='Catalogue').map(c=>c.mode)),['Hybrid','Lexical']);
  } else if(input.stage==='no-provider'){
    await page.goto(input.base+'/#/artifacts?mode=semantic&q=hayneedle',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#list-status').textContent.includes('unavailable'),null,{timeout:15000});
    assert.equal(await mode.inputValue(),'semantic');
    assert.equal(await page.locator('#filter-mode option[value="semantic"]').isDisabled(),true);
    assert.equal(await page.locator('#filter-mode option[value="hybrid"]').isDisabled(),true);
    assert.equal(await page.locator('#filter-mode option[value="lexical"]').isDisabled(),false);
    assert.equal(await page.locator('#retrieval-results').textContent(),'');
    assert.deepEqual(await page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode!=='Catalogue')),[]);
    await mode.selectOption('lexical');await query.fill('hayneedle');
    await page.locator('#list-form button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#retrieval-results').textContent.includes('hayneedle'),null,{timeout:15000});
    assert.equal((await page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode==='Lexical'))).length,1);
  } else {
    await mode.selectOption('lexical');await query.fill('hayneedle');
    await page.locator('#filter-visibility').selectOption('external');
    await page.locator('#filter-kind').selectOption('dir');
    await page.locator('#filter-owner').fill('search-manager');
    assert.equal(await page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode!=='Catalogue').length),0,'draft never sends search');
    await page.locator('#list-form button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#retrieval-results').textContent.includes('hayneedle'),null,{timeout:15000});
    assert.equal(await page.locator('#retrieval-results img, #retrieval-results script').count(),0,'metadata evidence inert');
    assert.match(await page.locator('#retrieval-results').textContent(),/Name: .*hayneedle/);
    assert.match(await page.locator('#list-status').textContent(),/exact matches/);
    assert.equal(await page.locator('#load-more-button').isVisible(),false);
    const command=await page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode==='Lexical')[0]);
    assert.deepEqual(command.filter,{visibility:'External',kind:'Directory',createdByUser:'search-manager'});
    assert.ok(command.limit<=25 && command.limit>0);assert.equal(command.cursor,null);
    if(input.stage==='semantic'){
      const record=async selected=>{
        await mode.selectOption(selected);await page.locator('#list-form button[type=submit]').click();
        await page.waitForFunction((wanted)=>document.querySelector('#list-status').textContent.includes('candidate-window') &&
          window.__retrieval.commands.at(-1)?.mode===wanted,selected[0].toUpperCase()+selected.slice(1),{timeout:15000});
        assert.match(await page.locator('#list-status').textContent(),/not a corpus-wide total/);
        assert.match(await page.locator('#retrieval-results').textContent(),/hayneedle/);
      };
      await record('semantic');await record('hybrid');
      if(input.artifacts){
        await fs.mkdir(input.artifacts,{recursive:true});
        await page.screenshot({path:path.join(input.artifacts,'manure-retrieval-desktop.png'),fullPage:true});
        await page.setViewportSize({width:390,height:844});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await page.screenshot({path:path.join(input.artifacts,'manure-retrieval-mobile.png'),fullPage:true});
        await page.emulateMedia({colorScheme:'dark'});
        await page.screenshot({path:path.join(input.artifacts,'manure-retrieval-dark-mobile.png'),fullPage:true});
        await page.setViewportSize({width:1440,height:1000});
        await page.emulateMedia({colorScheme:'light'});
      }
      await page.locator('#retrieval-results [data-action=details]').first().click();
      await page.locator('#detail-section').waitFor({state:'visible',timeout:15000});
      assert.match(await page.locator('#detail-list').textContent(),/search-manager/);
      await page.locator('#detail-back-button').click();
      await page.locator('#dashboard-section').waitFor({state:'visible',timeout:15000});
      assert.equal(await page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode==='Hybrid').length),1,
        'back to pinned results must not call model again');
      await page.locator('#filter-text').fill('unsent new query');
      await page.locator('#clear-search-button').click();
      assert.equal(await page.locator('#filter-text').inputValue(),'');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'filter-text');
      await page.locator('#filter-text').fill('hayneedle');
      await page.locator('#filter-text').dispatchEvent('compositionstart');
      await page.locator('#filter-text').press('Enter');
      assert.equal(await page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode==='Hybrid').length),1,
        'composition Enter must not submit');
      await page.locator('#search-submit').dispatchEvent('pointerdown', { pointerType: 'mouse' });
      await page.locator('#filter-text').dispatchEvent('compositionend');
      await page.locator('#search-submit').evaluate(node=>node.click());
      assert.equal(await page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode==='Hybrid').length),1,
        'pointer Search begun during composition cannot submit after compositionend');
      await page.locator('#filter-text').dispatchEvent('compositionstart');
      await page.locator('#search-submit').dispatchEvent('pointerdown',{pointerType:'mouse'});
      await page.locator('#search-submit').dispatchEvent('pointercancel',{pointerType:'mouse'});
      await page.locator('#filter-text').dispatchEvent('compositionend');
      await page.locator('#filter-text').press('Enter');
      await page.waitForFunction(()=>window.__retrieval.commands.filter(c=>c.mode==='Hybrid').length===2,null,{timeout:10000});
      await page.locator('#filter-text').press('Escape');
      assert.equal(await page.locator('#filter-text').inputValue(),'');
      await page.keyboard.press('Control+k');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'filter-text');
      assert.equal(await page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode==='Hybrid').length),2);
    }
  }
  assert.deepEqual(failures,[]);
  assert.equal(requests.some(url=>url.includes(input.token)),false);
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).length+Object.keys(sessionStorage).length),0);
  process.stdout.write(JSON.stringify({stage:input.stage,requests:await page.evaluate(()=>window.__retrieval.commands.map(c=>c.mode))}));
}finally{await context.close();await browser.close();}
