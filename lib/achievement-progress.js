'use strict';
const crypto=require('node:crypto');
const integer=(v,fallback)=>v==null?fallback:/^-?\d+$/.test(String(v))&&Number.isSafeInteger(Number(v))?Number(v):NaN;
const flag=v=>v==null||['0','false'].includes(String(v).toLowerCase())?false:['1','true'].includes(String(v).toLowerCase())?true:null;
function inspectProgress(row,bit,definition,values,rows){
  const no=(code,reason)=>({canComplete:false,code,reason});
  if(row.unlocked!==false)return no('state_unavailable','A locked personal achievement state is required.');
  if([row.permission,row.blockPermission].some(p=>p!=null&&String(p)!=='0'))return no('protected_progress','The achievement permissions do not allow this client operation.');
  const expression=bit.progress?.value;
  if(!expression||expression.operation!=='statvalue'||typeof expression.operand1!=='string'||Object.keys(expression).some(k=>!['operation','operand1'].includes(k)))return no('complex_progress','Only a direct, single-stat progress expression is supported.');
  const name=expression.operand1;
  const linked=Object.entries(definition.stats).filter(([,s])=>s.name===name);
  if(linked.length!==1)return no('ambiguous_progress_stat','The linked progress statistic is missing or ambiguous.');
  const [key,stat]=linked[0],id=Number(key);
  if(!/^\d+$/.test(key)||!Number.isInteger(id)||id<0||id>0xffffffff||id===row.statId||!['1','INT'].includes(String(stat.type).toUpperCase()))return no('unsupported_progress_type','Only a distinct INT progress statistic is supported.');
  if((stat.permission!=null&&String(stat.permission)!=='0')||flag(stat.bSetByTrustedGS)!==false)return no('protected_progress_stat','The linked progress statistic is protected or requires a trusted game server.');
  if(flag(stat.aggregated)!==false)return no('aggregated_progress','Aggregated progress is excluded from this single-achievement operation.');
  const references=value=>typeof value==='string'?value===name:value&&typeof value==='object'?Object.values(value).some(references):false;
  if(rows.some(a=>a.apiname!==row.apiname&&references(a.progressExpression)))return no('shared_progress_stat','This counter is shared with other achievements; changing it could affect them.');
  if(!values.has(id))return no('progress_value_unavailable','Steam did not return a unique personal progress value.');
  const before=values.get(id)|0,goal=integer(bit.progress.max_val,NaN),min=integer(stat.min,-2147483648),max=integer(stat.max,2147483647),maxChange=integer(stat.maxchange,0);
  if(flag(stat.incrementonly)===null||![goal,min,max,maxChange].every(Number.isInteger)||min<-2147483648||max>2147483647||min>max||maxChange<0||goal<1||goal>2147483647||before<0)return no('invalid_progress_constraints','The progress target or declared statistic constraints cannot be interpreted safely.');
  const after=Math.max(before,goal);
  if(before<min||before>max||after<min||after>max||(maxChange>0&&after-before>maxChange))return no('progress_bounds','The required counter update exceeds the declared bounds or maximum change. No multi-step update will be attempted.');
  return {canComplete:true,code:'simple_int_progress',reason:'A single client-writable INT counter can be completed within the current schema constraints.',statId:id,statName:name,before,after,goal};
}
function revision(snapshot,id,apiname){return crypto.createHash('sha256').update(JSON.stringify({id,apiname,crc:snapshot.crc_stats,stats:(snapshot.stats||[]).map(s=>[s.stat_id,s.stat_value]).sort((a,b)=>a[0]-b[0])})).update(Buffer.from(snapshot.schema)).digest('hex');}
module.exports={inspectProgress,revision};
