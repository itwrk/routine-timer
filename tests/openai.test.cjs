const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const source=html.slice(html.indexOf('/* ============ OpenAI shared key ============ */'),html.indexOf('async function copyAiKey()'));
function fixture(current='',legacy=''){
  const storage=new Map([['rvt_memory_openai_key_v1',legacy]]),nodes=new Map(),requests=[];
  const ctx={D:{settings:{apiKey:current}},KEY:'rvt_v1',localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},document:{getElementById(id){if(!nodes.has(id))nodes.set(id,{});return nodes.get(id)}},toast(){},showScreen(){},fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({status:'completed',output:[{type:'reasoning',content:[]},{type:'message',content:[{type:'output_text',text:'["できた"]'}]}]})}}};
  vm.createContext(ctx);vm.runInContext(source,ctx);return{ctx,storage,nodes,requests};
}
(async()=>{
  let f=fixture('sk-ant-old','synthetic-openai-key');
  assert.equal(f.ctx.getOpenAIKey(),'synthetic-openai-key');assert(!f.storage.has('rvt_memory_openai_key_v1'));
  f.ctx.setOpenAIKey('common-replacement');assert.equal(f.nodes.get('memApiKey').value,'common-replacement');assert.equal(f.nodes.get('setApiKey').value,'common-replacement');
  assert.throws(()=>f.ctx.setOpenAIKey('sk-ant-wrong'),/OpenAI/);assert.equal(f.ctx.getOpenAIKey(),'common-replacement');
  assert.equal(await f.ctx.aiRequest('本文',600,'文章だけ'), '["できた"]');
  let req=f.requests[0],body=JSON.parse(req.options.body);
  assert.equal(req.url,'https://api.openai.com/v1/responses');assert.equal(req.options.headers.Authorization,'Bearer common-replacement');assert.equal(body.store,false);assert.equal(body.input,'本文');assert.equal(body.instructions,'文章だけ');assert.equal(body.model,'gpt-6.1-sol');assert.equal(body.reasoning.effort,'low');
  for(const staleModel of ['gpt-6-luna','unknown-model']){
    f.ctx.D.settings.aiModel=staleModel;await f.ctx.aiRequest('次');assert.equal(JSON.parse(f.requests.at(-1).options.body).model,'gpt-6.1-sol','stale settings must never send requests to another text model');
  }
  f.ctx.fetch=async()=>({ok:false,status:401,json:async()=>({error:{message:'bad common-replacement'}})});
  await assert.rejects(f.ctx.aiRequest('x'),e=>!e.message.includes('common-replacement')&&e.message.includes('401'));
  assert(!f.ctx.aiErrorMessage(Error('common-replacement')).includes('common-replacement'));
  f=fixture('current-openai','older-memory-key');assert.equal(f.ctx.getOpenAIKey(),'current-openai');
  f=fixture('sk-ant-old');assert.equal(f.ctx.getOpenAIKey(),'');
  await assert.rejects(f.ctx.aiRequest('x'),/nokey/);assert.equal(f.requests.length,0);
  assert(!html.includes('api.anthropic.com'));assert(!html.includes('anthropic-dangerous-direct-browser-access'));
  console.log('PASS: shared OpenAI key migration, both settings fields, Claude key rejection, Responses schema/models/output, error redaction, no Anthropic requests');
})().catch(e=>{console.error(e);process.exitCode=1});
