const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const speech=html.slice(html.indexOf('/* ============ audio session ============ */'),html.indexOf('/* ============ confetti ============ */'));
const running=html.slice(html.indexOf('/* ============ RUN ============ */'),html.indexOf('/* ============ PROGRESS ============ */'));
const said=[];
const ctx={navigator:{},document:{getElementById:()=>({style:{}})},Date:class extends Date{static now(){return 100000}},setTimeout,clearTimeout,D:{settings:{moti:true},hitokoto:[]}};
ctx.window=ctx;vm.createContext(ctx);vm.runInContext(speech+'\n'+running,ctx);
Object.assign(ctx,{speak:(text,cb)=>said.push({text,cb}),beep(){},sfxTick(){},updateRing(){},updateRemain(){},repeatCurrentSpeech(){}});
const evaluate=s=>vm.runInContext(s,ctx);
function setup(sec=90){
 said.length=0;ctx.sec=sec;
 evaluate("run={r:{steps:[{name:'歯みがき',sec}]},idx:0,targetSec:sec,timerMode:'down',left:sec,leftMs:sec*1000,lastTickAt:100000,stepElapsedMs:0,currentMoti:'奥歯まで丁寧に。',paused:false}");
}
setup();ctx.speakCurrentRunStep();assert.equal(said[0].text,'歯みがき、1分30秒です。');assert(evaluate('run.stepSpeechActive'));
said[0].cb();assert.equal(said[1].text,'奥歯まで丁寧に。');assert(!evaluate('run.stepSpeechActive'));
evaluate('run.left=46;run.leftMs=45000');ctx.tick();assert.equal(said.at(-1).text,'歯みがき。あと45秒です。');assert(evaluate('run.halfSpeechActive'));
said.at(-1).cb();assert(!evaluate('run.halfSpeechActive'));const count=said.length;ctx.tick();assert.equal(said.length,count,'half announcement occurs once');
setup(180);evaluate('run.left=91;run.leftMs=90000');ctx.tick();assert.equal(said[0].text,'歯みがき。あと1分30秒です。');
setup(31);evaluate('run.left=16;run.leftMs=15000');ctx.tick();assert.equal(said[0].text,'歯みがき。あと15秒です。');
setup();ctx.speakCurrentRunStep();const old=said[0];evaluate('run.idx=1');old.cb();assert.equal(said.length,1,'stale intro never reads the old message');
setup();evaluate('run.stepSpeechActive=true;run.left=46;run.leftMs=45000');ctx.tick();assert.equal(said.length,0,'do not interrupt the step name');
setup();evaluate('run.left=46;run.leftMs=20000');ctx.tick();assert.equal(said.length,0,'skip stale halfway catch-up after a background delay');
setup();evaluate('run.halfDone=true');
const expected=['じゅう','きゅう','はち','なな','ろく','ご','よん','さん','に','いち'];
for(let n=10;n>=1;n--){ctx.n=n;evaluate('run.left=n+1;run.leftMs=n*1000');ctx.tick()}
assert.deepEqual(said.map(s=>s.text),expected);
const inventory=new Set(ctx.timerVoicePlan({name:'朝',steps:[{name:'歯みがき',sec:90,texts:[]}]}));
for(const text of expected)assert(inventory.has(text));
console.log('PASS: exact minute/second start and halfway, message order, no duplicate/stale half, protected intro, Japanese-only countdown and matching preparation');
