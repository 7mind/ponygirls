// Behavioral-Active / Effectual-GoodCommunication: real Chromium/current API,
// owned PostgreSQL, controlled model only; no content bytes or external provider.
import assert from 'node:assert/strict';
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
  await page.locator('[data-account-login] input[name=login]').fill(input.login);
  await page.locator('[data-account-login] input[name=password]').fill(input.loginPassword);
  await page.locator('[data-account-login] button[type=submit]').click();
  await page.locator('#whoami-text').waitFor({state:'visible',timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#list-status').textContent.includes('loaded'),null,{timeout:15000});
  const query=page.locator('#filter-text');
  assert.equal(await query.inputValue(),'');
  const retrievalModes=()=>page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode!=='Catalogue').map(c=>c.mode));
  // Search text without mode: (C2); the status line names the mode that answered.
  const searchText=async(text,mode)=>{
    await query.fill(text);
    assert.equal(await page.locator('#query-diagnostic').isHidden(),true,'search text without mode: is never refused');
    await page.locator('#list-form button[type=submit]').click();
    await page.waitForFunction(([wanted,applied])=>new URLSearchParams(location.hash.split('?')[1]).get('query')===applied &&
      document.querySelector('#catalogue-table').getAttribute('aria-busy')==='false' &&
      document.querySelector('#list-status').textContent.endsWith(' hits · '+wanted) &&
      document.querySelector('#retrieval-results').textContent.includes('hayneedle'),[mode,text],{timeout:15000});
  };
  const noticeText=()=>page.locator('#list-notice').isVisible().then(visible=>visible ? page.locator('#list-notice-text').textContent() : null);
  if(input.stage==='outage'){
    await query.fill('mode:hybrid hayneedle');
    await page.locator('#list-form button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#list-notice').textContent.includes('search-unavailable'),null,{timeout:15000});
    assert.equal(await page.locator('#retrieval-results').textContent(),'');
    assert.match(await page.locator('#list-notice-text').textContent(),/\(search-unavailable: query embedding failed\)/,'an explicit mode is refused with the server reason');
    assert.deepEqual(await page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode!=='Catalogue').map(c=>c.mode)),['Hybrid'],
      'hybrid failure must not fall back to lexical');
    await query.fill('mode:lexical hayneedle');
    await page.locator('#list-form button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#retrieval-results').textContent.includes('hayneedle'),null,{timeout:15000});
    assert.deepEqual(await retrievalModes(),['Hybrid','Lexical']);
    await searchText('hayneedle','lexical');
    assert.deepEqual(await retrievalModes(),['Hybrid','Lexical','Hybrid','Lexical'],'a defaulted hybrid is re-run once lexically');
    assert.equal(await noticeText(),'Hybrid search is not available on this server: query embedding failed; showing lexical results');
  } else if(input.stage==='pending'){
    await searchText('access:external hayneedle','hybrid');
    assert.equal(await noticeText(),null,'no unindexed item in the scope of access:external');
    await searchText('hayneedle','hybrid');
    assert.deepEqual(await retrievalModes(),['Hybrid','Hybrid']);
    assert.equal(await noticeText(),'1 item is not yet indexed for semantic search; results may be incomplete');
  } else if(input.stage==='no-provider'){
    await page.goto(input.base+'/#/artifacts?mode=semantic&q=hayneedle',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#list-notice').textContent.includes('unavailable'),null,{timeout:15000});
    assert.equal(await query.inputValue(),'mode:semantic hayneedle');
    assert.match(await page.locator('#query-diagnostic').textContent(),/unavailable/);
    assert.equal(await page.locator('#retrieval-results').textContent(),'');
    assert.deepEqual(await page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode!=='Catalogue')),[]);
    await query.fill('mode:lexical hayneedle');
    await page.locator('#list-form button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#retrieval-results').textContent.includes('hayneedle'),null,{timeout:15000});
    assert.equal((await page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode==='Lexical'))).length,1);
    await searchText('hayneedle','lexical');
    assert.deepEqual(await retrievalModes(),['Lexical','Lexical'],'capabilities without hybrid: lexical, never a hybrid request');
    assert.equal(await noticeText(),'Hybrid search is not available on this server: semantic retrieval is not configured; showing lexical results');
  } else {
    await query.fill('mode:lexical access:external kind:dir owner:search-manager hayneedle');
    assert.equal(await page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode!=='Catalogue').length),0,'draft never sends search');
    await page.locator('#list-form button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#retrieval-results').textContent.includes('hayneedle'),null,{timeout:15000});
    assert.equal(await page.locator('#retrieval-results img, #retrieval-results script').count(),0,'metadata evidence inert');
    assert.match(await page.locator('#retrieval-results').textContent(),/Name: .*hayneedle/);
    assert.match(await page.locator('#sort-summary').textContent(),/exact matches/);
    assert.equal(await page.getByRole('button',{name:/Load more/}).count(),0);
    const command=await page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode==='Lexical')[0]);
    assert.deepEqual(command.filter,{visibility:'External',kind:'Directory',createdByUser:'search-manager',tags:[],hostname:null,projectPath:null});
    assert.ok(command.limit<=25 && command.limit>0);assert.equal(command.cursor,null);
    if(input.stage==='semantic'){
      const record=async selected=>{
        await query.fill('mode:'+selected+' access:external kind:dir owner:search-manager hayneedle');await page.locator('#list-form button[type=submit]').click();
        await page.waitForFunction((wanted)=>document.querySelector('#sort-summary').textContent.includes('candidate-window') &&
          window.__retrieval.commands.at(-1)?.mode===wanted,selected[0].toUpperCase()+selected.slice(1),{timeout:15000});
        assert.match(await page.locator('#sort-summary').textContent(),/not a corpus-wide total/);
        assert.match(await page.locator('#retrieval-results').textContent(),/hayneedle/);
      };
      await record('semantic');await record('hybrid');
      await page.locator('#retrieval-results [data-action=details]').first().click();
      await page.locator('#detail-section').waitFor({state:'visible',timeout:15000});
      await page.waitForFunction(()=>/search-manager/.test(document.querySelector('#detail-list').textContent),null,{timeout:15000});
      await page.locator('#detail-back-button').click();
      await page.locator('#dashboard-section').waitFor({state:'visible',timeout:15000});
      assert.equal(await page.evaluate(()=>window.__retrieval.commands.filter(c=>c.mode==='Hybrid').length),1,
        'back to pinned results must not call model again');
      await page.locator('#filter-text').fill('unsent new query');
      await page.locator('#clear-search-button').click();
      assert.equal(await page.locator('#filter-text').inputValue(),'');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'filter-text');
      await page.locator('#filter-text').fill('mode:hybrid access:external kind:dir owner:search-manager hayneedle');
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
