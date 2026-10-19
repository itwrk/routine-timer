// No external calls or real credentials. Run with node tests/notion-bridge.test.cjs.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const sourceId='11111111111111111111111111111111',pageId='22222222222222222222222222222222',otherId='33333333333333333333333333333333',rootId='44444444444444444444444444444444';
const props={RVT_NOTION_KEY:'test-passphrase',NOTION_TOKEN:'test-token',RVT_NOTION_TASK_SOURCE:sourceId,RVT_NOTION_RECORD_SOURCE:sourceId,RVT_NOTION_COMMENT_SOURCE:sourceId};
const schema={id:sourceId,properties:{名前:{type:'title',title:{}},ステータス:{type:'select',select:{options:[{name:'春香ボール'},{name:'完了'}]}},締め切り:{type:'date'},優先度:{type:'select',select:{options:[{name:'高'}]}},'備考・注意事項':{type:'rich_text'}}};
const text=value=>[{type:'text',text:{content:value}}];
let task={object:'page',id:pageId,url:'https://www.notion.so/'+pageId,last_edited_time:'2026-10-19T07:00:00.000Z',parent:{data_source_id:sourceId},properties:{名前:{title:text('元のタスク')},ステータス:{select:{name:'春香ボール'}},締め切り:{date:{start:'2026-10-20'}},優先度:{select:{name:'高'}},'備考・注意事項':{rich_text:[{type:'mention',plain_text:'大切なメンション'}]}}};
let calls=[],created=0,createdChildren=[],queryResult,failCreate=0,omitVerification=false;
const properties={getProperty:key=>props[key]||null,setProperty(key,value){props[key]=value},deleteProperty(key){delete props[key]}};
const context={console,PropertiesService:{getScriptProperties:()=>properties},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},Utilities:{sleep(){}},ContentService:{MimeType:{JSON:'application/json'},createTextOutput:text=>({text,setMimeType(){return this}})},UrlFetchApp:{fetch(url,options){
  const path=url.replace('https://api.notion.com/v1/',''),method=options.method||'get',body=options.payload?JSON.parse(options.payload):undefined;calls.push({path,method,body});
  let data,status=200;
  if(path==='data_sources/'+sourceId)data=schema;
  else if(path==='data_sources/'+sourceId+'/query')data=queryResult||{results:[task],has_more:false};
  else if(path==='pages/'+pageId&&method==='patch'){Object.assign(task.properties,body.properties);task.last_edited_time='2026-10-19T08:00:00.000Z';data=task;}
  else if(path==='pages/'+pageId)data=task;
  else if(path.startsWith('blocks/'+pageId+'/children'))data={results:[{type:'paragraph',paragraph:{rich_text:text('本文の記録')}}],has_more:false};
  else if(path==='pages'&&method==='post'){created++;if(failCreate)status=failCreate;else{createdChildren=body.children;data={id:otherId,url:'https://www.notion.so/'+otherId};}}
  else if(path==='pages/'+otherId)data={id:otherId,url:'https://www.notion.so/'+otherId};
  else if(path.startsWith('blocks/'+otherId+'/children'))data={results:omitVerification?[]:createdChildren,has_more:false};
  else if(path==='data_sources/'+rootId||path==='databases/'+rootId)status=404;
  else if(path==='pages/'+rootId)data={object:'page',id:rootId,url:'https://www.notion.so/'+rootId,last_edited_time:'2026-10-19T07:00:00Z',properties:{title:{type:'title',title:text('個人の記録ページ')}}};
  else if(path.startsWith('blocks/'+rootId+'/children'))data={results:[{type:'paragraph',paragraph:{rich_text:text('ページに書いた記録')}}],has_more:false};
  else throw Error('Unexpected mock request: '+method+' '+path);
  return {getResponseCode:()=>status,getContentText:()=>JSON.stringify(data||{message:'private upstream error must not escape'})};
}}};
vm.createContext(context);vm.runInContext(fs.readFileSync('notion-bridge.gs','utf8'),context);
const send=(action,data={})=>JSON.parse(context.rvtNotionPost({postData:{contents:JSON.stringify({action,key:'test-passphrase',...data})}}).text);
assert.equal(context.rvtNotionGet({parameter:{action:'oldSync'}}),null);
assert.equal(context.rvtNotionPost({postData:{contents:'not JSON'}}),null);
assert.equal(context.rvtNotionPost({postData:{contents:JSON.stringify({data:{old:true}})}}),null);
let result=send('rvtNotionTasks',{key:'wrong'});assert.equal(result.error,'unauthorized');assert.equal(calls.length,0);
const status=JSON.parse(context.rvtNotionGet({parameter:{action:'rvtNotionStatus',key:'test-passphrase'}}).text);assert.equal(status.bridgeVersion,1);assert(status.tasks&&status.records&&status.comments);
result=send('rvtNotionTasks',{query:'テスト',status:'春香ボール',cursor:'next-page'});assert(result.ok);assert.equal(result.schema.status.type,'select');assert.equal(result.tasks[0].memo,'大切なメンション');
const query=calls.find(x=>x.path.endsWith('/query')).body;assert.equal(query.start_cursor,'next-page');assert.equal(query.filter.and[1].select.equals,'春香ボール');
calls=[];result=send('rvtNotionUpdateTask',{pageId,lastEditedAt:'old',changes:{title:'変更'}});assert.equal(result.error,'conflict');assert(!calls.some(x=>x.method==='patch'));
task.parent.data_source_id=otherId;calls=[];result=send('rvtNotionUpdateTask',{pageId,lastEditedAt:task.last_edited_time,changes:{title:'変更'}});assert.equal(result.error,'wrong_parent');assert(!calls.some(x=>x.method==='patch'));task.parent.data_source_id=sourceId;
calls=[];result=send('rvtNotionUpdateTask',{pageId,lastEditedAt:task.last_edited_time,changes:{title:'変更したタスク'}});assert(result.ok);assert.equal(result.task.title,'変更したタスク');assert.deepEqual(Object.keys(calls.find(x=>x.method==='patch').body.properties),['名前']);assert.equal(task.properties['備考・注意事項'].rich_text[0].type,'mention');
result=send('rvtNotionUpdateTask',{pageId,lastEditedAt:task.last_edited_time,changes:{status:'不明な選択肢'}});assert.equal(result.error,'invalid_input');
task.properties.締め切り.date={start:'2026-10-20',end:'2026-10-21'};result=send('rvtNotionUpdateTask',{pageId,lastEditedAt:task.last_edited_time,changes:{due:'2026-10-22'}});assert.equal(result.error,'invalid_input');
queryResult={results:[task,{...task,id:otherId,archived:true}],has_more:true};result=send('rvtNotionRecords',{since:'2026-10-01T00:00:00Z'});assert(result.ok);assert.equal(result.records.length,1);assert(result.records[0].text.includes('本文の記録'));assert.equal(result.truncated,true);
const comment={commentId:'comment-one',text:'記録に沿ったコメント😀'.repeat(250),sourceSummary:'直近30日・3件',generatedAt:'2026/10/19 17:00'};
result=send('rvtNotionSaveComment',comment);assert(result.ok);assert.equal(created,1);assert(createdChildren.every(b=>b.paragraph.rich_text[0].text.content.length<=2000));result=send('rvtNotionSaveComment',comment);assert(result.ok);assert.equal(created,1);
props.RVT_NOTION_RECORD_SOURCE=rootId;result=send('rvtNotionRecords',{});assert(result.ok);assert.equal(result.records[0].title,'個人の記録ページ');assert(result.records[0].text.includes('ページに書いた記録'));props.RVT_NOTION_RECORD_SOURCE=sourceId;
props.RVT_NOTION_COMMENT_SOURCE=rootId;result=send('rvtNotionSaveComment',{...comment,commentId:'page-target'});assert(result.ok);assert.equal(calls.filter(x=>x.path==='pages'&&x.method==='post').at(-1).body.parent.page_id,rootId);props.RVT_NOTION_COMMENT_SOURCE=sourceId;
omitVerification=true;result=send('rvtNotionSaveComment',{...comment,commentId:'uncertain'});assert.equal(result.error,'verify_failed');const beforeRetry=created;result=send('rvtNotionSaveComment',{...comment,commentId:'uncertain'});assert.equal(result.error,'uncertain_write');assert.equal(created,beforeRetry);omitVerification=false;
failCreate=403;result=send('rvtNotionSaveComment',{...comment,commentId:'denied'});assert.equal(result.error,'notion_http_403');assert(!props.RVT_NOTION_SAVED_denied);assert(!JSON.stringify(result).includes('test-token'));assert(!JSON.stringify(result).includes('private upstream'));
console.log('PASS: legacy passthrough, auth before requests, schema and pagination, narrow updates, conflicts, parent checks, deadlines, record filtering, verified/idempotent comment saves, uncertain outcomes, credential-safe errors');
