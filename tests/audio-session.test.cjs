const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const source=html.slice(html.indexOf('/* ============ audio session ============ */'),html.indexOf('/* ============ confetti ============ */'));

function createPlayer(mode='supported'){
  let type='auto',mixRequests=0,ended=0;
  const events=[];
  const session={get type(){return type},set type(value){mixRequests++;if(mode==='rejected')throw Error('not allowed');type=value}};
  function output(name){
    if(mode==='supported')assert.equal(type,'ambient',`${name} must mix before producing sound`);
    events.push(name);
  }
  const audioParam={setValueAtTime(){},exponentialRampToValueAtTime(){}};
  class AudioContext{
    constructor(){output('context');this.currentTime=0;this.state='suspended';this.destination={};}
    resume(){output('resume');this.state='running';return Promise.resolve();}
    createOscillator(){return {frequency:{...audioParam},connect(){},start(){output('tone')},stop(){}};}
    createGain(){return {gain:{...audioParam},connect(){}};}
  }
  const speechSynthesis={cancel(){output('cancel')},getVoices(){output('voices');return [{lang:'ja-JP',name:'Kyoko'}]},speak(u){output('speech');assert.equal(u.lang,'ja-JP');assert.equal(u.volume,.7);assert.equal(u.rate,1.2);if(u.onend)u.onend()}};
  const navigator=mode==='missing'?{}:mode==='getter-rejected'?{get audioSession(){throw Error('unavailable')}}:{audioSession:session};
  const ctx={navigator,D:{settings:{sound:true,voiceVolume:.7,sfxVolume:.3,rate:1.2}},speechSynthesis,SpeechSynthesisUtterance:class{constructor(text){this.text=text}},AudioContext};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
  return {ctx,events,resetSession(){type='playback'},get mixRequests(){return mixRequests},get ended(){return ended},onend(){ended++}};
}

for(const mode of ['supported','missing','rejected','getter-rejected']){
  const player=createPlayer(mode),{ctx,events}=player;
  // 起動後や別の音声処理でモードが変わっても、読み上げ・各SEの直前に混在を指定する。
  player.resetSession();ctx.speak('テスト',()=>player.onend());
  assert.equal(player.ended,1);
  player.resetSession();ctx.beep(660,.1);
  player.resetSession();ctx.poan();
  assert(events.includes('speech'));assert.equal(events.filter(x=>x==='tone').length,3);
  assert.equal(events.filter(x=>x==='context').length,1,'reuse the audio context');
  assert(events.includes('resume'));
  const count=events.length,requests=player.mixRequests;
  ctx.D.settings.sound=false;ctx.beep(660,.1);ctx.poan();
  assert.equal(events.length,count,'disabled effects stay silent');
  assert.equal(player.mixRequests,requests,'disabled effects do not activate audio');
  if(mode==='supported')assert.equal(requests,4,'mix at startup and before each audio path');
}
console.log('PASS: mixing before speech/effects, mode restoration, unsupported/rejected APIs, speech callback and controls, context reuse, disabled effects');
