'use strict';
const {createHash}=require('node:crypto');

const MAX_ROWS=8192,MAX_CHANGES=32,ROW_BYTES=16*1024,CONTEXT_BYTES=64*1024,TOTAL_BYTES=32*1024*1024;
const ROW_FIELDS=['id','apiname','name','description','unlocked','unlockTimestamp','unlockDate','hidden','serverControlled','statId','bitIndex','permission','blockPermission','trustedServerUnknown','hasProgressDependency','compatibility','progressDetails','progressSupport','removalSupport','batchSupport','lastWriteOutcome','panelOperationAt','panelVerifiedAt','stateEvidence'];
const CONTEXT_FIELDS=['readingMethod','source','outcome','verified','message','stateConflict','historyWarning'];
const IGNORED_FIELDS=new Set(['checkedAt','readDurationMs','durationMs','duration','percent','percentage','tier','icon','iconOpen','iconClosed','set_id','set_name','isDlc']);

function budgetError(){return Object.assign(new Error('Achievement synchronization exceeds its bounded comparison budget.'),{status:413,code:'achievement_sync_budget'});}
function boundedRows(rows){
  if(!Array.isArray(rows))throw new TypeError('Achievement synchronization requires an achievement array.');
  if(rows.length>MAX_ROWS)throw budgetError();
  return rows;
}
function project(object,fields){
  const result=Object.create(null);
  for(const field of fields)if(Object.hasOwn(object,field)&&object[field]!==undefined)result[field]=object[field];
  return result;
}
// Canonicalize only bounded, JSON-shaped values. Arbitrary response diagnostics,
// rarity data and timing fields are deliberately outside a personal revision.
function canonical(value,maxBytes){
  let bytes=0,nodes=0;const parts=[],parents=new Set();
  const push=text=>{bytes+=Buffer.byteLength(text);if(bytes>maxBytes)throw budgetError();parts.push(text);};
  const string=value=>{if(value.length>maxBytes-bytes)throw budgetError();push(JSON.stringify(value));};
  const visit=(item,depth)=>{
    if(++nodes>2048||depth>12)throw budgetError();
    if(item===null||item===undefined)return push('null');
    if(typeof item==='string')return string(item);
    if(typeof item==='boolean')return push(item?'true':'false');
    if(typeof item==='number'){if(!Number.isFinite(item))throw new TypeError('Achievement synchronization requires finite numeric values.');return push(String(item));}
    if(typeof item!=='object'||parents.has(item))throw new TypeError('Achievement synchronization requires acyclic JSON values.');
    parents.add(item);
    if(Array.isArray(item)){
      if(item.length>128)throw budgetError();push('[');
      for(let i=0;i<item.length;i++){if(i)push(',');visit(item[i],depth+1);}push(']');
    }else{
      const keys=[];
      for(const key in item)if(Object.hasOwn(item,key)&&!IGNORED_FIELDS.has(key)&&item[key]!==undefined){if(keys.length>=128)throw budgetError();keys.push(key);}
      keys.sort();push('{');
      for(let i=0;i<keys.length;i++){if(i)push(',');string(keys[i]);push(':');visit(item[keys[i]],depth+1);}push('}');
    }
    parents.delete(item);
  };
  visit(value,0);return {text:parts.join(''),bytes};
}

/** Stable personal-reading SHA256; unrelated rarity and read timings do not invalidate it. */
function revisionFor(view){
  if(!view||typeof view!=='object'||Array.isArray(view))throw new TypeError('Achievement synchronization requires a reading view.');
  const rows=boundedRows(view.achievements),context=canonical(project(view,CONTEXT_FIELDS),CONTEXT_BYTES);
  let bytes=context.bytes;const normalized=[];
  for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row))throw new TypeError('Achievement synchronization requires achievement objects.');
    const encoded=canonical(project(row,ROW_FIELDS),ROW_BYTES);bytes+=encoded.bytes+1;if(bytes>TOTAL_BYTES)throw budgetError();
    // Retain only a fixed-size digest for each row, then discard its bounded
    // canonical text. Sorting digests preserves duplicate multiplicity and
    // order independence without retaining a large serialized personal view.
    normalized.push(createHash('sha256').update(encoded.text).digest('hex'));
  }
  normalized.sort();const hash=createHash('sha256').update('achievement-sync-v2\n').update(context.text).update('\n');
  for(const row of normalized)hash.update(row).update('\n');
  return hash.digest('hex');
}

function textField(value,max=512){
  if(typeof value!=='string'||!value)return null;
  if(value.length>max||Buffer.byteLength(value)>max*4)throw budgetError();
  return value;
}
function bitIdentity(row){
  return Number.isInteger(row.statId)&&row.statId>=0&&row.statId<=0xffffffff&&Number.isInteger(row.bitIndex)&&row.bitIndex>=0&&row.bitIndex<=31?row.statId+':'+row.bitIndex:null;
}
function uniqueRows(rows){
  const names=new Map(),bits=new Map();
  for(const row of boundedRows(rows)){
    if(!row||typeof row!=='object'||Array.isArray(row))continue;
    const name=textField(row.apiname);if(!name)continue;
    names.set(name,names.has(name)?null:row);
    const bit=bitIdentity(row);if(bit)bits.set(bit,(bits.get(bit)||0)+1);
  }
  for(const [name,row]of names)if(row&&bits.get(bitIdentity(row))>1)names.set(name,null);
  return names;
}
function progressValue(row){
  const progress=row.progressDetails;if(!progress||progress.interpreted===false)return null;
  const statName=textField(progress.statName),declaredType=String(progress.type||'').toUpperCase();
  const type=declaredType==='1'?'INT':declaredType==='2'?'FLOAT':declaredType;
  if(!statName||!['INT','FLOAT'].includes(type)||!Number.isFinite(progress.currentValue)||!Number.isFinite(progress.maximum))return null;
  const value=type==='FLOAT'?Math.fround(progress.currentValue):progress.currentValue;
  if(!Number.isFinite(value)||type==='INT'&&!Number.isSafeInteger(value))return null;
  return {statName,type,maximum:progress.maximum,value};
}

/**
 * Returns {changes, counts:{unlock,remove,progress}, total, truncated}.
 * Changes have {apiname,name,kind,before,after}; progress additionally includes
 * {statName,type,maximum}. These are observed transitions, never write receipts
 * or inferred unlock dates. Unknown/new/removed/ambiguous schema rows are omitted.
 */
function changesBetween(beforeRows,afterRows,{limit=8}={}){
  if(!Number.isInteger(limit)||limit<0)throw new RangeError('The observed-change limit must be a nonnegative integer.');
  limit=Math.min(limit,MAX_CHANGES);
  const before=uniqueRows(beforeRows),after=uniqueRows(afterRows),matched=[],counts={unlock:0,remove:0,progress:0};let total=0;
  for(const [apiname,row] of after){
    const old=before.get(apiname);if(!old||!row||typeof old.unlocked!=='boolean'||typeof row.unlocked!=='boolean')continue;
    const oldBit=bitIdentity(old),newBit=bitIdentity(row);
    if(oldBit!==newBit)continue;
    const stateChanged=old.unlocked!==row.unlocked;
    const oldProgress=progressValue(old),newProgress=progressValue(row);
    const progChanged=Boolean(oldProgress&&newProgress&&oldProgress.statName===newProgress.statName&&oldProgress.type===newProgress.type&&oldProgress.maximum===newProgress.maximum&&oldProgress.value!==newProgress.value);
    if(stateChanged||progChanged)matched.push({apiname,old,row,stateChanged,oldProgress,newProgress,progChanged});
  }
  matched.sort((a,b)=>a.apiname<b.apiname?-1:a.apiname>b.apiname?1:0);
  const changes=[];
  const add=(row,kind,from,to,extra={})=>{
    counts[kind]++;total++;
    if(changes.length<limit)changes.push({apiname:row.apiname,name:textField(row.name,1024)||row.apiname,kind,before:from,after:to,...extra});
  };
  for(const item of matched){
    if(item.stateChanged)add(item.row,item.row.unlocked?'unlock':'remove',item.old.unlocked,item.row.unlocked);
    if(item.progChanged)add(item.row,'progress',item.oldProgress.value,item.newProgress.value,{statName:item.newProgress.statName,type:item.newProgress.type,maximum:item.newProgress.maximum});
  }
  return {changes,counts,total,truncated:total>changes.length};
}
module.exports={revisionFor,changesBetween};
