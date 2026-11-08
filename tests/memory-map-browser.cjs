// Optional: NODE_PATH=<playwright>/node_modules RVT_BROWSER=webkit RVT_BROWSER_PATH=<webkit launcher> node tests/memory-map-browser.cjs
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
(async()=>{
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(__dirname,'..','index.html')))});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port,engine=process.env.RVT_BROWSER==='webkit'?webkit:chromium;
  let browser;
  try{
    browser=await engine.launch({executablePath:process.env.RVT_BROWSER_PATH||(process.platform==='darwin'&&engine===chromium?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true});
    const context=await browser.newContext({viewport:{width:380,height:840},isMobile:true,hasTouch:true});
    await context.addInitScript(()=>{if(!localStorage.getItem('rvt_v1'))localStorage.setItem('rvt_v1',JSON.stringify({settings:{autoSync:false,syncUrl:'https://sync.invalid',sound:false}}))});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    await page.goto(origin);await page.locator('[data-scr="scr-memory"]').click();
    await page.waitForFunction(()=>memoryState.ready&&!document.getElementById('memShell').inert);
    await page.evaluate(async()=>{
      setOpenAIKey('synthetic-map-key');window.qaRequests=[];window.qaWait=false;
      window.qaOriginal='<div>日本の首都は<span class="mem-mark" data-color="red" data-checked="true">東京</span>。<span class="mem-mark" data-color="green" data-checked="true">大阪</span>も都市です。</div><div>用語と用語を覚える</div><div>🧠 定義を確認<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" alt="図"></div>';
      memorySetEditorHTML(qaOriginal);memoryChanged();await memorySave();
      window.qaBefore=memoryEditorHTML();window.qaTextBefore=memoryAudioPlan(memoryEditorHTML()).text;
      window.qaIdsBefore=await Promise.all(memoryAudioPlan(memoryEditorHTML()).segments.map(s=>memoryClipId(s,memoryPrefs)));
      window.qaReply={selections:[{line:1,text:'首都',occurrence:1},{line:1,text:'東京',occurrence:1},{line:1,text:'大阪',occurrence:1},{line:2,text:'用語',occurrence:2},{line:3,text:'🧠 定義',occurrence:1},{line:900,text:'存在しない',occurrence:1},{line:2,text:'<img onerror=alert(1)>',occurrence:1}]};
      const originalFetch=window.fetch;
      window.fetch=async(url,options)=>{
        if(url!=='https://api.openai.com/v1/responses')return originalFetch(url,options);
        const body=JSON.parse(options.body);qaRequests.push(body);
        let reply=qaReply==='auto'?{selections:JSON.parse(body.input).lines.map(row=>({line:row.line,text:row.text.slice(0,3),occurrence:1}))}:qaReply;
        if(qaWait)await new Promise((resolve,reject)=>{window.qaRelease=resolve;options.signal.addEventListener('abort',()=>reject(new DOMException('中止','AbortError')),{once:true})});
        return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(reply)}]}]}),{status:200,headers:{'Content-Type':'application/json'}});
      };
    });
    await page.locator('#memAutoMark').click();await page.waitForFunction(()=>!memoryState.autoMark);
    assert.equal(await page.locator('#memAutoMarkUndo').isVisible(),true);
    assert.equal(await page.locator('#memEditor .mem-mark').count(),5);
    assert.equal(await page.locator('#memEditor [data-color="green"][data-checked="true"]').innerText(),'大阪');
    assert.equal(await page.locator('#memEditor [data-color="red"][data-checked="true"]').innerText(),'東京');
    assert.equal(await page.locator('#memEditor .mem-block').nth(1).innerHTML(), '用語と<span class="mem-mark" data-color="red" data-checked="false">用語</span>を覚える');
    assert.equal(await page.locator('#memEditor img').count(),1);
    assert.equal(await page.evaluate(()=>memoryAudioPlan(memoryEditorHTML()).text===qaTextBefore),true);
    assert.equal(await page.evaluate(async()=>JSON.stringify(await Promise.all(memoryAudioPlan(memoryEditorHTML()).segments.map(s=>memoryClipId(s,memoryPrefs))))===JSON.stringify(qaIdsBefore)),true,'marks do not alter cached voice identity');
    const request=await page.evaluate(()=>qaRequests[0]);
    assert.equal(request.model,'gpt-6.1-sol');assert.equal(request.store,false);assert.equal(request.text.format.type,'json_schema');assert.equal(request.text.format.strict,true);
    assert(!request.input.includes('data:image/'),'only text, not image data, is sent');
    assert.equal(await page.evaluate(async()=>(await memoryStore('notes','get',memoryState.note.id)).html===memoryEditorHTML()),true);
    await page.locator('#memAutoMarkUndo').click();await page.waitForFunction(()=>!memoryState.autoMarkUndo);
    assert.equal(await page.evaluate(()=>memoryEditorHTML()===qaBefore),true);
    // In-flight results cannot overwrite typing/reordering, or trigger duplicate requests.
    await page.evaluate(()=>{qaWait=true});await page.locator('#memAutoMark').click();await page.waitForFunction(()=>qaRequests.length===2);
    await page.evaluate(()=>memoryAutoMark());assert.equal(await page.evaluate(()=>qaRequests.length),2);
    await page.evaluate(()=>{memorySetEditorHTML('<div>手動で変更した本文</div>');memoryChanged();qaRelease()});
    await page.waitForFunction(()=>!memoryState.autoMark);assert.equal(await page.locator('#memEditor').innerText(),'手動で変更した本文');
    assert((await page.locator('#memAutoMarkStatus').innerText()).includes('変わった'));
    // Explicit cancellation never applies a partial map.
    await page.locator('#memAutoMark').click();await page.waitForFunction(()=>qaRequests.length===3);await page.locator('#memAutoMarkCancel').click();
    await page.waitForFunction(()=>!memoryState.autoMark);assert((await page.locator('#memAutoMarkStatus').innerText()).includes('中止'));
    assert.equal(await page.locator('#memEditor .mem-mark').count(),0);
    // Switching notes aborts the old request and leaves the new note untouched.
    await page.locator('#memAutoMark').click();await page.waitForFunction(()=>qaRequests.length===4);await page.evaluate(()=>memoryNew());
    await page.waitForFunction(()=>!memoryState.autoMark);assert.equal((await page.locator('#memEditor').innerText()).trim(),'');
    // Batches retain global line numbers and apply atomically after every response.
    await page.evaluate(()=>{qaWait=false;qaReply='auto';memorySetEditorHTML(Array.from({length:41},(_,i)=>'<div>用語'+i+'の説明</div>').join(''));memoryChanged()});
    await page.locator('#memAutoMark').click();await page.waitForFunction(()=>!memoryState.autoMark);
    assert.equal(await page.locator('#memEditor .mem-mark').count(),41);assert.equal(await page.evaluate(()=>qaRequests.length),6);
    assert.equal(await page.evaluate(()=>JSON.parse(qaRequests[5].input).lines[0].line),41);
    const overflow=await page.evaluate(()=>[...document.querySelectorAll('#memTools button')].filter(el=>!el.hidden&&el.scrollWidth>el.clientWidth+2).map(el=>el.id||el.textContent));
    assert.deepEqual(overflow,[]);
    await page.locator('#memTools').screenshot({path:'/private/tmp/rvt-memory-map-'+(process.env.RVT_BROWSER||'chromium')+'-380.png'});
    // Undo is invalidated by later edits; it cannot discard new text.
    await page.evaluate(()=>{memorySetEditorHTML('<div>後から書いた本文</div>');memoryChanged()});await page.evaluate(()=>memoryUndoAutoMark());
    assert.equal(await page.locator('#memEditor').innerText(),'後から書いた本文');assert.equal(await page.locator('#memAutoMarkUndo').isVisible(),false);
    await page.evaluate(()=>setOpenAIKey(''));await page.locator('#memAutoMark').click();assert.equal(await page.evaluate(()=>qaRequests.length),6);
    assert((await page.locator('#memAutoMarkStatus').innerText()).includes('キー'));
    assert.deepEqual(errors,[]);
    console.log('PASS: '+(process.env.RVT_BROWSER||'chromium')+' auto map, Sol schema, exact quotes/repeated occurrences, existing marks/checks/images/text/audio identity, undo/save, edit/switch/cancel races, duplicate clicks, global batch lines and 380px controls');
    await context.close();
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
