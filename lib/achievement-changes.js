'use strict';
const crypto=require('node:crypto');
const {appId}=require('./core');
const {uint}=require('./achievement-compatibility');
const {parseSnapshot}=require('./steam-protocol');
const {inspectProgress,revision}=require('./achievement-progress');
const {decodeFloat,floatBits}=require('./float-progress');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const MAX_SELECTION=32,MAX_EFFECTS=64;
function selection(input){
  if(!Array.isArray(input)||!input.length||input.length>MAX_SELECTION)throw fail('Select between 1 and 32 achievements in one game.',400);
  const result=input.map(item=>{
    if(!item||typeof item.apiname!=='string'||!item.apiname||item.apiname.length>256||!['unlock','remove'].includes(item.action)||Object.keys(item).some(k=>!['apiname','action'].includes(k)))throw fail('Select a real achievement and an unlock or remove action.',400);
    return {apiname:item.apiname,action:item.action};
  }).sort((a,b)=>a.apiname.localeCompare(b.apiname));
  if(new Set(result.map(item=>item.apiname)).size!==result.length)throw fail('Each achievement may be selected only once.',400);
  return result;
}
// Stable across JSONB key ordering. Only immutable provenance and reviewed raw changes are hashed.
function historyRevision(receipts,names){
  return crypto.createHash('sha256').update(JSON.stringify([...names].sort().map(name=>{
    const r=receipts.get(name);
    return [name,r?[r.operationId||null,r.checkedAt||null,r.verifiedAt||null,r.outcome,r.action||'unlock',r.before,r.after,r.statId,r.bitIndex,(r.progressChanges||[]).map(p=>[p.statId,p.statName,p.type||'INT',p.before,p.after,p.beforeRaw??null,p.afterRaw??null]).sort((a,b)=>a[0]-b[0])]:null];
  }))).digest('hex');
}
function prepareChanges(snapshot,id,input,receipts=new Map(),expectedRevision){
  id=appId(id);const selected=selection(input),context={},view=parseSnapshot(snapshot,id,context);
  if(!view.verified||!Object.hasOwn(snapshot,'crc_stats')||!uint(snapshot.crc_stats)||new Set(snapshot.stats.map(s=>s.stat_id)).size!==snapshot.stats.length||!snapshot.stats.every(s=>Object.hasOwn(s,'stat_id')&&Object.hasOwn(s,'stat_value')&&uint(s.stat_id)&&uint(s.stat_value)))throw fail('A complete, unique personal snapshot and a valid statistics version are required.');
  const byName=new Map();for(const row of view.achievements){if(byName.has(row.apiname))byName.set(row.apiname,null);else byName.set(row.apiname,row);}
  const bitCounts=new Map();for(const row of view.achievements){const key=row.statId+':'+row.bitIndex;bitCounts.set(key,(bitCounts.get(key)||0)+1);}
  const requested=new Map(selected.map(item=>[item.apiname,item.action])),affected=new Map(),counters=new Map(),updates=new Map(),expectedValues=new Map(snapshot.stats.map(s=>[s.stat_id,s.stat_value]));
  const usable=row=>{
    if(!row||bitCounts.get(row.statId+':'+row.bitIndex)!==1||row.serverControlled||row.trustedServerUnknown||[row.permission,row.blockPermission].some(p=>p!=null&&String(p)!=='0')||context.index.numericCounts.get(row.statId)!==1)throw fail('Every affected achievement must have unique, unrestricted client permissions.');
  };
  for(const item of selected){
    const row=byName.get(item.apiname),receipt=receipts.get(item.apiname);usable(row);
    if(row.unlocked!==(item.action==='remove'))throw fail('A selected achievement changed state. Refresh and select the current action again.');
    if(receipt&&receipt.outcome!=='confirmed')throw fail('An affected achievement has an unresolved or rejected attempt. Review its history; retries are disabled.');
    if(item.action==='remove'&&(!receipt||receipt.before!==false||receipt.after!==true||(receipt.action&&receipt.action!=='unlock')||receipt.statId!==row.statId||receipt.bitIndex!==row.bitIndex))throw fail('Only an activation confirmed by this panel with matching identifiers can be removed.');
    if(item.action==='unlock'&&receipt&&!(receipt.action==='remove'&&receipt.after===false))throw fail('A previous activation requires review. Only a confirmed panel removal permits a new activation.');
    affected.set(row.apiname,row);
    if(row.hasProgressDependency){
      const p=inspectProgress({...row,unlocked:false},context.rowBits.get(row),context.definition,context.values,view.achievements,context.index);
      if(!p.canComplete&&!p.canPreviewShared&&!p.canPreviewFloat)throw fail(p.reason||'This progress cannot be reviewed safely.');
      let counter=counters.get(p.statId);
      if(!counter){counter={...p,beforeRaw:context.values.get(p.statId),afterRaw:context.values.get(p.statId),removals:[],unlocks:[]};counters.set(p.statId,counter);}
      if(item.action==='unlock'){
        if(p.before>=p.goal)throw fail('A locked achievement already reaches its goal. Its inconsistent state requires review.');
        counter.unlocks.push(p.after);
      }else{
        const matches=receipt.progressChanges?.filter(c=>c.statId===p.statId&&c.statName===p.statName)||[],change=matches.length===1?matches[0]:null;
        const type=change?.type||'INT';
        if(!change||type!==p.type||!Number.isFinite(change.before)||!Number.isFinite(change.after))throw fail('The original counter change is unavailable. A bit-only removal would leave inconsistent progress.');
        const from=type==='FLOAT'?change.afterRaw:change.after>>>0,to=type==='FLOAT'?change.beforeRaw:change.before>>>0;
        if(!uint(from)||!uint(to)||from===to)throw fail('There is no safe recorded counter change to reverse.');
        if(type==='FLOAT'&&(decodeFloat(from)!==change.after||decodeFloat(to)!==change.before))throw fail('The recorded decimal values do not match their raw bits.');
        if(type==='INT'&&[change.before,change.after].some(v=>!Number.isInteger(v)||v<0||v>2147483647))throw fail('The recorded integer counter values are invalid.');
        if(!counter.removals.some(p=>p.from===from&&p.to===to))counter.removals.push({from,to});
      }
    }
  }
  for(const counter of counters.values()){
    let raw=counter.beforeRaw;const remaining=[...counter.removals];
    // Undo only a complete recorded chain. Never replace progress gained outside these selected operations.
    while(remaining.length){const next=remaining.findIndex(change=>change.from===raw);if(next<0)throw fail('Progress changed after activation, or another activation must be removed first. No counter overwrite is permitted.');const step=remaining.splice(next,1)[0];raw=step.to;}
    let after=counter.type==='FLOAT'?decodeFloat(raw):raw|0;
    if(counter.unlocks.length)after=Math.max(after,...counter.unlocks);
    if(!Number.isFinite(after)||after<counter.min||after>counter.max||counter.maxChange>0&&Math.abs(after-counter.before)>counter.maxChange||counter.incrementOnly&&after<counter.before)throw fail('The reviewed counter change exceeds its bounds or does not permit decreasing progress.');
    counter.after=after;counter.afterRaw=counter.type==='FLOAT'?floatBits(after):after>>>0;
    if(!uint(counter.afterRaw))throw fail('The proposed counter cannot be represented safely.');
    const references=context.index.references.get(counter.statName)||new Set();
    for(const name of references){const row=byName.get(name);usable(row);affected.set(name,row);
      if(affected.size>MAX_EFFECTS)throw fail('This operation affects more than 64 achievements. Select a smaller group.');
      const p=inspectProgress({...row,unlocked:false},context.rowBits.get(row),context.definition,context.values,view.achievements,context.index);
      if(!p.canComplete&&!p.canPreviewShared&&!p.canPreviewFloat)throw fail('A related progress expression or permission prevents a complete impact review.');
      const action=requested.get(name);
      if(action==='remove'&&after>=p.goal)throw fail('The proposed counter still reaches a selected removal goal. These actions need separate reviews.');
      if(action==='unlock'&&after<p.goal)throw fail('The proposed counter does not reach a selected unlock goal.');
      if(!action&&row.unlocked===false&&after>=p.goal)throw fail('This counter would also unlock '+row.name+'. Add it to the selection before reviewing.');
      if(!action&&row.unlocked===true&&counter.before>=p.goal&&after<p.goal)throw fail('Removing this progress would undo progress supporting another unlocked achievement.');
      if(receipts.get(name)&&receipts.get(name).outcome!=='confirmed')throw fail('A related achievement has an unresolved attempt. Review history first.');
    }
    if(counter.afterRaw!==counter.beforeRaw){updates.set(counter.statId,counter.afterRaw);expectedValues.set(counter.statId,counter.afterRaw);}
  }
  const autoBlocks=new Set();
  for(const item of selected){const row=byName.get(item.apiname),mask=(1<<row.bitIndex)>>>0,next=item.action==='unlock'?(expectedValues.get(row.statId)|mask)>>>0:(expectedValues.get(row.statId)&~mask)>>>0;expectedValues.set(row.statId,next);
    const isFloat=row.hasProgressDependency&&row.progressDetails.type==='FLOAT';
    if(isFloat&&item.action==='unlock')autoBlocks.add(row.statId);
    else{const current=updates.has(row.statId)?updates.get(row.statId):context.values.get(row.statId);updates.set(row.statId,item.action==='unlock'?(current|mask)>>>0:(current&~mask)>>>0);}
  }
  if([...autoBlocks].some(id=>updates.has(id)))throw fail('Decimal unlocks and explicit achievement changes in the same block need separate reviews.');
  const progressChanges=[...counters.values()].filter(p=>p.afterRaw!==p.beforeRaw).map(p=>({statId:p.statId,statName:p.statName,type:p.type,before:p.before,after:p.after,beforeRaw:p.beforeRaw,afterRaw:p.afterRaw})).sort((a,b)=>a.statId-b.statId);
  const effects=[...affected.values()].map(row=>{
    const action=requested.get(row.apiname)||'progress',counter=progressChanges.find(p=>p.statName===row.progressDetails?.statName);
    return {apiname:row.apiname,name:row.name,statId:row.statId,bitIndex:row.bitIndex,action,before:row.unlocked,after:action==='unlock'?true:action==='remove'?false:row.unlocked,progressChanges:counter?[counter]:[]};
  }).sort((a,b)=>a.apiname.localeCompare(b.apiname));
  const names=effects.map(e=>e.apiname),history=historyRevision(receipts,names),reviewed=crypto.createHash('sha256').update(JSON.stringify({steam:revision(snapshot,id,JSON.stringify(selected)),history,progressChanges,effects})).digest('hex');
  if(expectedRevision!==undefined&&expectedRevision!==reviewed)throw fail('Steam data or recorded history changed after review. Review the current selection again.');
  return {appid:id,selection:selected,effects,progressChanges,revision:reviewed,historyRevision:history,names,view,expectedValues,payload:{game_id:String(id),crc_stats:snapshot.crc_stats,explicit_reset:false,stats:[...updates].map(([stat_id,stat_value])=>({stat_id,stat_value})).sort((a,b)=>a.stat_id-b.stat_id)}};
}
function verifyChanges(initial,final,plan,ack){
  let view;try{view=parseSnapshot(final,plan.appid);}catch{return {confirmed:false,diagnostic:'verification_unavailable',effects:[],progress:[]};}
  const values=new Map(final.stats.map(s=>[s.stat_id,s.stat_value]));
  const schemaUnchanged=Buffer.from(initial.schema).equals(Buffer.from(final.schema)),unique=values.size===final.stats.length&&Object.hasOwn(final,'crc_stats')&&uint(final.crc_stats)&&final.stats.every(s=>Object.hasOwn(s,'stat_id')&&Object.hasOwn(s,'stat_value')&&uint(s.stat_id)&&uint(s.stat_value));
  const differences=[...new Set([...values.keys(),...plan.expectedValues.keys()])].filter(id=>values.get(id)!==plan.expectedValues.get(id));
  const expected=new Map(plan.effects.map(e=>[e.apiname,e.after])),before=new Map(plan.view.achievements.map(a=>[a.apiname,a.unlocked]));
  const other=view.achievements.filter(row=>row.unlocked!==(expected.has(row.apiname)?expected.get(row.apiname):before.get(row.apiname))).map(row=>row.apiname);
  const effects=plan.effects.map(effect=>{const matches=view.achievements.filter(a=>a.apiname===effect.apiname),row=matches.length===1?matches[0]:null;return {apiname:effect.apiname,observedUnlocked:row?.unlocked??null,verified:row?.unlocked===effect.after};});
  const progress=plan.progressChanges.map(p=>({statId:p.statId,observedRaw:values.get(p.statId)??null,verified:values.get(p.statId)===p.afterRaw}));
  const accepted=ack?.result===1&&ack.gameId===String(plan.appid)&&ack.stale===false&&Array.isArray(ack.rejectedStats)&&!ack.rejectedStats.length;
  return {confirmed:accepted&&schemaUnchanged&&unique&&!differences.length&&!other.length&&effects.every(e=>e.verified)&&progress.every(p=>p.verified),diagnostic:!accepted?'write_not_accepted':!schemaUnchanged||!unique||differences.length||other.length?'verification_conflict':null,effects,progress,unexpectedStatChanges:differences,otherAchievementChanges:other};
}
module.exports={selection,historyRevision,prepareChanges,verifyChanges,MAX_SELECTION,MAX_EFFECTS};
