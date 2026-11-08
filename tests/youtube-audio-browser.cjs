// Optional: NODE_PATH=<playwright>/node_modules node tests/youtube-audio-browser.cjs
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
(async()=>{
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(__dirname,'..','index.html')))});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port,engine=process.env.RVT_BROWSER==='webkit'?webkit:chromium;
  const executablePath=process.env.RVT_BROWSER_PATH||(process.platform==='darwin'&&engine===chromium?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
  let browser;
  try{
    browser=await engine.launch({executablePath,headless:true});
    for(const width of [380,1200]){
      const context=await browser.newContext({viewport:{width,height:840},isMobile:width<960,hasTouch:width<960});
      await context.addInitScript(()=>{
        if(!localStorage.getItem('rvt_v1'))localStorage.setItem('rvt_v1',JSON.stringify({routines:[{id:'qa',name:'確認用ルーチン',emoji:'🌅',steps:[{id:'step-a',name:'水を飲む',sec:600,texts:['一歩進めた！']},{id:'step-b',name:'歯みがき',sec:180,texts:[]}]}],hitokoto:[],settings:{autoSync:false,syncUrl:'https://sync.invalid',sound:false,calLog:'off',moti:true}}));
      });
      const page=await context.newPage(),errors=[],requests=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();requests.push(route.request().url());return route.abort()});
      await page.goto(origin);await page.locator('[data-scr="scr-set"]').click();
      assert.equal(await page.locator('#setYouTubeAudio').isChecked(),false);assert.equal(await page.locator('#youTubeAudioTools').isVisible(),false);
      await page.evaluate(()=>{
        window.qaGenerateCount=0;window.qaSpeechCount=0;
        getOpenAIKey=()=> 'synthetic-key';
        memoryGenerateClip=async()=>{
          qaGenerateCount++;
          const samples=new Int16Array(24000);for(let i=0;i<samples.length;i++)samples[i]=Math.round(Math.sin(i/12)*1200);
          return new Blob([samples]);
        };
        Object.defineProperty(speechSynthesis,'speak',{value:()=>{qaSpeechCount++;throw Error('unexpected device TTS')},configurable:true});
      });
      await page.locator('#setYouTubeAudio').check();
      await page.waitForFunction(()=>document.getElementById('youTubeAudioStatus').textContent.includes('未保存'));
      assert.equal(await page.locator('#youTubeAudioRoutine').inputValue(),'qa');
      assert((await page.locator('#youTubeAudioTools').innerText()).includes('生成料金が発生'));
      await page.locator('#youTubeAudioPrepare').click();
      try{await page.waitForFunction(()=>!timerVoiceState.generation&&document.getElementById('youTubeAudioStatus').textContent.includes('音声を保存しました'),{},{timeout:10000});}
      catch(e){console.error(await page.evaluate(()=>({status:document.getElementById('youTubeAudioStatus').textContent,generating:!!timerVoiceState.generation,generated:qaGenerateCount,hasKey:!!getOpenAIKey()})));throw e;}
      const generated=await page.evaluate(()=>qaGenerateCount);assert(generated>20);
      // Persisted PCM plays through the real Web Audio graph, without a device voice or media element.
      await page.getByRole('button',{name:'🔊 テスト再生',exact:true}).click();
      try{await page.waitForFunction(()=>!!timerVoiceState.source,{},{timeout:10000});}
      catch(e){console.error(await page.evaluate(()=>({audioState:AC?.state,pending:timerVoiceState.pending,status:document.getElementById('youTubeAudioStatus').textContent})));throw e;}
      assert.equal(await page.evaluate(()=>AC.state),'running');
      assert.equal(await page.evaluate(()=>qaSpeechCount),0);await page.evaluate(()=>stopSpeech());
      await page.evaluate(()=>prepareYouTubeAudio());assert.equal(await page.evaluate(()=>qaGenerateCount),generated);
      const overflow=await page.evaluate(()=>[...document.querySelectorAll('#youTubeAudioTools button,#youTubeAudioTools select')].filter(el=>el.scrollWidth>el.clientWidth+2).map(el=>el.id));
      assert.deepEqual(overflow,[],'new controls must fit at '+width+'px');
      await page.locator('#youTubeAudioTools').screenshot({path:'/private/tmp/rvt-youtube-'+process.env.RVT_BROWSER+'-'+width+'.png'});
      // Ready/pause/mute/stop controls all cancel the new playback source.
      await page.evaluate(()=>startRun('qa',{paused:true}));await page.locator('#btnPause').click();
      await page.waitForFunction(()=>!!timerVoiceState.source);await page.locator('#btnPause').click();
      assert.equal(await page.evaluate(()=>timerVoiceState.source),null);
      await page.locator('#btnPause').click();await page.evaluate(()=>speak('水を飲む'));await page.waitForFunction(()=>!!timerVoiceState.source);
      await page.locator('#btnRunMuteBottom').click();assert.equal(await page.evaluate(()=>timerVoiceState.source),null);
      await page.locator('#btnRunMuteBottom').click();await page.evaluate(()=>speak('水を飲む'));await page.waitForFunction(()=>!!timerVoiceState.source);
      await page.evaluate(()=>stopRun());assert.equal(await page.evaluate(()=>timerVoiceState.source),null);
      // A modified step has no saved clip: it must stay silent, even with the rest of the routine cached.
      await page.evaluate(()=>speak('未保存の新しい案内'));await page.waitForFunction(()=>!timerVoiceState.pending);
      assert.equal(await page.evaluate(()=>timerVoiceState.source),null);assert.equal(await page.evaluate(()=>qaSpeechCount),0);
      // Reload retains both mode and IndexedDB clips. No generation or key is needed to replay them.
      await page.reload();await page.evaluate(()=>showScreen('scr-set'));
      assert.equal(await page.locator('#setYouTubeAudio').isChecked(),true);
      await page.waitForFunction(()=>document.getElementById('youTubeAudioStatus').textContent.includes('保存済み'));
      await page.getByRole('button',{name:'🔊 テスト再生',exact:true}).click();await page.waitForFunction(()=>!!timerVoiceState.source);
      await page.evaluate(()=>stopSpeech());assert.deepEqual(errors,[]);assert(!requests.some(url=>url.includes('api.openai.com')));
      console.log('PASS: '+(process.env.RVT_BROWSER||'chromium')+' '+width+'px UI, actual PCM graph, IndexedDB reuse/reload, changed/missing clips, pause/mute/stop, no API/TTS during playback');
      await context.close();
    }
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
