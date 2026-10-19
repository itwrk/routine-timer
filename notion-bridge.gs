/** Notion bridge for the existing sync GAS. See docs/notion-bridge-setup.md.
 * Credentials and target IDs belong in Script Properties, never in this file.
 */
var RVT_NOTION_LAST_CALL_ = 0;
function rvtNotionGet(e) {
  if (!e || !e.parameter || e.parameter.action !== 'rvtNotionStatus') return null;
  return rvtNotionReply_(function () {
    rvtNotionAuth_(e.parameter.key);
    var p = PropertiesService.getScriptProperties();
    if(!p.getProperty('NOTION_TOKEN')&&!p.getProperty('NOTION_API_KEY'))throw new Error('missing_token');
    return {bridgeVersion:1, tasks:!!p.getProperty('RVT_NOTION_TASK_SOURCE'), records:!!p.getProperty('RVT_NOTION_RECORD_SOURCE'), comments:!!p.getProperty('RVT_NOTION_COMMENT_SOURCE')};
  });
}
function rvtNotionPost(e) {
  var data;
  try { data = JSON.parse(e.postData.contents); } catch (_) { return null; }
  var actions = ['rvtNotionTasks','rvtNotionUpdateTask','rvtNotionRecords','rvtNotionSaveComment'];
  if (!data || actions.indexOf(data.action) < 0) return null;
  return rvtNotionReply_(function () {
    rvtNotionAuth_(data.key);
    if (data.action === 'rvtNotionTasks') return rvtNotionTasks_(data);
    if (data.action === 'rvtNotionRecords') return rvtNotionRecords_(data);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw new Error('busy');
    try { return data.action === 'rvtNotionUpdateTask' ? rvtNotionUpdateTask_(data) : rvtNotionSaveComment_(data); }
    finally { lock.releaseLock(); }
  });
}
function rvtNotionReply_(run) {
  var value;
  try { value = Object.assign({ok:true}, run()); }
  catch (error) {
    var code = String(error.message || 'bridge_error');
    var messages = {unauthorized:'連携用の合言葉を確認してください。',missing_token:'GASにNotionトークンが設定されていません。',missing_target:'GASに対象DBが設定されていません。',ambiguous_source:'複数のデータソースがあります。GASに対象データソースIDを設定してください。',invalid_input:'入力内容を確認してください。',wrong_parent:'設定されたタスクDBに属さないページは編集できません。',conflict:'Notion側で更新されています。再読み込みして内容を確認してください。',busy:'別の保存を処理中です。少し待ってください。',verify_failed:'保存結果を確認できませんでした。Notion側を確認してください。',uncertain_write:'前回の保存結果が未確定です。重複を避けるため、Notion側を確認してください。'};
    value = {ok:false,error:messages[code] ? code : /^notion_http_\d{3}$/.test(code) ? code : 'bridge_error',message:messages[code] || (/^notion_http_\d{3}$/.test(code) ? 'Notion APIエラー（'+code.slice(-3)+'）。権限・対象DB・接続設定を確認してください。' : 'Notion連携でエラーが発生しました。GASの設定を確認してください。')};
  }
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function rvtNotionAuth_(key) {
  var p = PropertiesService.getScriptProperties();
  var expected = p.getProperty('RVT_NOTION_KEY') || p.getProperty('SECRET') || (typeof SECRET === 'string' ? SECRET : '');
  if (!expected || !key || String(key) !== expected) throw new Error('unauthorized');
}
function rvtNotionApi_(path,method,body) {
  var p = PropertiesService.getScriptProperties(),token = p.getProperty('NOTION_TOKEN') || p.getProperty('NOTION_API_KEY');
  if (!token) throw new Error('missing_token');
  var wait = 350-(Date.now()-RVT_NOTION_LAST_CALL_); if (wait>0) Utilities.sleep(wait);
  RVT_NOTION_LAST_CALL_ = Date.now();
  var options = {method:method || 'get',headers:{Authorization:'Bearer '+token,'Notion-Version':'2025-09-03'},muteHttpExceptions:true};
  if (body !== undefined) { options.contentType='application/json';options.payload=JSON.stringify(body); }
  var res = UrlFetchApp.fetch('https://api.notion.com/v1/'+path,options);
  if (res.getResponseCode()<200 || res.getResponseCode()>=300) throw new Error('notion_http_'+res.getResponseCode());
  return JSON.parse(res.getContentText());
}
function rvtNotionId_(value) {
  var m = String(value || '').replace(/-/g,'').match(/[a-f0-9]{32}/i);
  if (!m) throw new Error('invalid_input'); return m[0].toLowerCase();
}
function rvtNotionSource_(property) {
  var value = PropertiesService.getScriptProperties().getProperty(property);
  if (!value) throw new Error('missing_target');
  var id = rvtNotionId_(value);
  try { return rvtNotionApi_('data_sources/'+id); }
  catch (error) { if (error.message !== 'notion_http_404') throw error; }
  var db = rvtNotionApi_('databases/'+id);
  if (!db.data_sources || db.data_sources.length !== 1) throw new Error('ambiguous_source');
  return rvtNotionApi_('data_sources/'+rvtNotionId_(db.data_sources[0].id));
}
function rvtNotionText_(rich) { return (rich || []).map(function(x){return x.plain_text || (x.text && x.text.content) || '';}).join(''); }
function rvtNotionRich_(text) {
  var chars=Array.from(String(text || '')),out=[];
  while(chars.length) out.push({type:'text',text:{content:chars.splice(0,900).join('')}});
  return out;
}
function rvtNotionSchema_(source) {
  var props=source.properties || {},p=PropertiesService.getScriptProperties();
  function find(setting,fallback,types) {
    var name=p.getProperty(setting) || fallback;
    if (props[name] && types.indexOf(props[name].type)>=0) return {name:name,type:props[name].type,options:(props[name][props[name].type] || {}).options || []};
    if (setting !== 'RVT_NOTION_TASK_TITLE') return null;
    var key=Object.keys(props).filter(function(k){return props[k].type==='title';})[0];
    return key ? {name:key,type:'title',options:[]} : null;
  }
  return {title:find('RVT_NOTION_TASK_TITLE','名前',['title']),status:find('RVT_NOTION_TASK_STATUS','ステータス',['status','select']),due:find('RVT_NOTION_TASK_DUE','締め切り',['date']),priority:find('RVT_NOTION_TASK_PRIORITY','優先度',['select']),memo:find('RVT_NOTION_TASK_MEMO','備考・注意事項',['rich_text'])};
}
function rvtNotionTask_(page,schema) {
  var props=page.properties || {};
  function prop(field){return field ? props[field.name] || {} : {};}
  function selected(field){var p=prop(field);return field && p[field.type] ? p[field.type].name || '' : '';}
  return {id:page.id,title:rvtNotionText_(prop(schema.title).title),status:selected(schema.status),due:prop(schema.due).date || null,priority:selected(schema.priority),memo:rvtNotionText_(prop(schema.memo).rich_text),url:page.url,lastEditedAt:page.last_edited_time};
}
function rvtNotionTasks_(data) {
  var source=rvtNotionSource_('RVT_NOTION_TASK_SOURCE'),schema=rvtNotionSchema_(source),query={page_size:30,sorts:[{timestamp:'last_edited_time',direction:'descending'}]},filters=[];
  if (!schema.title) throw new Error('invalid_input');
  if (data.query) filters.push({property:schema.title.name,title:{contains:String(data.query).slice(0,120)}});
  if (data.status && schema.status) { var f={property:schema.status.name}; f[schema.status.type]={equals:String(data.status)}; filters.push(f); }
  if(filters.length)query.filter=filters.length===1?filters[0]:{and:filters};
  if(data.cursor)query.start_cursor=String(data.cursor);
  var result=rvtNotionApi_('data_sources/'+rvtNotionId_(source.id)+'/query','post',query);
  return {schema:schema,tasks:(result.results || []).filter(function(p){return p.object==='page'&&!p.archived&&!p.in_trash;}).map(function(p){return rvtNotionTask_(p,schema);}),nextCursor:result.has_more?result.next_cursor:null};
}
function rvtNotionUpdateTask_(data) {
  var source=rvtNotionSource_('RVT_NOTION_TASK_SOURCE'),schema=rvtNotionSchema_(source),page=rvtNotionApi_('pages/'+rvtNotionId_(data.pageId));
  if(page.archived||page.in_trash||!page.parent||!page.parent.data_source_id||rvtNotionId_(page.parent.data_source_id)!==rvtNotionId_(source.id))throw new Error('wrong_parent');
  if(!data.lastEditedAt || data.lastEditedAt!==page.last_edited_time)throw new Error('conflict');
  var changes=data.changes || {},patch={},keys=Object.keys(changes);
  if(keys.some(function(k){return ['title','status','due','priority','memo'].indexOf(k)<0;}))throw new Error('invalid_input');
  keys.forEach(function(key){
    var field=schema[key],value=changes[key];if(!field)throw new Error('invalid_input');
    if(key==='title'||key==='memo'){
      if(typeof value!=='string'||value.length>(key==='title'?240:4000)||(key==='title'&&!value.trim()))throw new Error('invalid_input');
      var rich={};rich[field.type]=rvtNotionRich_(value);patch[field.name]=rich;
    }else if(key==='status'||key==='priority'){
      if(typeof value!=='string'||(value&&!field.options.some(function(o){return o.name===value;})))throw new Error('invalid_input');
      var selected={};selected[field.type]=value?{name:value}:null;patch[field.name]=selected;
    }else{
      var old=page.properties[field.name].date;
      if(old&&(old.end||old.time_zone))throw new Error('invalid_input');
      if(value!==null&&(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)||!Number.isFinite(Date.parse(value))))throw new Error('invalid_input');
      patch[field.name]={date:value?{start:value}:null};
    }
  });
  if(keys.length)rvtNotionApi_('pages/'+rvtNotionId_(page.id),'patch',{properties:patch});
  var verified=rvtNotionTask_(rvtNotionApi_('pages/'+rvtNotionId_(page.id)),schema);
  keys.forEach(function(k){if(k==='due'){if(Date.parse(verified.due&&verified.due.start || '')!==Date.parse(changes.due || '')&&String(verified.due&&verified.due.start || '')!==String(changes.due || ''))throw new Error('verify_failed');}else if(verified[k]!==changes[k])throw new Error('verify_failed');});
  return {task:verified,schema:schema};
}
function rvtNotionBlocks_(pageId) {
  var count=0,truncated=false;
  function read(id,depth){
    var result=rvtNotionApi_('blocks/'+rvtNotionId_(id)+'/children?page_size=100'),texts=[];
    if(result.has_more)truncated=true;
    (result.results || []).forEach(function(block){
      if(++count>100){truncated=true;return;}
      var content=block[block.type] || {},text=rvtNotionText_(content.rich_text || content.caption);
      if(['child_page','child_database','unsupported','synced_block','table_row'].indexOf(block.type)>=0)truncated=true;
      if(text)texts.push(text);
      if(block.has_children){if(depth<2&&count<100)texts.push(read(block.id,depth+1));else truncated=true;}
    });
    return texts.join('\n');
  }
  var text=read(pageId,0);if(text.length>6000){text=text.slice(0,6000);truncated=true;}
  return {text:text,truncated:truncated};
}
function rvtNotionRecords_(data) {
  var query={page_size:10,sorts:[{timestamp:'last_edited_time',direction:'descending'}]},result;
  if(data.since){if(!Number.isFinite(Date.parse(data.since)))throw new Error('invalid_input');query.filter={timestamp:'last_edited_time',last_edited_time:{on_or_after:data.since}};}
  try{var source=rvtNotionSource_('RVT_NOTION_RECORD_SOURCE');result=rvtNotionApi_('data_sources/'+rvtNotionId_(source.id)+'/query','post',query);}
  catch(error){
    if(error.message!=='notion_http_404')throw error;
    var id=rvtNotionId_(PropertiesService.getScriptProperties().getProperty('RVT_NOTION_RECORD_SOURCE')),page=rvtNotionApi_('pages/'+id);
    result={results:!data.since||Date.parse(page.last_edited_time)>=Date.parse(data.since)?[page]:[],has_more:false};
  }
  var records=[];
  (result.results || []).filter(function(page){return page.object==='page'&&!page.archived&&!page.in_trash;}).forEach(function(page){
    var title='',properties=[];
    Object.keys(page.properties || {}).forEach(function(name){
      var p=page.properties[name],value='';
      if(p.type==='title'){title=rvtNotionText_(p.title);return;}
      if(p.type==='rich_text')value=rvtNotionText_(p.rich_text);
      else if(p.type==='select'||p.type==='status')value=p[p.type]&&p[p.type].name || '';
      else if(p.type==='multi_select')value=(p.multi_select || []).map(function(x){return x.name;}).join('、');
      else if(p.type==='date')value=p.date ? p.date.start+(p.date.end?'〜'+p.date.end:'') : '';
      else if(p.type==='number')value=p.number===null?'':String(p.number);
      else if(p.type==='checkbox')value=p.checkbox?'はい':'いいえ';
      if(value)properties.push(name+': '+value.slice(0,1000));
    });
    var body=rvtNotionBlocks_(page.id);
    var text=(properties.join('\n')+'\n'+body.text).trim();
    records.push({title:title||'無題',text:text.slice(0,8000),updatedAt:page.last_edited_time,url:page.url,truncated:body.truncated||text.length>8000});
  });
  return {records:records,truncated:!!result.has_more};
}
function rvtNotionSaveComment_(data) {
  var id=String(data.commentId || ''),text=data.text;
  if(!/^[a-z0-9_-]{1,80}$/i.test(id)||typeof text!=='string'||!text.trim()||text.length>12000)throw new Error('invalid_input');
  var p=PropertiesService.getScriptProperties(),property='RVT_NOTION_SAVED_'+id,saved=p.getProperty(property);
  if(saved){if(saved==='pending')throw new Error('uncertain_write');return {pageUrl:saved};}
  var parent,titleName;
  try{var source=rvtNotionSource_('RVT_NOTION_COMMENT_SOURCE');parent={type:'data_source_id',data_source_id:source.id};titleName=Object.keys(source.properties || {}).filter(function(k){return source.properties[k].type==='title';})[0];}
  catch(error){
    if(error.message!=='notion_http_404')throw error;
    var parentPage=rvtNotionApi_('pages/'+rvtNotionId_(p.getProperty('RVT_NOTION_COMMENT_SOURCE')));
    if(parentPage.archived||parentPage.in_trash)throw new Error('invalid_input');
    parent={type:'page_id',page_id:parentPage.id};titleName='title';
  }
  if(!titleName)throw new Error('invalid_input');
  var props={};props[titleName]={title:rvtNotionRich_('AIコメント '+String(data.generatedAt || '').slice(0,32))};
  var paragraphs=rvtNotionRich_(text).map(function(part){return {object:'block',type:'paragraph',paragraph:{rich_text:[part]}};});
  if(data.sourceSummary)paragraphs.unshift({object:'block',type:'paragraph',paragraph:{rich_text:rvtNotionRich_(String(data.sourceSummary).slice(0,300))}});
  p.setProperty(property,'pending');
  var page;
  try{page=rvtNotionApi_('pages','post',{parent:parent,properties:props,children:paragraphs});}
  catch(error){if(/^notion_http_4\d{2}$/.test(error.message))p.deleteProperty(property);throw error;}
  var verified=rvtNotionApi_('pages/'+rvtNotionId_(page.id));
  if(!verified.url)throw new Error('verify_failed');
  var blocks=rvtNotionApi_('blocks/'+rvtNotionId_(page.id)+'/children?page_size=100');
  var actual=(blocks.results || []).slice(data.sourceSummary?1:0).map(function(block){return rvtNotionText_((block.paragraph || {}).rich_text);}).join('');
  if(blocks.has_more||actual!==text)throw new Error('verify_failed');
  p.setProperty(property,verified.url);
  return {pageUrl:verified.url};
}
