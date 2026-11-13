// NODE_PATH=<playwright>/node_modules [RVT_BROWSER=webkit] node tests/run-controls-browser.cjs
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
        localStorage.setItem('rvt_v1',JSON.stringify({routines:[{id:'qa',name:'確認用ルーチン',emoji:'🌅',steps:[{id:'a',sharedId:'shared',name:'水を飲む',sec:60,texts:['元のメッセージ']},{id:'b',sharedId:'shared',name:'水を飲む',sec:60,texts:['元のメッセージ']}]}],hitokoto:[],settings:{autoSync:false,syncUrl:'https://sync.invalid',sound:false,calLog:'off',moti:true}}));
        window.qaSpoken=[];
        Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
          speaking:false,pending:false,paused:false,getVoices:()=>[],addEventListener(){},
          speak(u){qaSpoken.push(u);u.onstart?.()},cancel(){},resume(){}
        }});
      });
      const page=await context.newPage(),errors=[],requests=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();requests.push(route.request().url());return route.abort()});
      await page.goto(origin);await page.evaluate(()=>{D.hitokoto=[];startRun('qa',{paused:true});clearInterval(timer)});
      assert.equal(await page.locator('#btnRunTts').getAttribute('aria-pressed'),'true');
      await page.locator('#btnRunAudio').click();assert.equal(await page.evaluate(()=>run.speechMode),'audio');
      await page.locator('#btnRunTts').click();await page.locator('#btnPause').click();
      assert.equal(await page.evaluate(()=>qaSpoken.at(-1).text),'水を飲む、1分です。');
      // Countdown/halfway announcements must not replace a pending step introduction.
      const count=await page.evaluate(()=>qaSpoken.length);
      await page.evaluate(()=>{run.leftMs=9000;run.left=10;run.lastTickAt=Date.now();tick()});
      assert.equal(await page.evaluate(()=>qaSpoken.length),count);
      await page.evaluate(()=>{qaSpoken.at(-1).onend();run.leftMs=60000;run.left=60});
      assert.equal(await page.evaluate(()=>qaSpoken.at(-1).text),'元のメッセージ');
      await page.locator('#runMessageEditor summary').click();
      await page.locator('#runMessageRows textarea').fill('次回のメッセージ');
      await page.getByRole('button',{name:'＋ メッセージ',exact:true}).click();await page.locator('#runMessageRows textarea').last().fill('追加したメッセージ');
      await page.getByRole('button',{name:'次回用に保存',exact:true}).click();
      assert.deepEqual(await page.evaluate(()=>D.routines[0].steps.map(s=>s.texts)),[['次回のメッセージ','追加したメッセージ'],['次回のメッセージ','追加したメッセージ']]);
      assert.equal(await page.evaluate(()=>run.currentMoti),'元のメッセージ');
      // Switching targets keeps an unsaved draft. Shared edits don't change this run's snapshots.
      await page.locator('#runMessageRows textarea').first().fill('未保存の下書き');
      await page.locator('#runMessageTarget').selectOption('b');await page.locator('#runMessageTarget').selectOption('a');
      assert.equal(await page.locator('#runMessageRows textarea').first().inputValue(),'未保存の下書き');
      await page.locator('#runMessageTarget').selectOption('__common');await page.getByRole('button',{name:'＋ メッセージ',exact:true}).click();
      await page.locator('#runMessageRows textarea').fill('次回の共通メッセージ');await page.getByRole('button',{name:'次回用に保存',exact:true}).click();
      assert.deepEqual(await page.evaluate(()=>run.hitokoto),[]);
      // New steps are available in countdown mode, without resetting the current clock.
      await page.locator('#runNewStepInput').fill('実行中に追加');await page.locator('#runNewStepSec').fill('45');
      const before=await page.evaluate(()=>({idx:run.idx,leftMs:run.leftMs,elapsed:run.stepElapsedMs}));
      await page.getByRole('button',{name:'＋ 新規',exact:true}).click();
      assert.deepEqual(await page.evaluate(()=>({idx:run.idx,leftMs:run.leftMs,elapsed:run.stepElapsedMs})),before);
      assert.equal(await page.evaluate(()=>run.r.steps.at(-1).sec),45);
      await page.getByRole('button',{name:'📚 ライブラリから追加',exact:true}).click();
      await page.locator('#libList .librow').last().getByRole('button').click();await page.locator('#libModal').getByRole('button',{name:'閉じる',exact:true}).click();
      assert.equal(await page.evaluate(()=>run.r.steps.length),4);
      await page.locator('#btnDoneStep').click();assert.equal(await page.evaluate(()=>run.idx),1);
      assert.equal(await page.evaluate(()=>qaSpoken.at(-1).text),'水を飲む、1分です。');
      await page.evaluate(()=>qaSpoken.at(-1).onend());assert.equal(await page.evaluate(()=>qaSpoken.at(-1).text),'元のメッセージ');
      await page.locator('#btnSkipStep').click();assert.equal(await page.evaluate(()=>qaSpoken.at(-1).text),'実行中に追加、45秒です。');
      await page.locator('#btnPause').click();assert(await page.locator('#btnRunSpeakAgain').isDisabled());
      await page.locator('#btnPause').click();assert.equal(await page.evaluate(()=>qaSpoken.at(-1).text),'実行中に追加、45秒です。');
      await page.locator('#btnRunMute').click();assert(await page.locator('#btnRunSpeakAgain').isDisabled());await page.locator('#btnRunMute').click();assert(!(await page.locator('#btnRunSpeakAgain').isDisabled()));
      await page.locator('#btnRunSpeakAgain').click();assert.equal(await page.evaluate(()=>qaSpoken.at(-1).text),'実行中に追加、45秒です。');
      const overflow=await page.evaluate(()=>[...document.querySelectorAll('#run button,#run select')].filter(el=>el.clientWidth&&el.scrollWidth>el.clientWidth+2).map(el=>el.id||el.textContent));
      assert.deepEqual(overflow,[],'controls must fit at '+width+'px');
      await page.locator('#runMessageEditor').screenshot({path:'/tmp/rvt-run-messages-'+(process.env.RVT_BROWSER||'chromium')+'-'+width+'.png'});
      await page.evaluate(()=>{document.getElementById('run').scrollTop=0});await page.screenshot({path:'/tmp/rvt-run-controls-'+(process.env.RVT_BROWSER||'chromium')+'-'+width+'.png'});
      await page.evaluate(()=>{run.leftMs=0;tick()});
      assert.equal(await page.evaluate(()=>run.idx),3,'automatic expiry advances to the added library step');
      assert((await page.evaluate(()=>qaSpoken.at(-1).text)).startsWith(await page.evaluate(()=>run.r.steps[3].name)));
      await page.evaluate(()=>{stopRun();startRun('qa',{paused:true});clearInterval(timer)});
      assert.deepEqual(await page.evaluate(()=>run.messageTexts.get('a')),['次回のメッセージ','追加したメッセージ']);
      assert.deepEqual(await page.evaluate(()=>run.hitokoto),['次回の共通メッセージ']);
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rvt_v1')).routines[0].steps.length),4);
      await page.locator('#btnRunChecklist').click();assert(await page.locator('#runNewStepInput').isVisible());
      await page.locator('#btnPause').click();await page.locator('#runNewStepInput').fill('チェックリスト追加');await page.getByRole('button',{name:'＋ 新規',exact:true}).click();
      assert.equal(await page.locator('#routineChecklist .routine-checklist-item').count(),5);
      await page.evaluate(()=>stopRun());assert.deepEqual(errors,[]);assert(!requests.some(url=>url.includes('api.openai.com')));
      console.log('PASS: '+(process.env.RVT_BROWSER||'chromium')+' '+width+'px mode selection, manual/skip/resume speech, protected intro, shared/common next-run edits, drafts, countdown/library/checklist additions, persistence, layout, no API calls');
      await context.close();
    }
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
