// Optional: NODE_PATH=<playwright>/node_modules RVT_BROWSER=webkit RVT_BROWSER_PATH=<webkit launcher> node tests/memory-bgm-browser.cjs
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
(async()=>{
  const root=path.join(__dirname,'..'),server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(/^\/assets\/bgm\/[a-z-]+\.mp3$/.test(url.pathname)){
      const file=path.join(root,url.pathname);res.setHeader('Content-Type','audio/mpeg');res.end(fs.readFileSync(file));return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(root,'index.html')));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port,engine=process.env.RVT_BROWSER==='webkit'?webkit:chromium;
  let browser;
  try{
    browser=await engine.launch({executablePath:process.env.RVT_BROWSER_PATH||(process.platform==='darwin'&&engine===chromium?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true});
    for(const width of [380,1200]){
      const context=await browser.newContext({viewport:{width,height:840},isMobile:width<960,hasTouch:width<960});
      await context.addInitScript(()=>{if(!localStorage.getItem('rvt_v1'))localStorage.setItem('rvt_v1',JSON.stringify({settings:{autoSync:false,syncUrl:'https://sync.invalid',sound:false}}))});
      const page=await context.newPage(),errors=[],assets=[],apis=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin)){if(url.includes('/assets/bgm/'))assets.push(url);return route.continue()}if(url.includes('api.openai.com'))apis.push(url);return route.abort()});
      await page.goto(origin);await page.locator('[data-scr="scr-memory"]').click();await page.waitForFunction(()=>memoryState.ready);
      await page.evaluate(async()=>{memorySetEditorHTML('<div>読み上げ一行目</div><div>読み上げ二行目</div>');memoryChanged();await memorySave();});
      await page.locator('#memBgmButton').click();assert.equal(await page.locator('#memBgmPanel [data-bgm-track] option').count(),3);
      await page.locator('#memBgmPanel [data-bgm-toggle]').click();
      await page.waitForFunction(()=>!memoryState.bgm.loading);
      const decoded=await page.evaluate(()=>!!memoryState.bgm.source);
      if(!decoded)assert.equal(engine,webkit,'Chromium must decode and loop the bundled MP3');
      if(decoded){
        assert.equal(await page.evaluate(()=>memoryState.bgm.source.loop),true);assert((await page.evaluate(()=>memoryState.bgm.buffer.duration))>70);
        assert.equal(assets.length,1);
        await page.locator('#memEngine').selectOption('device');
        await page.evaluate(()=>{
          window.qaSpoken=[];window.qaTapStates=[];memoryPrefs.gap=2;
          Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{speaking:false,pending:false,paused:false,getVoices:()=>[],cancel(){this.speaking=false;this.pending=false},resume(){this.paused=false},speak(u){qaSpoken.push(u.text);qaTapStates.push(navigator.userActivation?.isActive);window.qaUtterance=u;this.speaking=true;u.onstart()}}});
        });
        await page.locator('#memPlay').click();assert.equal(await page.evaluate(()=>qaSpoken.length),1);
        assert.equal(await page.evaluate(()=>qaTapStates[0]),true,'TTS is still called during the trusted tap');
        assert.equal(await page.evaluate(()=>memoryState.bgm.ducked),true);assert.equal(await page.evaluate(()=>memoryState.bgm.source.loop),true);
        await page.waitForTimeout(300);assert((await page.evaluate(()=>memoryState.bgm.gain.gain.value))<.12);
        await page.evaluate(()=>{speechSynthesis.speaking=false;qaUtterance.onend()});assert.equal(await page.evaluate(()=>memoryState.bgm.ducked),false);
        await page.waitForTimeout(300);assert((await page.evaluate(()=>memoryState.bgm.gain.gain.value))>.16);
        await page.evaluate(()=>memoryStop());assert.equal(await page.evaluate(()=>memoryState.bgm.source),null);
        assert.equal(await page.evaluate(()=>memoryPrefs.bgmEnabled),true);
        await page.locator('#memBgmPanel [data-bgm-toggle]').click();await page.waitForFunction(()=>!!memoryState.bgm.source);assert.equal(assets.length,1,'restart reuses decoded music');
        await page.locator('#memBgmPanel [data-bgm-track]').selectOption('calm-loop');await page.waitForFunction(()=>memoryState.bgm.bufferTrack==='calm-loop'&&!!memoryState.bgm.source);
        assert.equal(assets.length,2);assert((await page.evaluate(()=>memoryState.bgm.buffer.duration))>19);
        await page.locator('#memBgmPanel [data-bgm-volume]').evaluate(el=>{el.value='.13';el.dispatchEvent(new Event('input',{bubbles:true}))});assert.equal(await page.evaluate(()=>memoryPrefs.bgmVolume),.13);
      }
      await page.locator('#memMode').click();assert.equal(await page.locator('#memStudyBgmPanel').isVisible(),true);
      assert.equal(await page.locator('#memBgmPanel').isVisible(),false);
      await page.locator('#memStudyGap').click();assert.equal(await page.locator('#memStudyBgmPanel').isVisible(),false);assert.equal(await page.locator('#memStudyGapPanel').isVisible(),true);
      await page.locator('#memStudyBgm').click();assert.equal(await page.locator('#memStudyGapPanel').isVisible(),false);
      const overflow=await page.evaluate(()=>[...document.querySelectorAll('#memStudyBgmPanel button,#memStudyBgmPanel select')].filter(el=>el.scrollWidth>el.clientWidth+2).map(el=>el.textContent));assert.deepEqual(overflow,[]);
      await page.locator('#memStudyBgmPanel').screenshot({path:'/private/tmp/rvt-memory-bgm-'+(process.env.RVT_BROWSER||'chromium')+'-'+width+'.png'});
      await page.evaluate(()=>memoryStop());const downloaded=assets.length;
      await page.reload();await page.locator('[data-scr="scr-memory"]').click();await page.waitForFunction(()=>memoryState.ready);
      assert.equal(await page.evaluate(()=>memoryState.bgm.requested),false);assert.equal(await page.evaluate(()=>memoryState.bgm.source),null);assert.equal(assets.length,downloaded,'reload never autoplays or downloads BGM');
      if(decoded){assert.equal(await page.evaluate(()=>memoryPrefs.bgmVolume),.13);assert.equal(await page.evaluate(()=>memoryPrefs.bgmTrack),'calm-loop');}
      assert.deepEqual(apis,[]);assert.deepEqual(errors,[]);
      console.log('PASS: '+(process.env.RVT_BROWSER||'chromium')+' '+width+'px BGM selection/license UI, real MP3 loop '+(decoded?'PASS':'SKIP (decoder unavailable)')+', TTS gesture/mixing/duck, restart/cache, track/volume controls, reader panels and no autoplay/API');
      await context.close();
    }
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
