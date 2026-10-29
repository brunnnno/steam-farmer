'use strict';
const crypto=require('node:crypto');
const {appId}=require('./core');
const {uint}=require('./achievement-compatibility');
const {parseSnapshot,libraryCorroborates}=require('./steam-protocol');
const {inspectProgress,revision}=require('./achievement-progress');
const {decodeFloat,floatBits}=require('./float-progress');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const MAX_SELECTION=32,MAX_EFFECTS=64,MAX_BULK_SELECTION=8192;
function selection(input,options={}){
  const max=options?.bulk?MAX_BULK_SELECTION:(options?.max||MAX_SELECTION);
  if(!Array.isArray(input)||!input.length||input.length>max)throw fail(`Select between 1 and ${max} achievements in one game.`,400);
  const result=input.map(item=>{
    if(!item||typeof item.apiname!=='string'||!item.apiname||item.apiname.length>256||!['unlock','remove'].includes(item.action)||Object.keys(item).some(k=>!['apiname','action'].includes(k)))throw fail('Select a real achievement and an unlock or remove action.',400);
    return {apiname:item.apiname,action:item.action};
  }).sort((a,b)=>a.apiname.localeCompare(b.apiname));
  if(new Set(result.map(item=>item.apiname)).size!==result.length)throw fail('Each achievement may be selected only once.',400);
  return result;
}
function buildBulkSelection(snapshot,id,mode,receipts=new Map(),options={}){
  id=appId(id);
  if(!['unlock_all','lock_all','refresh_dates'].includes(mode))throw fail('Select unlock_all or lock_all for bulk achievement operations.',400);
  const context={},view=parseSnapshot(snapshot,id,context);
  if(!Object.hasOwn(snapshot,'crc_stats')||!uint(snapshot.crc_stats)||new Set(snapshot.stats.map(s=>s.stat_id)).size!==snapshot.stats.length||!snapshot.stats.every(s=>Object.hasOwn(s,'stat_id')&&Object.hasOwn(s,'stat_value')&&uint(s.stat_id)&&uint(s.stat_value)))throw fail('A complete, unique personal snapshot and a valid statistics version are required.');
  const byName=new Map(),bitCounts=new Map();
  for(const row of view.achievements){
    byName.set(row.apiname,byName.has(row.apiname)?null:row);
    const key=row.statId+':'+row.bitIndex;bitCounts.set(key,(bitCounts.get(key)||0)+1);
  }
  const filterSet=Array.isArray(options.filterNames)&&options.filterNames.length?new Set(options.filterNames.map(String)):null;
  const isValidBit=row=>Boolean(row&&byName.get(row.apiname)===row&&bitCounts.get(row.statId+':'+row.bitIndex)===1&&context.index.numericCounts.get(row.statId)===1);
  const isClientWritable=row=>isValidBit(row)&&!row.serverControlled&&!(Number(row.blockPermission||0)&2);
  const collect=allowRestricted=>{
    const list=[];
    for(const row of view.achievements){
      if(filterSet&&!filterSet.has(row.apiname))continue;
      if(!(allowRestricted?isValidBit(row):isClientWritable(row)))continue;
      if(mode==='lock_all'){
        if(row.unlocked===true)list.push({apiname:row.apiname,action:'remove'});
      }else if(mode==='refresh_dates'){
        if(row.unlocked===true)list.push({apiname:row.apiname,action:'unlock'});
      }else{
        if(row.unlocked===false||row.unlocked===null)list.push({apiname:row.apiname,action:'unlock'});
      }
    }
    return list;
  };
  let chosen=collect(mode==='lock_all'||Boolean(options.forceAll));
  if(!chosen.length&&!options.forceAll)chosen=collect(true);
  if(mode==='lock_all'&&options.forceLockAll){
    const existing=new Set(chosen.map(c=>c.apiname));
    for(const row of view.achievements){
      if(filterSet&&!filterSet.has(row.apiname))continue;
      if(!isValidBit(row)||existing.has(row.apiname))continue;
      if(row.unlocked===true||!chosen.length)chosen.push({apiname:row.apiname,action:'remove'});
    }
  }
  if(!chosen.length)throw fail(mode==='unlock_all'?'No locked achievements are available to unlock in this game.':mode==='refresh_dates'?'No unlocked achievements are available to refresh dates in this game.':'No unlocked achievements are available to lock in this game.',409);
  return selection(chosen,{bulk:true});
}
// Stable across JSONB key ordering. Only immutable provenance and reviewed raw changes are hashed.
function historyRevision(receipts,names){
  return crypto.createHash('sha256').update(JSON.stringify([...names].sort().map(name=>{
    const r=receipts.get(name);
    return [name,r?[r.operationId||null,r.checkedAt||null,r.verifiedAt||null,r.outcome,r.action||'unlock',r.before,r.after,r.statId,r.bitIndex,(r.progressChanges||[]).map(p=>[p.statId,p.statName,p.type||'INT',p.before,p.after,p.beforeRaw??null,p.afterRaw??null]).sort((a,b)=>a[0]-b[0])]:null];
  }))).digest('hex');
}
function prepareChanges(snapshot,id,input,receipts=new Map(),expectedRevision,options={}){
  const bulk=Boolean(options?.bulk),resetCounters=Boolean(options?.resetCounters),allowRetoggle=Boolean(options?.allowRetoggle)||bulk,forceFreshTimestamp=Boolean(options?.forceFreshTimestamp);
  const maxEffects=bulk?MAX_BULK_SELECTION:MAX_EFFECTS;
  id=appId(id);const selected=selection(input,{bulk}),context={},view=parseSnapshot(snapshot,id,context);
  if((!bulk&&!view.verified)||view.stateConflict||!Object.hasOwn(snapshot,'crc_stats')||!uint(snapshot.crc_stats)||new Set(snapshot.stats.map(s=>s.stat_id)).size!==snapshot.stats.length||!snapshot.stats.every(s=>Object.hasOwn(s,'stat_id')&&Object.hasOwn(s,'stat_value')&&uint(s.stat_id)&&uint(s.stat_value)))throw fail('A complete, unique personal snapshot and a valid statistics version are required.');
  const byName=new Map();for(const row of view.achievements){if(byName.has(row.apiname))byName.set(row.apiname,null);else byName.set(row.apiname,row);}
  const bitCounts=new Map();for(const row of view.achievements){const key=row.statId+':'+row.bitIndex;bitCounts.set(key,(bitCounts.get(key)||0)+1);}
  const requested=new Map(selected.map(item=>[item.apiname,item.action])),affected=new Map(),counters=new Map(),updates=new Map(),expectedValues=new Map(snapshot.stats.map(s=>[s.stat_id,s.stat_value])),explicitResetStats=new Map();
  const usable=row=>{
    if(!row||bitCounts.get(row.statId+':'+row.bitIndex)!==1||context.index.numericCounts.get(row.statId)!==1)throw fail('Every affected achievement must have unique, unrestricted client permissions.');
    if(!bulk&&(row.serverControlled||row.trustedServerUnknown||[row.permission,row.blockPermission].some(p=>p!=null&&String(p)!=='0')))throw fail('Every affected achievement must have unique, unrestricted client permissions.');
  };
  for(const item of selected){
    const row=byName.get(item.apiname),receipt=receipts.get(item.apiname);usable(row);
    if(!allowRetoggle&&receipt?.action==='remove'&&receipt.after===false&&!libraryCorroborates(snapshot.librarySummary,view.achievements.filter(a=>a.unlocked===true).length,view.achievements.length,receipt.verifiedAt||receipt.checkedAt))throw fail('This previous removal is awaiting an updated Steam library reading. Check it in Steam and refresh before reviewing another change to this achievement.');
    const effectiveUnlocked=(bulk&&(row.unlocked===null||options?.forceLockAll&&item.action==='remove'))?(item.action==='remove'):(forceFreshTimestamp&&item.action==='unlock'?false:row.unlocked);
    if(!bulk&&effectiveUnlocked!==(item.action==='remove'))throw fail('A selected achievement changed state. Refresh and select the current action again.');
    if(!bulk&&receipt&&!['confirmed','already_unlocked'].includes(receipt.outcome))throw fail('An affected achievement has an unresolved or rejected attempt. Review its history; retries are disabled.');
    if(!bulk&&item.action==='remove'&&!row.removalSupport?.canRemove)throw fail(row.removalSupport?.reason||'A verified, unrestricted personal achievement bit is required for removal.');
    if(!allowRetoggle&&item.action==='unlock'&&receipt&&!(receipt.action==='remove'&&receipt.after===false))throw fail('A previous activation requires review. Only a confirmed panel removal permits a new activation.');
    affected.set(row.apiname,row);
    // Clearing an achievement preserves all gameplay counters by default unless resetCounters is true.
    if(row.hasProgressDependency&&item.action==='unlock'){
      const p=inspectProgress({...row,unlocked:false},context.rowBits.get(row),context.definition,context.values,view.achievements,context.index,{allowSharedFloat:bulk,flexibleBounds:bulk});
      if(!p.canComplete&&!p.canPreviewShared&&!p.canPreviewFloat){
        if(!bulk)throw fail(p.reason||'This progress cannot be reviewed safely.');
        // In bulk/flexible mode, fall back to direct bit activation when the progress expression is non-standard or server-guarded.
        continue;
      }
      const initRaw=context.values.has(p.statId)?context.values.get(p.statId):0;
      let counter=counters.get(p.statId);
      if(!counter){counter={...p,beforeRaw:initRaw,afterRaw:initRaw,unlocks:[],resets:false};counters.set(p.statId,counter);}
      if(!bulk&&p.before>=p.goal)throw fail('A locked achievement already reaches its goal. Its inconsistent state requires review.');
      counter.unlocks.push(p.after);
    }else if(row.hasProgressDependency&&item.action==='remove'&&resetCounters){
      const p=inspectProgress({...row,unlocked:false},context.rowBits.get(row),context.definition,context.values,view.achievements,context.index,{allowSharedFloat:true,flexibleBounds:true});
      if(p.canComplete||p.canPreviewShared||p.canPreviewFloat){
        const refs=context.index.references.get(p.statName)||new Set();
        const allLocked=[...refs].every(name=>{const r=byName.get(name);return r&&(requested.get(name)==='remove'||(!requested.has(name)&&r.unlocked!==true));});
        let maxRemainingGoal=0;
        for(const name of refs){
          const r=byName.get(name);
          if(r&&requested.get(name)!=='remove'&&(requested.get(name)==='unlock'||r.unlocked===true)){
            const rp=inspectProgress({...r,unlocked:false},context.rowBits.get(r),context.definition,context.values,view.achievements,context.index,{allowSharedFloat:true,flexibleBounds:true});
            if(Number.isFinite(rp.goal)&&rp.goal>maxRemainingGoal)maxRemainingGoal=rp.goal;
          }
        }
        const minVal=Math.max(0,Number.isFinite(p.min)&&p.min>0?p.min:0);
        const targetVal=allLocked?minVal:Math.max(minVal,maxRemainingGoal);
        if(targetVal<p.before&&(allLocked||targetVal<p.goal)){
          const targetRaw=p.type==='FLOAT'?floatBits(targetVal):targetVal>>>0;
          if(uint(targetRaw))explicitResetStats.set(p.statId,targetRaw);
          if(!p.incrementOnly&&allLocked){
            const initRaw=context.values.has(p.statId)?context.values.get(p.statId):0;
            if(!counters.has(p.statId))counters.set(p.statId,{...p,beforeRaw:initRaw,afterRaw:initRaw,unlocks:[],resets:true,resetValue:targetVal});
          }
        }
      }else if(row.progressDetails?.statName){
        const linked=context.index.byName.get(row.progressDetails.statName)||[];
        if(linked.length===1){
          const sid=Number(linked[0][0]);
          if(uint(sid))explicitResetStats.set(sid,0);
        }
      }
    }
  }
  if(bulk&&resetCounters&&selected.some(s=>s.action==='remove')){
    const allUnlockedRemoved=view.achievements.every(a=>a.unlocked!==true||requested.get(a.apiname)==='remove');
    if(allUnlockedRemoved&&context.definition?.stats){
      for(const [k,stObj] of Object.entries(context.definition.stats)){
        if(!/^\d+$/.test(k)||!stObj)continue;
        const stType=String(stObj.type).toUpperCase();
        if(!['1','INT','2','FLOAT'].includes(stType))continue;
        const sid=Number(k);
        if(uint(sid)&&(context.values.get(sid)??0)!==0&&!(Number(stObj.permission||0)&2)&&String(stObj.bSetByTrustedGS||'0')!=='1'){
          if(!explicitResetStats.has(sid))explicitResetStats.set(sid,0);
        }
      }
    }
  }
  for(const [statId,counter] of [...counters.entries()]){
    const raw=counter.beforeRaw;
    let after=counter.type==='FLOAT'?(decodeFloat(raw)??0):raw|0;
    if(counter.resets&&!counter.unlocks.length)after=counter.resetValue;
    else if(counter.unlocks.length)after=Math.max(after,...counter.unlocks);
    if(!Number.isFinite(after)||after<counter.min||after>counter.max||counter.maxChange>0&&Math.abs(after-counter.before)>counter.maxChange||counter.incrementOnly&&after<counter.before){
      if(resetCounters&&selected.some(s=>s.action==='remove')){
        explicitResetStats.set(statId,0);
      }
      if(bulk){counters.delete(statId);continue;}
      throw fail('The reviewed counter change exceeds its bounds or does not permit decreasing progress.');
    }
    counter.after=after;counter.afterRaw=counter.type==='FLOAT'?floatBits(after):after>>>0;
    if(!uint(counter.afterRaw)){
      if(bulk){counters.delete(statId);continue;}
      throw fail('The proposed counter cannot be represented safely.');
    }
    const references=context.index.references.get(counter.statName)||new Set();
    let skipSharedCounter=false;
    const relatedRows=[];
    for(const name of references){
      const row=byName.get(name);
      if(!row){if(bulk){skipSharedCounter=true;break;}usable(row);}
      if(!bulk)usable(row);
      const p=inspectProgress({...row,unlocked:false},context.rowBits.get(row),context.definition,context.values,view.achievements,context.index,{allowSharedFloat:bulk,flexibleBounds:bulk});
      if(!p.canComplete&&!p.canPreviewShared&&!p.canPreviewFloat){
        if(bulk){skipSharedCounter=true;break;}
        throw fail('A related progress expression or permission prevents a complete impact review.');
      }
      const action=requested.get(name);
      if(!counter.resets&&action==='remove'){if(bulk){skipSharedCounter=true;break;}throw fail('An unlock counter update also affects a selected removal. Review these actions separately so removal preserves progress.');}
      if(action==='unlock'&&after<p.goal){if(bulk){skipSharedCounter=true;break;}throw fail('The proposed counter does not reach a selected unlock goal.');}
      if(!action&&row.unlocked===false&&after>=p.goal){if(bulk){skipSharedCounter=true;break;}throw fail('This counter would also unlock '+row.name+'. Add it to the selection before reviewing.');}
      if(!action&&row.unlocked===true&&counter.before>=p.goal&&after<p.goal){if(bulk){skipSharedCounter=true;break;}throw fail('Removing this progress would undo progress supporting another unlocked achievement.');}
      if(!bulk&&receipts.get(name)&&!['confirmed','already_unlocked'].includes(receipts.get(name).outcome))throw fail('A related achievement has an unresolved attempt. Review history first.');
      relatedRows.push([name,row]);
    }
    if(skipSharedCounter){counters.delete(statId);continue;}
    for(const [name,row] of relatedRows){
      affected.set(name,row);
      if(affected.size>maxEffects)throw fail(`This operation affects more than ${maxEffects} achievements. Select a smaller group.`);
    }
    if(counter.afterRaw!==counter.beforeRaw||!context.values.has(counter.statId)){updates.set(counter.statId,counter.afterRaw);expectedValues.set(counter.statId,counter.afterRaw);}
  }
  const autoBlocks=new Set();
  for(const item of selected){
    const row=byName.get(item.apiname),mask=(1<<row.bitIndex)>>>0;
    const baseExpected=expectedValues.has(row.statId)?expectedValues.get(row.statId):(context.values.get(row.statId)??0);
    const next=item.action==='unlock'?(baseExpected|mask)>>>0:(baseExpected&~mask)>>>0;
    expectedValues.set(row.statId,next);
    const isFloat=row.hasProgressDependency&&row.progressDetails?.type==='FLOAT';
    if(isFloat&&item.action==='unlock'&&!bulk)autoBlocks.add(row.statId);
    else{const current=updates.has(row.statId)?updates.get(row.statId):(context.values.get(row.statId)??0);updates.set(row.statId,item.action==='unlock'?(current|mask)>>>0:(current&~mask)>>>0);}
  }
  if([...autoBlocks].some(id=>updates.has(id)))throw fail('Decimal unlocks and explicit achievement changes in the same block need separate reviews.');
  const progressChanges=[...counters.values()].filter(p=>p.afterRaw!==p.beforeRaw||!context.values.has(p.statId)).map(p=>({statId:p.statId,statName:p.statName,type:p.type,before:p.before,after:p.after,beforeRaw:p.beforeRaw,afterRaw:p.afterRaw})).sort((a,b)=>a.statId-b.statId);
  const effects=[...affected.values()].map(row=>{
    const action=requested.get(row.apiname)||'progress',counter=progressChanges.find(p=>p.statName===row.progressDetails?.statName);
    const warning=action==='remove'&&row.removalSupport?.warning?(counter&&counter.after<counter.before?'Linked progress counter will also be reset to its minimum.':row.removalSupport.warning):undefined;
    const beforeState=bulk&&row.unlocked===null?false:row.unlocked;
    return {apiname:row.apiname,name:row.name,statId:row.statId,bitIndex:row.bitIndex,action,before:beforeState,after:action==='unlock'?true:action==='remove'?false:beforeState,progressChanges:counter?[counter]:[],...(warning?{warning}:{})};
  }).sort((a,b)=>a.apiname.localeCompare(b.apiname));
  const names=effects.map(e=>e.apiname),history=historyRevision(receipts,names),reviewed=crypto.createHash('sha256').update(JSON.stringify({steam:revision(snapshot,id,JSON.stringify(selected)),history,progressChanges,effects,...(bulk?{bulk:true,resetCounters}:{})})).digest('hex');
  if(expectedRevision!==undefined&&expectedRevision!==reviewed)throw fail('Steam data or recorded history changed after review. Review the current selection again.');
  const resetAllMap=new Map([...updates,...explicitResetStats]);
  return {appid:id,selection:selected,effects,progressChanges,revision:reviewed,historyRevision:history,names,view,expectedValues,...(bulk?{bulk:true,resetCounters}:{}),...(explicitResetStats.size?{resetAllStats:[...resetAllMap].map(([stat_id,stat_value])=>({stat_id,stat_value})).sort((a,b)=>a.stat_id-b.stat_id)}:{}),payload:{game_id:String(id),crc_stats:snapshot.crc_stats,explicit_reset:false,stats:[...updates].map(([stat_id,stat_value])=>({stat_id,stat_value})).sort((a,b)=>a.stat_id-b.stat_id)}};
}
function verifyChanges(initial,final,plan,ack){
  let view;try{view=parseSnapshot(final,plan.appid);}catch{return {confirmed:false,diagnostic:'verification_unavailable',effects:[],progress:[]};}
  const values=new Map(final.stats.map(s=>[s.stat_id,s.stat_value]));
  const schemaUnchanged=Buffer.from(initial.schema).equals(Buffer.from(final.schema)),unique=values.size===final.stats.length&&Object.hasOwn(final,'crc_stats')&&uint(final.crc_stats)&&final.stats.every(s=>Object.hasOwn(s,'stat_id')&&Object.hasOwn(s,'stat_value')&&uint(s.stat_id)&&uint(s.stat_value));
  const differences=[...new Set([...values.keys(),...plan.expectedValues.keys()])].filter(id=>(values.get(id)??0)!==(plan.expectedValues.get(id)??0));
  const expected=new Map(plan.effects.map(e=>[e.apiname,e.after])),before=new Map(plan.view.achievements.map(a=>[a.apiname,a.unlocked]));
  const other=view.achievements.filter(row=>row.unlocked!==(expected.has(row.apiname)?expected.get(row.apiname):before.get(row.apiname))).map(row=>row.apiname);
  const byApi=new Map();for(const r of view.achievements)byApi.set(r.apiname,byApi.has(r.apiname)?null:r);
  const effects=plan.effects.map(effect=>{const row=byApi.get(effect.apiname)||null;return {apiname:effect.apiname,observedUnlocked:row?.unlocked??null,verified:row?.unlocked===effect.after};});
  const progress=plan.progressChanges.map(p=>({statId:p.statId,observedRaw:values.get(p.statId)??null,verified:(values.get(p.statId)??0)===p.afterRaw}));
  const accepted=ack?.result===1&&ack.gameId===String(plan.appid)&&ack.stale===false&&Array.isArray(ack.rejectedStats)&&(plan.bulk||!ack.rejectedStats.length);
  const library=final.librarySummary||null,expectedCount=[...before].filter(([name,state])=>expected.has(name)?expected.get(name):state).length;
  const removalVerified=Boolean(plan.bulk)||!plan.effects.some(e=>e.action==='remove')||libraryCorroborates(library,expectedCount,before.size,plan.view.checkedAt);
  const confirmed=plan.bulk
    ?Boolean(accepted&&schemaUnchanged&&unique&&effects.every(e=>e.verified))
    :Boolean(accepted&&schemaUnchanged&&unique&&!differences.length&&!other.length&&effects.every(e=>e.verified)&&progress.every(p=>p.verified)&&removalVerified);
  return {confirmed,diagnostic:!accepted?'write_not_accepted':!schemaUnchanged||!unique||(!plan.bulk&&(differences.length||other.length))?'verification_conflict':!removalVerified?'library_verification_unavailable':null,effects,progress,librarySummary:library,unexpectedStatChanges:differences,otherAchievementChanges:other};
}
module.exports={selection,buildBulkSelection,historyRevision,prepareChanges,verifyChanges,MAX_SELECTION,MAX_EFFECTS,MAX_BULK_SELECTION};
