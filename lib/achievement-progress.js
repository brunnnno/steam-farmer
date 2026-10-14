'use strict';
const crypto=require('node:crypto');
const {inspectFloat}=require('./float-progress');
const integer=(v,fallback)=>v==null?fallback:/^-?\d+$/.test(String(v))&&Number.isSafeInteger(Number(v))?Number(v):NaN;
const flag=v=>v==null||['0','false'].includes(String(v).toLowerCase())?false:['1','true'].includes(String(v).toLowerCase())?true:null;
function inspectProgress(row,bit,definition,values,rows,index,options={}){
  const no=(code,reason)=>({canComplete:false,code,reason});
  if(row.unlocked!==false)return no('state_unavailable','A locked personal achievement state is required.');
  if(row.trustedServerUnknown)return no('insufficient_progress_data','The trusted-server declaration cannot be interpreted safely.');
  if(row.serverControlled)return no('protected_progress','This achievement requires server-controlled permissions.');
  if([row.permission,row.blockPermission].some(p=>p!=null&&String(p)!=='0')||flag(bit.bSetByTrustedGS)!==false)return no('protected_progress','The achievement permissions do not allow this client operation.');
  const expression=bit.progress?.value;
  if(!expression||expression.operation!=='statvalue'||typeof expression.operand1!=='string'||Object.keys(expression).some(k=>!['operation','operand1'].includes(k)))return no('complex_progress','Only a direct, single-stat progress expression is supported.');
  const name=expression.operand1;
  const linked=index?index.byName.get(name)||[]:Object.entries(definition.stats).filter(([,s])=>s?.name===name);
  if(linked.length!==1)return no('ambiguous_progress_stat','The linked progress statistic is missing or ambiguous.');
  const [key,stat]=linked[0],id=Number(key);
  if((index?index.numericCounts.get(id):Object.keys(definition.stats).filter(k=>/^\d+$/.test(k)&&Number(k)===id).length)!==1)return no('ambiguous_progress_stat','The linked statistic has ambiguous numeric identifiers.');
  const type=String(stat.type).toUpperCase();
  if(!/^\d+$/.test(key)||!Number.isInteger(id)||id<0||id>0xffffffff||id===row.statId||!['1','INT','2','FLOAT'].includes(type))return no('unsupported_progress_type','Only distinct INT or FLOAT progress statistics can be inspected. AVGRATE needs separate rate semantics.');
  if((stat.permission!=null&&String(stat.permission)!=='0')||flag(stat.bSetByTrustedGS)!==false)return no('protected_progress_stat','The linked progress statistic is protected or requires a trusted game server.');
  if(flag(stat.aggregated)!==false)return no('aggregated_progress','Aggregated progress is excluded from this single-achievement operation.');
  const references=value=>typeof value==='string'?value===name:value&&typeof value==='object'?Object.values(value).some(references):false;
  const shared=index?[...(index.references.get(name)||[])].some(api=>api!==row.apiname):rows.some(a=>a.apiname!==row.apiname&&references(a.progressExpression));
  if(!values.has(id))return no('progress_value_unavailable','Steam did not return a unique personal progress value.');
  if(['2','FLOAT'].includes(type))return {...inspectFloat(stat,bit.progress,values.get(id),shared,options),statId:id,statName:name,type:'FLOAT'};
  const before=values.get(id)|0,goal=integer(bit.progress.max_val,NaN),min=integer(stat.min,-2147483648),max=integer(stat.max,2147483647),maxChange=integer(stat.maxchange,0);
  if(flag(stat.incrementonly)===null||![goal,min,max,maxChange].every(Number.isInteger)||min<-2147483648||max>2147483647||min>max||maxChange<0||maxChange>2147483647||goal<1||goal>2147483647||before<0)return no('invalid_progress_constraints','The progress target or declared statistic constraints cannot be interpreted safely.');
  const after=Math.max(before,goal);
  if(before<min||before>max||after<min||after>max||(maxChange>0&&after-before>maxChange))return no('progress_bounds','The required counter update exceeds the declared bounds or maximum change. No multi-step update will be attempted.');
  const counter={statId:id,statName:name,type:'INT',before,after,goal,min,max,maxChange,incrementOnly:flag(stat.incrementonly)};
  if(shared)return {canComplete:false,canPreviewShared:true,code:'shared_progress_stat',reason:'This counter is shared with other achievements. Review the full impact before any group operation.',...counter};
  return {canComplete:true,code:'simple_int_progress',reason:'A single client-writable INT counter can be completed within the current schema constraints.',...counter};
}
function revision(snapshot,id,apiname){return crypto.createHash('sha256').update(JSON.stringify({id,apiname,crc:snapshot.crc_stats,stats:(snapshot.stats||[]).map(s=>[s.stat_id,s.stat_value]).sort((a,b)=>a[0]-b[0])})).update(Buffer.from(snapshot.schema)).digest('hex');}
function floatPreview(snapshot,id,apiname){
  const rows=require('./steam-protocol').parseSnapshot(snapshot,id).achievements,targets=rows.filter(row=>row.apiname===apiname);
  if(targets.length!==1||!targets[0].progressSupport?.canPreviewFloat)throw Object.assign(new Error(targets[0]?.progressSupport?.reason||'A verified decimal counter is unavailable.'),{status:409});
  const target=targets[0];
  return {appid:id,apiname,name:target.name,checkedAt:new Date().toISOString(),revision:revision(snapshot,id,apiname),canActivate:false,counter:target.progressSupport,message:'Read-only progress review. No statistics or achievements have been changed. A decimal attempt requires a fresh reviewed revision and persistent history.'};
}
function sharedPreview(snapshot,id,apiname){
  const fail=message=>Object.assign(new Error(message),{status:409});
  const rows=require('./steam-protocol').parseSnapshot(snapshot,id).achievements,targets=rows.filter(r=>r.apiname===apiname);
  if(targets.length!==1||!targets[0].progressSupport?.canPreviewShared)throw fail(targets[0]?.progressSupport?.reason||'No interpretable shared counter is available.');
  const target=targets[0],p=target.progressSupport;
  const references=value=>typeof value==='string'?value===p.statName:value&&typeof value==='object'?Object.values(value).some(references):false;
  const related=rows.filter(r=>references(r.progressExpression));
  if(related.length>64)throw fail('This counter affects more than 64 achievements. A bounded group review is not available.');
  const effects=related.map(row=>{
    const expression=row.progressExpression,direct=expression?.operation==='statvalue'&&expression.operand1===p.statName&&Object.keys(expression).every(k=>['operation','operand1'].includes(k)),goal=row.progressDetails?.maximum;
    const known=direct&&row.progressDetails?.interpreted&&row.progressSupport?.code!=='insufficient_progress_data'&&Number.isInteger(goal)&&goal>0&&goal<=2147483647&&typeof row.unlocked==='boolean';
    const protectedRow=row.compatibility?.status==='restricted'||['protected_progress','protected_progress_stat'].includes(row.progressSupport?.code);
    return {apiname:row.apiname,name:row.name,unlocked:row.unlocked,hidden:row.hidden,goal:known?goal:null,before:p.before,after:p.after,effect:!known?'unknown':protectedRow?'restricted':row.unlocked?'already_unlocked':p.after<goal?'progress_only':row.apiname===apiname||p.before<goal?'would_unlock':'unknown'};
  });
  return {appid:id,apiname,name:target.name,revision:revision(snapshot,id,apiname),counter:{statId:p.statId,statName:p.statName,before:p.before,after:p.after},effects,completeImpact:effects.every(e=>!['unknown','restricted'].includes(e.effect)),canActivate:false,message:'Read-only impact review. Shared-counter activation remains disabled until persistent group journaling and group verification are enabled.'};
}
module.exports={inspectProgress,revision,sharedPreview,floatPreview};
