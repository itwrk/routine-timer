// NODE_PATH=<external playwright installation>/node_modules node tests/memory-drive-browser.cjs
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http');
(async()=>{
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync('index.html'));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:process.env.RVT_CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true});
  try{
    const context=await browser.newContext({viewport:{width:380,height:820},isMobile:true,hasTouch:true});
    await context.addInitScript(()=>{
      localStorage.setItem('rvt_v1',JSON.stringify({settings:{apiKey:'sk-ant-obsolete',autoSync:false,syncUrl:'https://script.google.com/macros/s/test/exec',syncKey:'synthetic-sync-passphrase',sound:false}}));
      localStorage.setItem('rvt_memory_openai_key_v1','synthetic-openai-key');
    });
    const page=await context.newPage(),errors=[],requests=[],chunks=[];
    page.on('pageerror',e=>errors.push(e.message));
    let offset=0,total=0,dropOnce=true,failSave=false;
    await page.route('**/*',async route=>{
      const request=route.request(),url=request.url();
      if(url.startsWith(origin))return route.continue();
      if(url==='https://script.google.com/macros/s/test/exec'){
        const body=JSON.parse(request.postData());requests.push(body);
        assert.equal(body.key,'synthetic-sync-passphrase');assert(!JSON.stringify(body).includes('synthetic-openai-key'));
        if(failSave)return route.abort();
        if(body.action==='rvtMemoryStart'){total=body.bytes;return route.fulfill({json:{ok:true,memoryDriveVersion:1,offset,done:offset===total,url:'https://drive.google.com/file/d/synthetic-audio/view'}});}
        assert.equal(body.action,'rvtMemoryChunk');assert.equal(body.offset,offset);
        const bytes=Buffer.from(body.base64,'base64');chunks.push(bytes);offset+=bytes.length;
        if(dropOnce){dropOnce=false;return route.abort();}
        return route.fulfill({json:{ok:true,memoryDriveVersion:1,offset,done:offset===total,url:'https://drive.google.com/file/d/synthetic-audio/view'}});
      }
      return route.abort();
    });
    await page.goto(origin);await page.locator('[data-scr="scr-memory"]').click();await page.waitForFunction(()=>memoryState.ready);
    assert.equal(await page.evaluate(()=>getOpenAIKey()),'synthetic-openai-key');assert.equal(await page.evaluate(()=>localStorage.getItem('rvt_memory_openai_key_v1')),null);
    assert.equal(await page.locator('#memModel').isVisible(),true);assert.equal(await page.locator('#memModel option').count(),10);
    await page.locator('#memEngine').selectOption('device');assert.equal(await page.evaluate(()=>memoryPrefs.engine),'device');
    await page.locator('#memEngine').selectOption('ai');
    await page.evaluate(async()=>{
      memoryState.note.html=memoryParseNotation('保存テスト');memoryRenderNote();await memorySave();
      memoryPrefs.loop='30';memoryPrefs.gap=10;memoryPrefs.fixed=true;memoryPrefs.fixedRate=2;
      const plan=memoryAudioPlan(memoryEditorHTML()),id=await memoryClipId(plan.segments[0],plan.prefs);
      await memoryStore('clips','put',{id,pcm:new Blob([new Uint8Array(1100000)])});
    });
    assert.equal(await page.evaluate(()=>memorySaveAudioToDrive()),true);
    assert.equal(requests.filter(x=>x.action==='rvtMemoryStart').length,2,'recover from a lost chunk response');
    assert.equal(Buffer.concat(chunks).length,1100044,'archive has no playback loops or gaps');assert.equal(Buffer.concat(chunks).subarray(0,4).toString(),'RIFF');
    assert.equal(await page.locator('#memDriveLink').getAttribute('href'),'https://drive.google.com/file/d/synthetic-audio/view');
    assert((await page.locator('#memDriveStatus').textContent()).includes('保存しました'));
    failSave=true;assert.equal(await page.evaluate(()=>memorySaveAudioToDrive()),false);
    assert((await page.locator('#memDriveStatus').textContent()).includes('端末の音声は残っています'));
    assert.equal(await page.locator('#memDriveSave').isDisabled(),false);assert((await page.evaluate(()=>memoryStore('clips','getAll'))).length>0);
    // Successful generation automatically archives without exposing the shared OpenAI key.
    failSave=false;offset=0;dropOnce=false;
    await page.evaluate(async()=>{
      memoryState.note.html=memoryParseNotation('自動保存の新しい本文');memoryRenderNote();await memorySave();
      window.generatedWithKey='';memoryGenerateClip=async(text,prefs,key)=>{generatedWithKey=key;return new Blob([new Uint8Array(4800)])};
      await memoryGenerate();
    });
    assert.equal(await page.evaluate(()=>generatedWithKey),'synthetic-openai-key');assert.equal(offset,4844);
    assert((await page.locator('#memDriveStatus').textContent()).includes('保存しました'));
    await page.evaluate(async()=>{memoryPrefs.loop='off';memoryPrefs.gap=0;memoryPrefs.fixed=false;memorySavePrefs();memoryRenderSettings();memoryInvalidateAudio();await memoryPrepareAudio();});
    await page.locator('.mem-audio-options').scrollIntoViewIfNeeded();
    await page.waitForTimeout(2200);
    await page.locator('.mem-audio-options').screenshot({path:'/tmp/rvt-memory-audio-options.png'});
    await page.locator('#memSettings').evaluate(e=>e.open=true);await page.locator('#memApiKey').fill('replacement-common-key');await page.locator('#memApiKey').dispatchEvent('change');
    assert.equal(await page.evaluate(()=>D.settings.apiKey),'replacement-common-key');assert.equal(await page.locator('#setApiKey').inputValue(),'replacement-common-key');
    const count=requests.length;
    await page.evaluate(()=>D.settings.syncUrl='https://example.com/untrusted');assert.equal(await page.evaluate(()=>memorySaveAudioToDrive()),false);assert.equal(requests.length,count);
    assert.deepEqual(errors,[]);
    await page.locator('#memSettings').evaluate(e=>e.open=false);await page.locator('.mem-audio-options').scrollIntoViewIfNeeded();
    await page.screenshot({path:'/tmp/rvt-memory-drive-mobile.png'});
    console.log('PASS: migration, visible model/voice/engine selection, automatic archive, mobile layout, uncertain upload recovery, natural WAV, failure keeps clips, shared key fields, no credential forwarding to untrusted URLs');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
