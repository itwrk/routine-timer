const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const source=html.slice(html.indexOf('/* ============ audio session ============ */'),html.indexOf('/* ============ confetti ============ */'));
function fixture(){
  const events=[],clips=new Map(),nodes=new Map(),sources=[],buffers=[],gains=[];
  const bytes=()=>new Uint8Array([0,128,255,127]).buffer;
  const pcm=()=>new Blob([bytes()]);
  let type='auto';
  class AudioContext{
    constructor(){assert.equal(type,'ambient');this.state='suspended';this.destination={};this.currentTime=0;events.push('context');}
    resume(){this.state='running';events.push('resume');return Promise.resolve();}
    createBuffer(channels,length,rate){const channel=new Float32Array(length),buffer={channels,length,rate,channel,getChannelData:()=>channel};buffers.push(buffer);return buffer;}
    createBufferSource(){
      const source={playbackRate:{value:1},connect(){},disconnect(){events.push('disconnect')},start(){assert.equal(type,'ambient');events.push('play')},stop(){events.push('stop')}};
      sources.push(source);return source;
    }
    createGain(){const gain={gain:{value:1},connect(){},disconnect(){events.push('gain-disconnect')}};gains.push(gain);return gain;}
  }
  function node(id){if(!nodes.has(id))nodes.set(id,{value:id==='youTubeAudioRoutine'?'routine':'',focus(){events.push('focus')},setAttribute(){},removeAttribute(){}});return nodes.get(id);}
  const routine={id:'routine',name:'朝のルーチン',steps:[{name:'水を飲む',sec:60,texts:['まずは一歩。よくできた！']},{name:'歯みがき',sec:30,texts:[]}]};
  const ctx={Blob,ArrayBuffer,DataView,Float32Array,AbortController,DOMException,setTimeout,clearTimeout,Promise,Date,
    navigator:{audioSession:{get type(){return type},set type(v){type=v}}},
    D:{settings:{youTubeAudio:true,rate:1.2,voiceVolume:.7,moti:true},routines:[routine],hitokoto:['できた分だけ前進。']},
    document:{getElementById:node},AudioContext,
    speechSynthesis:{getVoices(){return []},cancel(){events.push('tts-cancel')},speak(){events.push('tts')}},
    memoryClipId:async({text})=>'clip:'+text,
    memoryStore:async(store,method,value)=>{assert.equal(store,'clips');if(method==='get')return clips.get(value);if(method==='put')clips.set(value.id,value);},
    memoryGenerateClip:async(text,prefs,key,signal)=>{assert.equal(key,'synthetic-key');assert.equal(prefs.model,'gpt-realtime-2.1-mini');assert(!signal.aborted);events.push('generate:'+text);return pcm();},
    getOpenAIKey:()=> 'synthetic-key',memoryError:e=>e.message,toast:m=>events.push('notice:'+m),save(){},
    runCompletionSpeech:(name,perfect)=>perfect?`${name}、完了しました！パーフェクト完走です！ボーナス30XPです！`:`${name}、完了しました！おつかれさまでした！`
  };
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
  const evaluate=text=>vm.runInContext(text,ctx);
  return {ctx,events,clips,sources,buffers,gains,nodes,node,pcm,evaluate,routine,cache(text){for(const part of ctx.timerVoiceParts(text))clips.set('timer-voice-v1-clip:'+part,{pcmBytes:bytes()});}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  let f=fixture(),ended=0;
  f.cache('水を飲む、1分です。');f.ctx.speak('水を飲む、1分です。',()=>ended++);await flush();
  assert.equal(f.sources.length,1);assert.equal(f.buffers[0].length,1924);assert.equal(f.buffers[0].rate,24000);
  assert.equal(f.buffers[0].channel[0],-1);assert.equal(f.buffers[0].channel[1],32767/32768);assert.equal(f.buffers[0].channel[2],0);assert.equal(f.buffers[0].channel[1922],-1);
  assert.equal(f.sources[0].playbackRate.value,1.2);assert.equal(f.gains[0].gain.value,.7);
  assert(f.evaluate('isSpeechBusy()'));assert.equal(ended,0);f.sources[0].onended();assert.equal(ended,1);assert(!f.evaluate('isSpeechBusy()'));
  assert(!f.events.some(e=>e.startsWith('tts')||e.startsWith('generate:')),'saved playback never uses TTS or the network');
  // Missing audio completes callbacks without falling back to the interrupting device voice.
  f.ctx.speak('未保存の案内',()=>ended++);await flush();assert.equal(ended,2);assert.equal(f.sources.length,1);assert(!f.evaluate('isSpeechBusy()'));
  assert(f.events.some(e=>e.startsWith('notice:音声が未保存')));assert(!f.events.some(e=>e.startsWith('tts')||e.startsWith('generate:')));
  // Muting stops an active buffer and any in-flight cache read.
  f.ctx.speak('水を飲む。',()=>ended++);await flush();const stopped=f.sources[1];
  f.ctx.run={muted:true};f.ctx.stopTimerAudio();assert.equal(stopped.onended,null);assert(f.events.includes('stop'));assert(f.events.includes('gain-disconnect'));
  const count=f.events.length;f.ctx.speak('水を飲む',()=>ended++);await flush();assert.equal(f.events.length,count);assert.equal(ended,3);
  f=fixture();let release;
  f.ctx.memoryStore=()=>new Promise(resolve=>{release=resolve});f.ctx.speak('水を飲む',()=>{throw Error('canceled callback')});await flush();
  f.ctx.stopSpeech();release({pcmBytes:await f.pcm().arrayBuffer()});await flush();assert.equal(f.sources.length,0);assert(!f.evaluate('isSpeechBusy()'));
  // Replacing an announcement invalidates an earlier asynchronous read.
  f=fixture();const originalStore=f.ctx.memoryStore;let first;
  f.cache('新しい案内');f.ctx.memoryStore=(store,method,id)=>id==='timer-voice-v1-clip:古い案内'?new Promise(resolve=>{first=resolve}):originalStore(store,method,id);
  f.ctx.speak('古い案内');await flush();f.ctx.speak('新しい案内');await flush();first({pcmBytes:await f.pcm().arrayBuffer()});await flush();assert.equal(f.sources.length,1);
  // A late completion announcement must not override a newly started one.
  f.ctx.speakLater('古い完了案内',5);f.ctx.stopSpeech();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.sources.length,1);
  // A resume rejection stays silent and does not create an unhandled rejection.
  f=fixture();f.cache('水を飲む');f.ctx.AudioContext.prototype.resume=function(){return Promise.reject(Error('blocked'))};
  f.ctx.speak('水を飲む');await flush();assert.equal(f.sources.length,0);assert(!f.evaluate('isSpeechBusy()'));
  // Every timer variant has the same phrase identity as the preparation inventory.
  f=fixture();const plan=new Set(f.ctx.timerVoicePlan(f.routine));
  for(const text of ['水を飲む、1分です。','歯みがき、30秒です。','水を飲む、まず10秒だけです。','水を飲む、実時間計測です。終わったら次へを押してください。','水を飲む。あと半分です！','水を飲む。まずは一歩。よくできた！','朝のルーチン。チェックリストを始めます。',f.ctx.runCompletionSpeech(f.routine.name,true),f.ctx.runCompletionSpeech(f.routine.name,false)]){
    for(const part of f.ctx.timerVoiceParts(text))assert(plan.has(part),part);
  }
  assert.equal(plan.size,f.ctx.timerVoicePlan(f.routine).length);assert(plan.has('10'));assert(plan.has('0'));
  f.ctx.D.settings.moti=false;assert(!f.ctx.timerVoicePlan(f.routine).includes('まずは一歩'));assert(!f.ctx.timerVoicePlan(f.routine).includes('できた分だけ前進'));
  // Generation is explicit, retains completed clips, deduplicates and resumes after interruption.
  f=fixture();f.ctx.D.settings.moti=false;f.cache('水を飲む');await f.ctx.prepareYouTubeAudio();
  assert(f.events.some(e=>e.startsWith('generate:')));assert(!f.events.includes('generate:水を飲む'));assert(f.node('youTubeAudioStatus').textContent.includes('音声を保存しました'));
  const generated=f.events.filter(e=>e.startsWith('generate:')).length;await f.ctx.prepareYouTubeAudio();assert.equal(f.events.filter(e=>e.startsWith('generate:')).length,generated);
  const cacheSize=f.clips.size;f.ctx.D.routines[0].steps[0].name='変更したステップ';await f.ctx.refreshYouTubeAudio();assert(f.node('youTubeAudioStatus').textContent.includes('未保存 1件'));
  await f.ctx.prepareYouTubeAudio();assert.equal(f.clips.size,cacheSize+1);assert.equal(f.events.filter(e=>e.startsWith('generate:')).length,generated+1);
  f=fixture();let generating;
  f.ctx.memoryGenerateClip=(text,prefs,key,signal)=>new Promise((resolve,reject)=>{generating=true;signal.addEventListener('abort',()=>reject(new DOMException('中止','AbortError')))});
  const job=f.ctx.prepareYouTubeAudio();await flush();assert(generating);await f.ctx.prepareYouTubeAudio();f.ctx.cancelYouTubeAudio();await job;
  assert.equal(f.evaluate('timerVoiceState.generation'),null);assert.equal(f.node('youTubeAudioCancel').hidden,true);assert.equal(f.node('youTubeAudioRoutine').disabled,false);
  f=fixture();f.ctx.getOpenAIKey=()=>'';await f.ctx.prepareYouTubeAudio();assert(!f.events.some(e=>e.startsWith('generate:')));assert(f.events.includes('focus'));
  console.log('PASS: cached PCM mixing, volume/rate, no TTS/network fallback, missing clips, mute/cancel/races, delayed completion, resume failure, inventory coverage, explicit/deduplicated/cancelable generation');
})().catch(e=>{console.error(e);process.exitCode=1});
