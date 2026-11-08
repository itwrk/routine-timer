const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end));
const usage=section('/* ============ API USAGE START ============ */','/* ============ API USAGE END ============ */');
const ai=section('/* ============ OpenAI shared key ============ */','async function copyAiKey()');
const memory=section('/* ============ MEMORY START ============ */','/* ============ MEMORY END ============ */').replace(/\bmemoryInitEvents\(\);\s*$/,'');
const merge=section('function mergeMealCollections(local,remote)','function mealWaitRemainMs()');
function fixture(){
  const storage=new Map(),requests=[],nodes=new Map();let failStorage=false;
  const ctx={Blob,TextEncoder,Uint8Array,ArrayBuffer,DataView,AbortController,DOMException,atob,setTimeout,clearTimeout,
    KEY:'test_usage',D:{settings:{apiKey:'synthetic-secret'},apiUsage:[],routines:[]},
    localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){if(failStorage)throw Error('full');storage.set(k,v)},removeItem:k=>storage.delete(k)},
    document:{getElementById:id=>nodes.get(id)||null},navigator:{},toast(){},showScreen(){},scheduleAutoPush(){},
    fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({status:'completed',usage:{input_tokens:1000,input_tokens_details:{cached_tokens:200},output_tokens:300,output_tokens_details:{reasoning_tokens:250}},output:[{type:'message',content:[{type:'output_text',text:'完成'}]}]})}},window:{}};
  ctx.window=ctx;vm.createContext(ctx);
  vm.runInContext(usage+html.match(/const save=\(\)=>\{[^\n]+/)[0]+ai+memory,ctx);
  return{ctx,storage,requests,nodes,fail(){failStorage=true},evaluate:s=>vm.runInContext(s,ctx)};
}
const near=(a,b)=>assert(Math.abs(a-b)<1e-12,`${a} != ${b}`);
(async()=>{
  let f=fixture(),c=f.ctx;
  assert.equal(c.apiUsageMonthKey(Date.parse('2026-10-31T14:59:59Z')),'2026-10');
  assert.equal(c.apiUsageMonthKey(Date.parse('2026-10-31T15:00:00Z')),'2026-11');
  assert.equal(c.apiUsageMonthKey(Date.parse('2026-12-31T15:00:00Z')),'2027-01');
  const textUsage={input_tokens:1000,input_tokens_details:{cached_tokens:200},output_tokens:300};
  near(c.apiUsageTextCost({usage:textUsage}).usd,.00462);
  near(c.apiUsageTextCost({usage:textUsage,service_tier:'priority'}).usd,.00924);
  near(c.apiUsageTextCost({usage:{input_tokens:300000,output_tokens:100}}).usd,1.2015);
  near(c.apiUsageTextCost({usage:{input_tokens:12000,output_tokens:1000,input_tokens_details:{cached_tokens:4000,cache_write_tokens:7000,cache_write_tokens_details:{ttl_30m_tokens:3000,ttl_12h_tokens:4000}}}}).usd,.0399);
  near(c.apiUsageTextCost({usage:{input_tokens:10000,output_tokens:0,input_tokens_details:{cached_tokens:2000,cache_write_tokens:4000}}}).usd,.0182);
  assert(c.apiUsageTextCost({output:[]},'推定入力').estimated);
  near(c.apiUsageAudioCost('tts-1','あ'.repeat(1000),'',0).usd,.015);
  near(c.apiUsageAudioCost('tts-1-hd','a'.repeat(1000),'',0).usd,.03);
  const realtime={input_tokens:100,output_tokens:1030,input_token_details:{text_tokens:100,audio_tokens:0,cached_tokens:20,cached_tokens_details:{text_tokens:20,audio_tokens:0}},output_token_details:{text_tokens:30,audio_tokens:1000}};
  const cost=c.apiUsageAudioCost('gpt-realtime-2.1-mini','本文','',1,realtime);
  near(cost.usd,.0201212);assert.equal(cost.estimated,false);
  near(c.apiUsageAudioCost('gpt-realtime-2.1','本文','',1,realtime).usd,.065048);
  near(c.apiUsageAudioCost('gpt-realtime-1.5','本文','',1,realtime).usd,.064808);
  assert(c.apiUsageAudioCost('gpt-realtime-mini','本文','指示',60).estimated);
  assert(c.apiUsageAudioCost('gpt-4o-mini-tts','本文','指示',60).estimated);
  assert.equal(c.apiUsageAudioCost('unknown','本文','',10),null);
  // Capture returned usage before an incomplete result is rejected. HTTP rejects do not count.
  assert.equal(await c.aiRequest('private prompt',20,'private instructions'),'完成');
  assert.equal(c.D.apiUsage[0].calls,1);near(c.D.apiUsage[0].nanoUsd/1e9,.00462);
  c.fetch=async()=>({ok:true,json:async()=>({status:'incomplete',usage:textUsage})});
  await assert.rejects(c.aiRequest('private prompt'),/最後まで/);assert.equal(c.D.apiUsage[0].calls,2);
  c.fetch=async()=>({ok:false,status:401,json:async()=>({error:{message:'synthetic-secret'}})});
  await assert.rejects(c.aiRequest('private prompt'),/401/);assert.equal(c.D.apiUsage[0].calls,2);
  assert(!JSON.stringify(c.D.apiUsage).includes('synthetic-secret'));assert(!JSON.stringify(c.D.apiUsage).includes('private'));
  // Monthly buckets from distinct page writers add, while repeated sync and stale counters use max.
  const row=(writer,calls,nanoUsd,updatedAt=200)=>({id:writer+':2026-10:text',month:'2026-10',kind:'text',nanoUsd,calls,estimated:0,firstAt:100,updatedAt});
  const a=row('pageA',2,200),stale=row('pageA',1,100,999),b=row('pageB',1,50);
  let merged=c.apiUsageMerge([a],[stale,b]);assert.equal(merged.length,2);assert.equal(merged[0].nanoUsd,200);assert.equal(merged[0].calls,2);
  assert.equal(JSON.stringify(c.apiUsageMerge(merged,merged,[a,b])),JSON.stringify(merged));
  assert.equal(c.apiUsageMerge([{...a,nanoUsd:NaN},{...b,month:'2026-13'},{...a,calls:-1}]).length,0);
  // Existing same-browser records survive a stale page save and key changes; no key grouping.
  const stored=JSON.parse(f.storage.get('test_usage'));stored.apiUsage.push(b);f.storage.set('test_usage',JSON.stringify(stored));
  c.setOpenAIKey('synthetic-new-key');assert(c.D.apiUsage.some(row=>row.id===b.id));
  c.D.apiUsage=[];f.evaluate('save()');assert(c.D.apiUsage.some(row=>row.id===b.id));
  c.MERGE_COLLECTIONS=[];c.legacyXpOpeningCandidate=()=>0;c.isOpeningRewardPointEvent=()=>false;c.ensureOpeningRewardPointSnapshot=()=>{};
  vm.runInContext(merge,c);const remote={apiUsage:[a],rewardPointEvents:[]};c.mergeMealCollections({apiUsage:[b,stale]},remote);
  assert.equal(remote.apiUsage.find(row=>row.id===a.id).nanoUsd,200);assert(remote.apiUsage.some(row=>row.id===b.id));
  // REST audio counts generation once, even if later PCM validation rejects it.
  f=fixture();c=f.ctx;c.fetch=async(url,options)=>{f.requests.push({url,options});return {ok:true,blob:async()=>new Blob([new Uint8Array(48000)])}};
  const signal=new AbortController().signal,prefs={model:'gpt-4o-mini-tts',voice:'marin',tone:''};
  await c.memoryGenerateClip('本文',prefs,'synthetic-secret',signal);assert.equal(c.D.apiUsage[0].kind,'audio');assert.equal(c.D.apiUsage[0].estimated,1);assert.equal(c.D.apiUsage[0].calls,1);
  c.fetch=async()=>({ok:true,blob:async()=>new Blob([new Uint8Array(3)])});
  await assert.rejects(c.memoryGenerateClip('本文',prefs,'synthetic-secret',signal),/読み取れません/);assert.equal(c.D.apiUsage[0].calls,2);
  // Realtime reports detailed usage once, including incomplete generations. Cached clips are free.
  c.fetch=async()=>({ok:true,json:async()=>({value:'synthetic-ephemeral'})});let incomplete=false,cut=false;
  c.WebSocket=class{
    constructor(){queueMicrotask(()=>this.emit({type:'session.created'}))}
    emit(e){this.onmessage({data:JSON.stringify(e)})}
    send(json){const e=JSON.parse(json);if(e.type==='session.update')queueMicrotask(()=>this.emit({type:'session.updated'}));if(e.type==='response.create')queueMicrotask(()=>{this.emit({type:'response.output_audio.delta',delta:'AQI='});if(cut){this.onclose();return}const event={type:'response.done',response:{status:incomplete?'incomplete':'completed',usage:realtime}};this.emit(event);this.emit(event)})}
    close(){}
  };
  const clips=new Map();c.memoryStore=async(store,method,value)=>method==='get'?clips.get(value):(clips.set(value.id,value),value);
  // Stable cache hashing is exercised by the existing memory tests; isolate billing here.
  c.memoryClipId=async segment=>'id:'+segment.text;
  const rp={model:'gpt-realtime-2.1-mini',voice:'marin',tone:''};
  const before=c.D.apiUsage[0].calls;
  await c.memoryResolveLineClip({text:'キャッシュする行',line:0},rp,'synthetic-secret',signal);assert.equal(c.D.apiUsage[0].calls,before+1);
  await c.memoryResolveLineClip({text:'キャッシュする行',line:10},rp,'synthetic-secret',signal);assert.equal(c.D.apiUsage[0].calls,before+1);
  incomplete=true;await assert.rejects(c.memoryGenerateClip('途中',rp,'synthetic-secret',signal),/最後まで/);assert.equal(c.D.apiUsage[0].calls,before+2);
  cut=true;await assert.rejects(c.memoryGenerateClip('切断',rp,'synthetic-secret',signal),/切断/);assert.equal(c.D.apiUsage[0].calls,before+3);assert(c.D.apiUsage[0].estimated>=3);
  c.WebSocket.prototype.send=function(json){const e=JSON.parse(json);if(e.type==='session.update')queueMicrotask(()=>this.emit({type:'session.updated'}));if(e.type==='response.create')queueMicrotask(()=>this.emit({type:'error',error:{message:'rejected before generation'}}))};
  await assert.rejects(c.memoryGenerateClip('拒否',rp,'synthetic-secret',signal),/rejected/);assert.equal(c.D.apiUsage[0].calls,before+3);
  // Storage failures must not turn a successfully paid response into another retry/generation.
  f=fixture();f.fail();assert.equal(await f.ctx.aiRequest('本文'),'完成');assert(f.evaluate('apiUsageWarning').includes('保存できません'));
  console.log('PASS: JST month/year rollover, cached/reasoning/long-context token rates, all audio billing modes, partial/failed calls, same-key totals, compact idempotent sync, stale-tab saves, private ledger, cached reuse and storage failure isolation');
})().catch(error=>{console.error(error);process.exitCode=1});
