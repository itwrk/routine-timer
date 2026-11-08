const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8'),source=html.slice(html.indexOf('/* ============ MEMORY START ============ */'),html.indexOf('/* ============ MEMORY END ============ */')).replace(/\bmemoryInitEvents\(\);\s*$/,'');
function fixture(){
  const events=[],spoken=[],timers=new Map(),requests=[],sources=[];let timerId=0;
  const audio={paused:true,currentTime:0,pause(){this.paused=true},getAttribute(){return null}};
  const synth={speaking:false,pending:false,paused:false,getVoices:()=>[{voiceURI:'ja',lang:'ja-JP',localService:true},{voiceURI:'en',lang:'en-US'}],cancel(){events.push('cancel');this.speaking=false;this.pending=false},resume(){events.push('resume');this.paused=false},speak(u){events.push('speak');spoken.push(u);this.pending=true}};
  class AudioContext{
    constructor(){events.push('context');this.state='suspended';this.currentTime=0;this.destination={};}
    resume(){events.push('context-resume');this.state='running';return Promise.resolve();}
    createGain(){return{gain:{value:0,setTargetAtTime(value){this.value=value}},connect(){}};}
    createBufferSource(){const s={connect(){},disconnect(){},start(){events.push('bgm-start')},stop(){events.push('bgm-stop')}};sources.push(s);return s;}
    decodeAudioData(){events.push('decode');return Promise.resolve({duration:60});}
    addEventListener(){}
  }
  const ctx={Blob,TextEncoder,DataView,Uint8Array,ArrayBuffer,AbortController,DOMException,AudioContext,
    setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)},
    localStorage:{getItem(){return null},setItem(){},removeItem(){}},navigator:{},
    document:{getElementById(id){return id==='memAudio'?audio:null}},speechSynthesis:synth,SpeechSynthesisUtterance:class{constructor(text){this.text=text}},
    getOpenAIKey:()=>'',useMixedAudioSession(){events.push('mix')},
    fetch:async(url,options)=>{requests.push({url,options});return{ok:true,arrayBuffer:async()=>new ArrayBuffer(4)}},
    esc:s=>s,window:{}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
  const evaluate=s=>vm.runInContext(s,ctx);
  ctx.memoryRenderBgmPanels=()=>{};ctx.memorySetStatus=(s,reader)=>events.push({status:s,reader});ctx.memoryQueuePrepare=()=>events.push('prepare-later');
  ctx.memoryEditorHTML=()=>'';ctx.memoryAudioPlan=()=>({text:'一行目',segments:[{text:'一行目',line:0}],prefs:{gap:0}});
  evaluate("memoryState.note={id:'note'};memoryPrefs.engine='device';memoryPrefs.gap=0;memoryPrefs.loop='off';");
  return{ctx,evaluate,events,spoken,synth,timers,requests,sources,audio,fire(ms){const found=[...timers].find(([,t])=>t.ms===ms);assert(found,'expected timer '+ms);timers.delete(found[0]);found[1].fn()},start(){synth.pending=false;synth.speaking=true;spoken.at(-1).onstart()},end(){synth.speaking=false;synth.pending=false;spoken.at(-1).onend()}};
}
(async()=>{
  let f=fixture();f.synth.paused=true;f.ctx.memoryPlay();
  assert.equal(f.spoken.length,1,'TTS starts synchronously in the tap, before cache I/O');assert(f.events.indexOf('resume')<f.events.indexOf('speak'));assert(!f.events.includes('cancel'),'do not reset an idle synthesis engine');
  assert.equal(f.evaluate('memoryState.ttsUtterance'),f.spoken[0],'keep a strong utterance reference');
  f.start();f.end();f.fire(0);assert.equal(f.evaluate('memoryState.playing'),false);assert.equal(f.evaluate('memoryState.ttsActive'),false);
  f=fixture();f.evaluate("memoryPrefs.engine='ai'");f.ctx.memoryPrepareAudio=()=>{throw Error('no async cache check before speech')};f.ctx.memoryPlay();assert.equal(f.spoken.length,1,'automatic fallback keeps user activation');
  // A start that never happens is retried once, then fails visibly instead of sticking forever.
  f=fixture();f.ctx.memoryPlay();f.fire(3000);f.fire(1000);f.fire(120);assert.equal(f.spoken.length,2);f.start();f.end();f.fire(0);assert.equal(f.evaluate('memoryState.playing'),false);
  f=fixture();f.ctx.memoryPlay();f.fire(3000);f.fire(1000);f.fire(120);f.fire(3000);f.fire(1000);
  assert.equal(f.spoken.length,2);assert.equal(f.evaluate('memoryState.playing'),false);assert(f.events.some(e=>e.status?.includes('開始できません')&&e.reader));assert(![...f.timers.values()].some(t=>t.ms===120));
  // Canceling a waiting startup cannot revive it later.
  f=fixture();f.ctx.memoryPlay();const late=[...f.timers.values()][0].fn;f.ctx.memoryStop();late();assert.equal(f.spoken.length,1);assert.equal(f.evaluate('memoryState.ttsUtterance'),null);
  f=fixture();f.evaluate("memoryPrefs.ttsVoiceURI='en'");f.ctx.memoryPlay();assert.equal(f.spoken[0].lang,'en-US');f.spoken[0].onerror({error:'voice-unavailable'});f.fire(120);assert.equal(f.spoken[1].lang,'ja-JP');
  // Split long lines without adding the inter-line pause between chunks.
  f=fixture();f.evaluate('memoryPrefs.gap=2');f.ctx.memoryAudioPlan=()=>({text:'a',segments:[{text:'あ'.repeat(130),line:0},{text:'次の行',line:2}],prefs:{gap:2}});
  f.ctx.memoryPlay();for(let i=0;i<2;i++){assert(Array.from(f.spoken.at(-1).text).length<=60);f.start();f.end();f.fire(0)}
  f.start();f.end();assert([...f.timers.values()].some(t=>t.ms===4000));f.fire(4000);assert.equal(f.spoken.at(-1).text,'次の行');f.ctx.memoryStop();
  // An engine that finishes but loses onend can recover at its bounded end watchdog.
  f=fixture();f.ctx.memoryPlay();f.start();f.synth.speaking=false;const deadline=[...f.timers].find(([,t])=>t.ms>=20000);f.timers.delete(deadline[0]);deadline[1].fn();f.fire(0);assert.equal(f.evaluate('memoryState.playing'),false);
  f=fixture();f.evaluate("memoryPrefs.loop='30'");f.ctx.memoryPlay();for(let i=0;i<30;i++){f.start();f.end();f.fire(0)}assert.equal(f.spoken.length,30);assert.equal(f.evaluate('memoryState.playing'),false);
  // BGM is same-origin, looped, independent of speech, and reduced while narration speaks.
  f=fixture();await f.ctx.memoryToggleBgm();assert.equal(f.requests[0].url,'assets/bgm/sunset-walk.mp3');assert(f.events.indexOf('context-resume')<f.events.indexOf('decode'));assert.equal(f.sources[0].loop,true);
  f.ctx.memoryBgmDuck(true);assert(Math.abs(f.evaluate('memoryState.bgm.gain.gain.value')-.08)<1e-10);
  f.ctx.memorySetBgmVolume(.4);assert(Math.abs(f.evaluate('memoryState.bgm.gain.gain.value')-.16)<1e-10);
  f.ctx.memoryStop(false);assert.equal(f.evaluate('!!memoryState.bgm.source'),true,'voice settings must not stop the BGM');
  f.ctx.memoryStop();assert.equal(f.evaluate('memoryState.bgm.source'),null);assert.equal(f.evaluate('memoryPrefs.bgmEnabled'),true,'explicit Stop waits for the next Play');
  await f.ctx.memoryStartBgm();assert.equal(f.requests.length,1,'reuse the decoded track');
  await f.ctx.memoryChangeBgmTrack('calm-loop');assert.equal(f.requests[1].url,'assets/bgm/calm-loop.mp3');assert.equal(f.evaluate('memoryState.bgm.bufferTrack'),'calm-loop');
  await f.ctx.memoryToggleBgm();assert.equal(f.evaluate('memoryPrefs.bgmEnabled'),false);
  f=fixture();let release;f.ctx.fetch=(url,options)=>{f.requests.push({url,options});return new Promise(resolve=>release=resolve)};
  const loading=f.ctx.memoryStartBgm();f.ctx.memoryStopBgm();release({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});await loading;assert(!f.events.includes('bgm-start'),'late downloads never restart a stopped BGM');
  f=fixture();f.ctx.fetch=async()=>({ok:false});await f.ctx.memoryStartBgm();assert.equal(f.evaluate('memoryState.bgm.requested'),false);assert(f.evaluate('memoryState.bgm.error').includes('読み込めません'));
  assert.equal(f.ctx.memoryAudioPrefsKey({gap:2,echo:true,bgmEnabled:false,bgmTrack:'a',bgmVolume:.1}),f.ctx.memoryAudioPrefsKey({gap:2,echo:true,bgmEnabled:true,bgmTrack:'b',bgmVolume:.3}),'BGM controls do not rebuild a playing voice');
  for(const name of ['sunset-walk','calm-loop','contemplation'])assert(fs.statSync('assets/bgm/'+name+'.mp3').size>10000);
  console.log('PASS: gesture-safe TTS, paused resume, retained utterances, bounded recovery/errors, cancellation, voice fallback, chunk/line gaps, missing onend, 30 loops, same-origin BGM/duck/volume, independent stop, cache and loading cancellation');
})().catch(error=>{console.error(error);process.exitCode=1});
