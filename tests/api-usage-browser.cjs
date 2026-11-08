// NODE_PATH=<playwright>/node_modules [RVT_BROWSER=webkit RVT_BROWSER_PATH=<launcher>] node tests/api-usage-browser.cjs
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
(async()=>{
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(__dirname,'..','index.html')))});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port,engine=process.env.RVT_BROWSER==='webkit'?webkit:chromium;
  let browser;
  try{
    browser=await engine.launch({executablePath:process.env.RVT_BROWSER_PATH||(process.platform==='darwin'&&engine===chromium?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true});
    for(const width of [380,1200]){
      const context=await browser.newContext({viewport:{width,height:840},isMobile:width<960,hasTouch:width<960});
      await context.addInitScript(()=>{if(!localStorage.getItem('rvt_v1'))localStorage.setItem('rvt_v1',JSON.stringify({settings:{autoSync:false,syncUrl:'https://sync.invalid',sound:false}}))});
      const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>{
        const url=route.request().url();if(url.startsWith(origin))return route.continue();
        if(url.startsWith('https://api.openai.com/'))requests.push(url);
        if(url==='https://api.openai.com/v1/responses')return route.fulfill({contentType:'application/json',body:JSON.stringify({status:'completed',usage:{input_tokens:1000,input_tokens_details:{cached_tokens:200},output_tokens:300},output:[{type:'message',content:[{type:'output_text',text:'OK'}]}]})});
        if(url==='https://api.openai.com/v1/audio/speech')return route.fulfill({contentType:'application/octet-stream',body:Buffer.alloc(48000)});
        return route.abort();
      });
      await page.goto(origin);await page.locator('[data-scr="scr-set"]').first().click();
      assert.equal(await page.locator('#apiUsageTotal').innerText(),'約 $0.0000 USD');assert((await page.locator('#apiUsageNotice').innerText()).includes('まだありません'));
      await page.locator('#setApiKey').fill('synthetic-browser-key');await page.getByRole('button',{name:'🤖 保存して接続テスト',exact:true}).click();
      await page.waitForFunction(()=>document.getElementById('aiConnectionStatus').textContent.includes('接続成功'));
      assert.equal(await page.locator('#apiUsageTotal').innerText(),'約 $0.0046 USD');assert((await page.locator('#apiUsageBreakdown').innerText()).includes('1件'));
      await page.evaluate(()=>memoryGenerateClip('abc',{model:'tts-1',voice:'alloy'},getOpenAIKey(),new AbortController().signal));
      assert.equal(await page.locator('#apiUsageTotal').innerText(),'約 $0.0047 USD');assert((await page.locator('#apiUsageBreakdown').innerText()).includes('音声 $0.000045'));
      const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('rvt_v1')).apiUsage);
      assert.equal(stored.reduce((n,row)=>n+row.calls,0),2);assert(!JSON.stringify(stored).includes('synthetic-browser-key'));assert.equal(requests.length,2);
      // Add another month from a second device using the real merge, then merge it twice.
      await page.evaluate(()=>{
        const old={apiUsage:[{id:'synthetic-other-device:2026-01:audio',month:'2026-01',kind:'audio',nanoUsd:1250000000,calls:10,estimated:2,firstAt:1,updatedAt:2}],rewardPointEvents:[]};
        mergeMealCollections(old,D);mergeMealCollections(old,D);save();renderSet();
      });
      await page.locator('#apiUsageMonth').selectOption('2026-01');assert.equal(await page.locator('#apiUsageTotal').innerText(),'約 $1.2500 USD');
      assert((await page.locator('#apiUsageBreakdown').innerText()).includes('10件（うち2件は使用量を推定）'));
      const box=await page.locator('#apiUsagePanel').boundingBox();assert(box.x>=0&&box.x+box.width<=width+1);
      assert.equal(await page.locator('#apiUsagePanel').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
      await page.locator('#apiUsagePanel').screenshot({path:'/private/tmp/rvt-api-usage-'+(process.env.RVT_BROWSER||'chromium')+'-'+width+'.png'});
      await page.reload();await page.locator('[data-scr="scr-set"]').first().click();
      assert.equal(await page.locator('#apiUsageTotal').innerText(),'約 $0.0047 USD');assert.equal(requests.length,2,'rendering history never requests billing APIs');
      await page.locator('#apiUsageMonth').selectOption('2026-01');assert.equal(await page.locator('#apiUsageTotal').innerText(),'約 $1.2500 USD');
      assert.deepEqual(errors,[]);console.log('PASS: '+(process.env.RVT_BROWSER||'chromium')+' '+width+'px month selector, text/audio totals from actual call paths, tiny amounts, idempotent cross-device merge, persistence, private records, no extra network and layout');
      await context.close();
    }
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
