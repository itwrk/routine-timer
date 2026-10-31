const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const source=html.slice(html.indexOf('/* ============ RUN ============ */'),html.indexOf('/* ============ PROGRESS ============ */'));
let now=100000,alarms=0;
const elements=new Map();
function element(){return {style:{},dataset:{},children:[],set innerHTML(value){this.children=[]},classList:{toggle(){}},append(...items){this.children.push(...items)},appendChild(item){this.children.push(item)},setAttribute(){},removeAttribute(){}};}
const ctx={Date:class extends Date{static now(){return now}},document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement:element,querySelector:()=>element()},D:{xp:0,settings:{}},speechSynthesis:{cancel(){}},beep(){},speak(){alarms++},sfxDone(){},burst(){},toast(){},resetTwoTap(){},awardRewardPoints(){},claimJourneyForStart(){return ''}};
vm.createContext(ctx);vm.runInContext(source,ctx);
vm.runInContext(`finishRun=()=>{finished=run;run=null};stopRun=()=>{run=null};`,ctx);
const evaluate=s=>vm.runInContext(s,ctx);
function setup(){
 now=100000;alarms=0;ctx.D.xp=0;
 evaluate(`run={r:{id:'routine',name:'Test',steps:[{id:'a',name:'Water',sec:60,checklist:[{t:'Wash'}]},{id:'b',name:'Cage',sec:60}]},idx:0,ready:true,paused:true,microEntry:false,source:'normal',checklistMode:false,timerMode:'down',stepElapsedMs:0,stepRecords:[],startedAt:0};setRunMode(true);`);
}
setup();
assert.equal(evaluate('run.targetSec'),120);
for(const value of ['0','-1','1.5','NaN','1441']){ctx.value=value;evaluate('setChecklistMinutes(value)');assert.equal(evaluate('run.targetSec'),120);}
evaluate('setChecklistMinutes(1);setTimerMode("up");togglePause()');
now+=65000;evaluate('tick()');assert.equal(evaluate('run.stepElapsedMs'),65000);assert.equal(elements.get('runTime').textContent,'1:05');
evaluate('togglePause()');now+=120000;evaluate('tick()');assert.equal(evaluate('run.stepElapsedMs'),65000);
evaluate('togglePause()');now+=5000;evaluate('tick()');assert.equal(evaluate('run.stepElapsedMs'),70000);
// Completion remains user controlled, including after a background delay exceeds the countdown.
evaluate('setTimerMode("down")');now+=61000;evaluate('tick()');assert.equal(evaluate('run.left'),0);assert.equal(alarms,2); // Start announcement and time-up announcement.
now+=5000;evaluate('tick()');assert.equal(alarms,2);assert(evaluate('!!run'));
// Controls support arbitrary order, undoing checks, and independently checked subitems.
const rows=elements.get('routineChecklist').children;
const checkB=rows[1].children[0].children[0],checkA=rows[0].children[0].children[0],sub=rows[0].children[1].children[0];
checkB.checked=true;checkB.onchange();checkB.checked=false;checkB.onchange();
checkA.checked=true;checkA.onchange();sub.checked=true;sub.onchange();
assert.equal(evaluate('run.checklistDone.size'),1);assert.equal(ctx.D.xp,0);
assert.equal(elements.get('runRemain').textContent,'1 / 2');
evaluate('finishChecklistRun()');assert.equal(evaluate('finished.skips'),1);assert.equal(evaluate('finished.stepRecords[0].outcome'),'done');assert.equal(evaluate('finished.stepRecords[1].outcome'),'skipped');assert.equal(evaluate('finished.stepRecords[0].checklist[0].done'),true);assert.equal(ctx.D.xp,10);
evaluate('finishChecklistRun()');assert.equal(ctx.D.xp,10,'finishing twice must not duplicate rewards');
setup();evaluate('finishChecklistRun()');assert.equal(ctx.D.xp,0);assert.equal(evaluate('run'),null,'exit before playback without recording');
setup();evaluate('setTimerMode("up");togglePause();run.checklistDone.add("a");run.checklistDone.add("b");finishChecklistRun()');assert.equal(evaluate('finished.skips'),0);assert.equal(evaluate('finished.stepRecords[0].mode'),'checklist-countup');assert.equal(ctx.D.xp,20);
console.log('PASS: countdown validation, count-up, pause/resume, background expiry without auto-finish, reversible checks, subitems, early finish, reward idempotence, pre-start exit');
