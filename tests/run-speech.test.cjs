const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const source=html.slice(html.indexOf('/* ============ audio session ============ */'),html.indexOf('/* ============ confetti ============ */'));
function fixture(){
  const spoken=[],timers=new Map(),notices=[];let id=0,cancels=0,ends=0;
  const synth={speaking:false,pending:false,paused:true,getVoices:()=>[],cancel(){cancels++;this.speaking=false;this.pending=false},resume(){this.paused=false},speak(u){spoken.push(u);this.pending=true}};
  const ctx={navigator:{},D:{settings:{}},run:{speechMode:'tts'},speechSynthesis:synth,SpeechSynthesisUtterance:class{constructor(text){this.text=text}},
    setTimeout(fn,ms){const i=++id;timers.set(i,{fn,ms});return i},clearTimeout(i){timers.delete(i)},document:{getElementById:()=>null},toast:m=>notices.push(m)};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
  return {ctx,synth,spoken,timers,notices,get cancels(){return cancels},get ends(){return ends},speak(){ctx.speak('水を飲む、1分です。',()=>ends++)},fire(ms){const entry=[...timers].find(([,t])=>t.ms===ms);assert(entry,`timer ${ms}`);timers.delete(entry[0]);entry[1].fn()},eval:s=>vm.runInContext(s,ctx)};
}
let f=fixture();f.speak();assert.equal(f.spoken.length,1);assert.equal(f.synth.paused,false);assert.equal(f.cancels,0,'idle engine must not be canceled twice');assert.equal(f.eval('timerVoiceState.utterance'),f.spoken[0]);
f.spoken[0].onstart();f.synth.pending=false;f.synth.speaking=false;f.spoken[0].onend();assert.equal(f.ends,1);assert.equal(f.timers.size,0);assert(!f.ctx.isSpeechBusy());
f=fixture();f.speak();f.fire(3000);assert(f.ctx.isSpeechBusy());f.fire(120);f.fire(3000);assert.equal(f.spoken.length,2);assert.equal(f.ends,1);assert.equal(f.timers.size,0);assert.equal(f.notices.length,1);
f=fixture();f.speak();f.fire(3000);const staleRetry=[...f.timers.values()][0].fn;f.ctx.stopSpeech();staleRetry();assert.equal(f.spoken.length,1);assert.equal(f.ends,0);
f=fixture();f.speak();const old=f.spoken[0];f.ctx.speak('歯みがき');old.onend();old.onerror({error:'interrupted'});assert.equal(f.ends,0);assert.equal(f.spoken.length,2);assert.equal(f.eval('timerVoiceState.utterance'),f.spoken[1]);
f=fixture();f.speak();f.spoken[0].onerror({error:'not-allowed'});assert.equal(f.spoken.length,1);assert.equal(f.ends,1);assert.equal(f.timers.size,0);
f=fixture();f.ctx.D.settings.youTubeAudio=true;f.speak();assert.equal(f.spoken.length,1,'run-specific TTS overrides the default');
f.ctx.run.speechMode='audio';f.ctx.playSavedSpeech=(text,cb)=>{f.saved=text;if(cb)cb()};f.speak();assert.equal(f.saved,'水を飲む、1分です。');assert.equal(f.spoken.length,1);
f.ctx.speakLater('完了しました',300);f.ctx.run=null;f.ctx.D.settings.youTubeAudio=false;f.fire(300);assert.equal(f.saved,'完了しました','delayed completion retains the selected audio mode');
console.log('PASS: synchronous TTS, retained reference, paused-engine resume, bounded retry, cancellation/late callbacks, mode override and completion mode');
