// NODE_PATH=<external playwright>/node_modules [RVT_BROWSER=webkit] node tests/memory-reader-browser.cjs
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http');
(async()=>{
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(fs.readFileSync('index.html','utf8'));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port,useWebkit=process.env.RVT_BROWSER==='webkit';
  const browser=await(useWebkit?webkit:chromium).launch({headless:true,executablePath:useWebkit?undefined:process.env.RVT_CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined)});
  try{
    for(const size of [{width:380,height:820},{width:1200,height:900}]){
      const context=await browser.newContext({viewport:size,isMobile:size.width<500,hasTouch:size.width<500});
      await context.addInitScript(()=>localStorage.setItem('rvt_v1',JSON.stringify({settings:{autoSync:false,syncUrl:'https://sync.invalid',sound:false}})));
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
      await page.goto(origin);await page.locator('[data-scr="scr-memory"]').click();await page.waitForFunction(()=>memoryState.ready);
      await page.locator('#memTitle').fill('赤シート暗記ノート');
      await page.evaluate(async()=>{
        memorySetEditorHTML(memoryParseNotation(Array.from({length:60},(_,i)=>`${i+1}行目：大切な《ことば${i+1}》を覚える。`).join('\n')));
        memoryChanged();await memorySave();window.scrollTo(0,400);
      });
      await page.waitForFunction(()=>window.scrollY===400);
      await page.evaluate(()=>memoryToggleMode());
      const stage=page.locator('#memStage'),sheet=page.locator('#memSheet');
      assert.equal(await page.locator('#memEditor').getAttribute('contenteditable'),'false');
      assert.equal(await page.evaluate(()=>getComputedStyle(document.body).position),'fixed');
      assert.equal(await sheet.isVisible(),true);
      assert.equal(await page.locator('.mem-sheet-grip,.mem-sheet-size').count(),0);
      const y=await sheet.evaluate(el=>el.getBoundingClientRect().top);
      assert(Math.abs(y-size.height*.54)<2,'sheet boundary follows the viewport');
      assert.equal(await page.locator('.mem-audio-options').isVisible(),false,'study view only shows the text and compact controls');
      const oldPaper=await page.locator('#memEditor').evaluate(el=>el.getBoundingClientRect().top);
      if(!useWebkit&&size.width<500){
        const cdp=await context.newCDPSession(page),x=size.width/2,start=size.height*.82;
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:start}]});
        for(let i=1;i<=10;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:start-i*20}]});await page.waitForTimeout(20);}
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
      }else{await stage.focus();await page.keyboard.press('PageDown');}
      await page.waitForFunction(()=>document.getElementById('memStage').scrollTop>50);
      await page.waitForFunction(()=>{const top=document.getElementById('memStage').scrollTop;window.qaStableFrames=top===window.qaLastScroll?(window.qaStableFrames||0)+1:0;window.qaLastScroll=top;return window.qaStableFrames>8;},{},{polling:'raf'});
      assert((await page.locator('#memEditor').evaluate(el=>el.getBoundingClientRect().top))<oldPaper-40);
      assert.equal(await sheet.evaluate(el=>el.getBoundingClientRect().top),y,'sheet never moves with the text');
      // A covered marker is still tappable through the sheet and keeps its position.
      const mark=page.locator('#memEditor .mem-mark').nth(10);
      await mark.evaluate(el=>{const stage=document.getElementById('memStage'),edge=document.getElementById('memSheet').getBoundingClientRect().top;stage.scrollTop+=el.getBoundingClientRect().top-edge-30;});
      const rect=await mark.boundingBox(),beforeCheck=await stage.evaluate(el=>el.scrollTop);
      await page.waitForFunction(()=>document.querySelectorAll('#memEditor .mem-mark')[10].dataset.memMask==='hidden');
      assert.equal(await mark.locator('.mem-red-ink').first().evaluate(el=>getComputedStyle(el).color),'rgba(0, 0, 0, 0)','covered red letters are actually hidden');
      await page.mouse.click(rect.x+8,rect.y+rect.height/2);
      assert.equal(await mark.getAttribute('data-checked'),'true');assert.equal(await stage.evaluate(el=>el.scrollTop),beforeCheck);
      assert.equal(await mark.evaluate(el=>getComputedStyle(el,'::after').zIndex),'6');
      await page.locator('#memStudySheetToggle').click();assert.equal(await sheet.isVisible(),false);
      assert.notEqual(await mark.locator('.mem-red-ink').first().evaluate(el=>getComputedStyle(el).color),'rgba(0, 0, 0, 0)');
      await page.locator('#memStudySheetToggle').click();assert.equal(await sheet.isVisible(),true);
      assert.equal(await stage.evaluate(el=>el.scrollTop),beforeCheck);
      await mark.evaluate(el=>{const edge=document.getElementById('memSheet').getBoundingClientRect().top;document.getElementById('memStage').scrollTop+=el.getBoundingClientRect().bottom-edge+24;});
      await page.waitForFunction(()=>document.querySelectorAll('#memEditor .mem-mark')[10].dataset.memMask==='visible');
      assert.notEqual(await mark.locator('.mem-red-ink').first().evaluate(el=>getComputedStyle(el).color),'rgba(0, 0, 0, 0)','scrolling above the sheet reveals the answer');
      await page.evaluate(()=>memorySave());
      const stored=await page.evaluate(async()=>(await memoryStore('notes','get',memoryState.note.id)).html);
      assert(!stored.includes('mem-red-ink'));assert(!stored.includes('data-mem-mask'));assert(stored.includes('data-checked="true"'),'checks remain in the saved note');
      await page.locator('#memStudySpeed').click();assert.equal(await page.locator('#memStudySpeed').textContent(),await page.locator('#memSpeed').textContent());
      await page.locator('#memStudyLoop').click();assert((await page.locator('#memStudyLoop').textContent()).includes('∞'));
      await stage.evaluate(el=>el.scrollTop=el.scrollHeight);
      const last=await page.locator('#memEditor .mem-block').last().boundingBox();assert(last.y+last.height<y,'the final line can scroll fully above the sheet');
      await page.setViewportSize({width:size.width,height:size.height-160});
      assert(Math.abs((await sheet.evaluate(el=>el.getBoundingClientRect().top))-(size.height-160)*.54)<2);
      await page.setViewportSize(size);
      await page.locator('.mem-study-toolbar button').first().click();
      assert.equal(await page.evaluate(()=>document.body.classList.contains('memory-reading')),false);
      assert.equal(await page.evaluate(()=>window.scrollY),400,'editing restores the original page position');
      assert.equal(await page.locator('#memEditor').getAttribute('contenteditable'),'true');
      // Both entry buttons open the same scroll-based reader; navigation unlocks the page.
      await page.locator('#memSheetToggle').click();assert.equal(await sheet.isVisible(),true);
      await page.evaluate(()=>showScreen('scr-home'));assert.equal(await page.evaluate(()=>document.body.classList.contains('memory-reading')),false);
      assert.equal(await page.evaluate(()=>memoryState.readMode),false);
      await page.locator('[data-scr="scr-memory"]').click();
      await page.locator('#memMode').click();await page.getByRole('button',{name:'音声設定を開く',exact:true}).click();
      assert.equal(await page.evaluate(()=>memoryState.readMode),false);assert.equal(await page.locator('#memSettings').evaluate(el=>el.open),true);
      // A long marked phrase reveals its upper lines while its lower lines stay hidden.
      await page.evaluate(()=>{
        memorySetEditorHTML(memoryParseNotation('《'+('長い赤マーカーの文章をスクロールして確認します。'.repeat(20))+'👩‍💻 e\u0301✓》\n【緑マーカー】'));
        const mark=document.querySelector('#memEditor .mem-mark[data-color="red"]'),canvas=document.createElement('canvas');canvas.width=canvas.height=1;
        const image=document.createElement('img');image.src=canvas.toDataURL();image.alt='確認用画像';mark.appendChild(image);
        const nested=document.createElement('span');nested.className='mem-mark';nested.dataset.color='green';nested.textContent='内側の緑マーカー';mark.appendChild(nested);
        window.qaBeforeReading=memoryToNotation(memoryEditorHTML());
        memoryState.readScrollTop=0;memoryToggleMode();
      });
      const long=page.locator('#memEditor .mem-mark[data-color="red"]');
      assert.equal(await long.getAttribute('data-mem-mask'),'partial');
      assert(await long.locator('[data-mem-mask="hidden"]').count()>0);assert(await long.locator('[data-mem-mask="visible"]').count()>0);
      assert.equal(await long.locator('.mem-red-ink').filter({hasText:'👩‍💻'}).count(),1);
      assert.equal(await long.locator('.mem-red-ink').filter({hasText:'e\u0301'}).count(),1);
      assert((await page.locator('#memEditor .mem-mark[data-color="green"]').evaluateAll(els=>els.map(el=>getComputedStyle(el).color))).every(color=>color!=='rgba(0, 0, 0, 0)'));
      assert(!await page.evaluate(()=>memoryEditorHTML().includes('mem-red-ink')));
      await page.evaluate(()=>memoryToggleMode());
      assert.equal(await page.locator('#memEditor img').count(),1,'mode changes preserve images inside marked content');
      assert.equal(await page.evaluate(()=>memoryToNotation(memoryEditorHTML())),await page.evaluate(()=>qaBeforeReading));
      // Reference preview uses synthetic study content, never the user's local notes.
      await page.evaluate(()=>{
        memoryPrefs.speed=1;memoryPrefs.fixed=false;memoryPrefs.loop='off';memoryRenderControls();
        memorySetEditorHTML(memoryParseNotation('今日の学習を、ひとつずつ進める。\n大切なのは《思い出すこと》。\nまず《自分のペース》で読んでみる。\nわかった言葉には《チェック✓》をつける。\n《答えを考えて》からスクロール。\n赤シートの上で《答えを確認》する。\n最後の行まで《自分のペース》で進める。'));
        memoryState.readScrollTop=0;memoryToggleMode();
      });
      await page.waitForTimeout(500); // Let the ordinary button feedback finish before the preview.
      await page.screenshot({path:`/tmp/rvt-memory-reader-${useWebkit?'webkit':'chrome'}-${size.width}.png`});
      assert.deepEqual(errors,[]);
      console.log(`PASS ${useWebkit?'WebKit':'Chrome'} ${size.width}px: fixed sheet, native scrolling through overlay, checks, controls, last-line reveal, resize, edit return, settings and navigation`);
      await context.close();
    }
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
