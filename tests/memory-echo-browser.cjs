// Optional: NODE_PATH=<playwright>/node_modules RVT_BROWSER=webkit RVT_BROWSER_PATH=<webkit launcher> node tests/memory-echo-browser.cjs
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
      page.setDefaultTimeout(12000);
      const wait=async(fn)=>{try{await page.waitForFunction(fn,{},{timeout:12000})}catch(e){console.error(await page.evaluate(()=>({echo:memoryPrefs.echo,playing:memoryState.playing,prepared:memoryState.prepared?.plan.prefs.echo,pending:memoryState.echoRestore&&{playing:memoryState.echoRestore.playing,position:memoryState.echoRestore.position},audio:{paused:document.getElementById('memAudio').paused,ready:document.getElementById('memAudio').readyState,time:document.getElementById('memAudio').currentTime,error:document.getElementById('memAudio').error?.message},status:document.getElementById('memStatus').textContent})));throw e;}};
      await page.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();if(route.request().url().includes('api.openai.com'))apiRequests.push(route.request().url());return route.abort()});
      await page.goto(origin);await page.locator('[data-scr="scr-memory"]').click();await page.waitForFunction(()=>memoryState.ready);
      await page.evaluate(async()=>{
        memorySetEditorHTML('<div>エコーの再生確認</div>');memoryChanged();await memorySave();
        window.qaPcm=new Uint8Array(24000*6*2);const view=new DataView(qaPcm.buffer);
        for(let i=0;i<24000*6;i++)view.setInt16(i*2,Math.round(Math.sin(i/24)*8000),true);
        window.qaOriginalClip=new Blob([qaPcm]);window.qaGenerated=0;
        // IndexedDB note persistence remains real; a fixed synthetic original clip isolates playback from API/Blob-store availability.
        memoryResolveLineClip=async()=>({clip:{pcm:qaOriginalClip},reused:true});
        memoryGenerateClip=async()=>{qaGenerated++;throw Error('echo must never generate another voice')};
        await memoryPrepareAudio();
      });
      assert.equal(await page.locator('#memEcho').getAttribute('aria-pressed'),'false');
      assert.equal(await page.evaluate(()=>memoryState.prepared.blob.size),44+24000*6*2);
      await page.locator('#memPlay').click();
      const nativePlayback=await page.waitForFunction(()=>!document.getElementById('memAudio').paused,{},{timeout:3000}).then(()=>true,()=>false);
      if(!nativePlayback&&engine===webkit){
        // This bundled WebKit can lack native WAV playback even for the unchanged dry baseline.
        // Keep real DOM/PCM/preference coverage; native transport is tested in Chromium above.
        const code=await page.locator('#memAudio').evaluate(a=>a.error?.code);
        await page.evaluate(()=>memoryStop());await page.locator('#memEcho').click();
        await wait(()=>memoryState.prepared?.plan.prefs.echo&&memoryState.echoRestore===null);
        assert.equal(await page.locator('#memStudyEcho').getAttribute('aria-pressed'),'true');
        assert.equal(await page.evaluate(async()=>{const blob=memoryState.prepared.blob,v=new DataView(await blob.arrayBuffer());return v.getUint32(40,true)===blob.size-44&&blob.size>qaOriginalClip.size+44}),true);
        await page.locator('#memSettings').evaluate(el=>el.open=true);
        await page.locator('#memEchoAmount').evaluate(el=>{el.value='.55';el.dispatchEvent(new Event('change',{bubbles:true}))});
        await wait(()=>memoryState.prepared?.plan.prefs.echoAmount===.55&&memoryState.echoRestore===null);
        assert.equal(await page.evaluate(()=>qaGenerated),0);
        assert.equal(await page.evaluate(async()=>new Uint8Array(await qaOriginalClip.arrayBuffer()).every((v,i)=>v===qaPcm[i])),true);
        await page.locator('.mem-player').screenshot({path:'/private/tmp/rvt-memory-echo-webkit-'+width+'.png'});
        await page.reload();await page.locator('[data-scr="scr-memory"]').click();await page.waitForFunction(()=>memoryState.ready);
        assert.equal(await page.locator('#memEcho').getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>memoryPrefs.echoAmount),.55);
        await page.locator('#memEngine').selectOption('device');assert.equal(await page.locator('#memEcho').isDisabled(),true);
        assert.deepEqual(apiRequests,[]);assert.deepEqual(errors,[]);
        console.log('PASS: webkit '+width+'px echo controls, PCM/WAV header, persisted settings, TTS boundary, no API; SKIP native media (dry baseline unavailable, code '+code+')');
        await context.close();continue;
      }
      if(!nativePlayback)await wait(()=>!document.getElementById('memAudio').paused);
      await page.evaluate(()=>memoryStop());
      await page.locator('#memEcho').click();await wait(()=>memoryState.prepared?.plan.prefs.echo&&memoryState.echoRestore===null);
      assert.equal(await page.locator('#memStudyEcho').getAttribute('aria-pressed'),'true');
      assert.equal(await page.evaluate(()=>memoryState.prepared.blob.size),44+(24000*6+5280*3)*2);
      assert.equal(await page.evaluate(async()=>{const a=new Uint8Array(await qaOriginalClip.arrayBuffer());return a.every((v,i)=>v===qaPcm[i])}),true);
      await page.locator('#memPlay').click();await wait(()=>!document.getElementById('memAudio').paused);
      await page.evaluate(()=>{document.getElementById('memAudio').currentTime=1.5});
      await page.locator('#memEcho').click();await wait(()=>memoryState.prepared&&!memoryState.prepared.plan.prefs.echo&&memoryState.echoRestore===null&&!document.getElementById('memAudio').paused&&!document.getElementById('memAudio').seeking);
      const resumed=await page.locator('#memAudio').evaluate(a=>a.currentTime);assert(resumed>=1.45&&resumed<2.5,'echo toggles resume near the current word');
      await page.locator('#memEcho').click();await wait(()=>memoryState.prepared?.plan.prefs.echo&&memoryState.echoRestore===null&&!document.getElementById('memAudio').paused);
      await page.locator('#memSettings').evaluate(el=>el.open=true);
      await page.locator('#memEchoAmount').evaluate(el=>{el.value='.55';el.dispatchEvent(new Event('change',{bubbles:true}))});
      await wait(()=>memoryState.prepared?.plan.prefs.echoAmount===.55&&memoryState.echoRestore===null&&!document.getElementById('memAudio').paused);
      assert.equal(await page.locator('#memEchoAmountLabel').innerText(),'55%');
      assert.equal(await page.evaluate(()=>qaGenerated),0);
      // A pending rebuild must not resurrect playback after the user presses Stop.
      await page.evaluate(()=>{
        window.qaPlaybackWave=memoryPlaybackWave;window.qaHold=true;
        memoryPlaybackWave=async(...args)=>{if(qaHold){qaHold=false;await new Promise(resolve=>window.qaRelease=resolve)}return qaPlaybackWave(...args)};
        window.qaEchoJob=memoryToggleEcho();
      });
      await page.waitForFunction(()=>!!window.qaRelease);await page.evaluate(()=>memoryStop());await page.evaluate(()=>qaRelease());
      await page.evaluate(()=>qaEchoJob);assert.equal(await page.locator('#memAudio').evaluate(a=>a.paused),true);
      assert.equal(await page.evaluate(()=>memoryState.echoRestore),null);
      // Rapid ON/OFF changes finish with the latest WAV and preserve the original position.
      await page.evaluate(()=>{memoryPlaybackWave=qaPlaybackWave});await page.locator('#memPlay').click();
      await page.waitForFunction(()=>!document.getElementById('memAudio').paused);await page.evaluate(()=>document.getElementById('memAudio').currentTime=1);
      await page.evaluate(()=>{
        qaHold=true;window.qaRelease=null;
        memoryPlaybackWave=async(...args)=>{if(qaHold){qaHold=false;await new Promise(resolve=>window.qaRelease=resolve)}return qaPlaybackWave(...args)};
        window.qaFirst=memoryToggleEcho();
      });
      await page.waitForFunction(()=>!!qaRelease);await page.evaluate(()=>memoryToggleEcho());await page.evaluate(()=>qaRelease());await page.evaluate(()=>qaFirst);
      await wait(()=>memoryState.prepared&&!memoryState.prepared.plan.prefs.echo&&memoryState.echoRestore===null&&!document.getElementById('memAudio').paused&&!document.getElementById('memAudio').seeking);
      assert((await page.locator('#memAudio').evaluate(a=>a.currentTime))>=.95);
      await page.evaluate(()=>{memoryPlaybackWave=qaPlaybackWave});await page.locator('#memEcho').click();
      await page.waitForFunction(()=>memoryState.prepared?.plan.prefs.echo&&!document.getElementById('memAudio').paused);
      const url=await page.locator('#memAudio').getAttribute('src');
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
      assert.equal(await page.locator('#memAudio').evaluate(a=>a.paused),false);assert.equal(await page.locator('#memAudio').getAttribute('src'),url);
      await page.locator('.mem-player').screenshot({path:'/private/tmp/rvt-memory-echo-'+(process.env.RVT_BROWSER||'chromium')+'-'+width+'.png'});
      assert.equal(await page.evaluate(()=>document.getElementById('memEcho').scrollWidth<=document.getElementById('memEcho').clientWidth+2),true);
      // Saved preferences survive reload; TTS clearly disables the unsupported effect controls.
      await page.evaluate(()=>memoryStop());await page.reload();await page.locator('[data-scr="scr-memory"]').click();await page.waitForFunction(()=>memoryState.ready);
      assert.equal(await page.locator('#memEcho').getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>memoryPrefs.echoAmount),.55);
      await page.locator('#memEngine').selectOption('device');assert.equal(await page.locator('#memEcho').isDisabled(),true);assert.equal(await page.locator('#memEchoAmount').isDisabled(),true);
      assert.deepEqual(apiRequests,[]);assert.deepEqual(errors,[]);
      console.log('PASS: '+(process.env.RVT_BROWSER||'chromium')+' '+width+'px echo UI, actual native WAV playback, position/resume, strength, stop/rapid-change races, visibility, preferences, TTS boundary, unchanged original and no API calls');
      await context.close();
    }
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
