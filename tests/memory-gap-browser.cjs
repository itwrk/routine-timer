// Optional: NODE_PATH=<playwright>/node_modules RVT_BROWSER=webkit RVT_BROWSER_PATH=<webkit launcher> node tests/memory-gap-browser.cjs
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
      const page=await context.newPage(),errors=[],apiRequests=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();if(route.request().url().includes('api.openai.com'))apiRequests.push(route.request().url());return route.abort()});
      await page.goto(origin);await page.locator('[data-scr="scr-memory"]').click();await page.waitForFunction(()=>memoryState.ready);
      await page.evaluate(async()=>{
        memorySetEditorHTML('<div>一行目</div><div>二行目</div>');memoryChanged();await memorySave();
        const bytes=new Uint8Array(24000*2*2),view=new DataView(bytes.buffer);for(let i=0;i<48000;i++)view.setInt16(i*2,Math.round(Math.sin(i/12)*5000),true);
        window.qaClip=new Blob([bytes]);window.qaGenerations=0;
        memoryResolveLineClip=async()=>({clip:{pcm:qaClip},reused:true});memoryGenerateClip=async()=>{qaGenerations++;throw Error('pause controls must not generate audio')};
        await memoryPrepareAudio();
      });
      assert.equal(await page.locator('#memSettings').getAttribute('open'),null);
      await page.locator('#memGapButton').click();assert.equal(await page.locator('#memGapPanel').isVisible(),true);
      assert.equal(await page.locator('#memGapButton').getAttribute('aria-expanded'),'true');
      await page.locator('#memGapPanel [data-gap-preset="3"]').click();
      await page.waitForFunction(()=>memoryState.prepared?.plan.prefs.gap===3&&memoryState.echoRestore===null);
      assert.equal(await page.locator('#memGapButton').innerText(),'無音 3秒');assert.equal(await page.locator('#memGap').inputValue(),'3');
      assert.equal(await page.evaluate(()=>memoryState.prepared.blob.size),44+48000*7);
      await page.locator('#memGapPanel [aria-label="無音時間を0.5秒長くする"]').click();await page.waitForFunction(()=>memoryState.prepared?.plan.prefs.gap===3.5);
      await page.locator('#memGapPanel [aria-label="無音時間を0.5秒短くする"]').click();await page.waitForFunction(()=>memoryState.prepared?.plan.prefs.gap===3);
      await page.locator('#memGapPanel input').fill('1.2');await page.locator('#memGapPanel input').press('Tab');await page.waitForFunction(()=>memoryState.prepared?.plan.prefs.gap===1.2);
      await page.locator('#memGapPanel input').fill('61');await page.locator('#memGapPanel input').press('Tab');assert.equal(await page.evaluate(()=>memoryPrefs.gap),1.2);
      assert.equal(await page.locator('#memGapPanel input').inputValue(),'1.2');
      await page.evaluate(()=>memorySetGap(60));await page.locator('#memGapPanel [aria-label="無音時間を0.5秒長くする"]').click();assert.equal(await page.evaluate(()=>memoryPrefs.gap),60);
      await page.locator('#memGapPanel [data-gap-preset="0"]').click();await page.waitForFunction(()=>memoryState.prepared?.plan.prefs.gap===0);
      assert.equal(await page.locator('#memGapPanel [data-gap-preset="0"]').getAttribute('aria-pressed'),'true');
      await page.evaluate(()=>memorySetGap(1));await page.locator('#memPlay').click();
      const nativePlayback=await page.waitForFunction(()=>!document.getElementById('memAudio').paused,{},{timeout:3000}).then(()=>true,()=>false);
      if(nativePlayback){
        await page.waitForFunction(()=>document.getElementById('memAudio').readyState>=1);
        await page.evaluate(()=>document.getElementById('memAudio').currentTime=3.2);await page.waitForFunction(()=>!document.getElementById('memAudio').seeking);
        await page.locator('#memGapPanel [data-gap-preset="5"]').click();
        await page.waitForFunction(()=>memoryState.prepared?.plan.prefs.gap===5&&memoryState.echoRestore===null&&!document.getElementById('memAudio').paused&&!document.getElementById('memAudio').seeking);
        const position=await page.locator('#memAudio').evaluate(a=>a.currentTime);assert(position>=7.15&&position<8.7,'growing a prior gap must retain the same word in line two');
      }else assert.equal(engine,webkit,'Chromium must pass native playback');
      await page.evaluate(()=>memoryStop());
      await page.locator('#memMode').click();assert.equal(await page.locator('#memGapPanel').isVisible(),false);
      assert.equal(await page.locator('#memStudyGapPanel').isVisible(),true);
      await page.locator('#memStudyGapPanel [data-gap-preset="2"]').click();await page.waitForFunction(()=>memoryState.prepared?.plan.prefs.gap===2);
      assert.equal(await page.locator('#memStudyGap').innerText(),'無音 2秒');
      const overflow=await page.evaluate(()=>[...document.querySelectorAll('#memStudyGapPanel button,#memStudyGapPanel input')].filter(el=>el.scrollWidth>el.clientWidth+2).map(el=>el.textContent));assert.deepEqual(overflow,[]);
      assert((await page.locator('#memStage').evaluate(el=>el.clientHeight))>100);
      await page.locator('#memStudyGapPanel').screenshot({path:'/private/tmp/rvt-memory-gap-'+(process.env.RVT_BROWSER||'chromium')+'-'+width+'.png'});
      await page.locator('#memStudyGapPanel input').press('Escape');assert.equal(await page.locator('#memStudyGapPanel').isVisible(),false);
      assert.equal(await page.evaluate(()=>document.activeElement.id),'memStudyGap');
      // Free TTS keeps the current utterance and applies the new delay at the next boundary.
      await page.evaluate(()=>{
        memoryPrefs.engine='device';memoryPrefs.gap=0;memoryPrefs.loop='off';memoryRenderControls();
        window.qaSpoken=[];window.qaCancelled=0;
        Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],cancel(){qaCancelled++},speak(u){qaSpoken.push(u.text);window.qaUtterance=u}}});
        memoryPlayTTS();
      });
      assert.deepEqual(await page.evaluate(()=>qaSpoken),['一行目']);
      const cancelled=await page.evaluate(()=>qaCancelled);await page.evaluate(()=>memorySetGap(.1));assert.equal(await page.evaluate(()=>qaCancelled),cancelled);
      await page.evaluate(()=>qaUtterance.onend());await page.waitForFunction(()=>qaSpoken.length===2);assert.deepEqual(await page.evaluate(()=>qaSpoken),['一行目','二行目']);
      assert.equal(await page.evaluate(()=>qaGenerations),0);await page.evaluate(()=>memoryStop());
      await page.reload();await page.locator('[data-scr="scr-memory"]').click();await page.waitForFunction(()=>memoryState.ready);
      assert.equal(await page.locator('#memGapButton').innerText(),'無音 0.1秒');assert.equal(await page.locator('#memGap').inputValue(),'0.1');
      assert.deepEqual(apiRequests,[]);assert.deepEqual(errors,[]);
      console.log('PASS: '+(process.env.RVT_BROWSER||'chromium')+' '+width+'px independent gap controls, presets/custom/bounds, reader layout/keyboard, saved seconds, TTS live gap, no API; native word preservation '+(nativePlayback?'PASS':'SKIP (baseline unavailable)'));
      await context.close();
    }
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
