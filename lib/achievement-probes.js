'use strict';
const {requestSnapshot,parseSnapshot}=require('./steam-protocol');
const {prepare}=require('./achievement-writer');
const TARGETS=[{appid:1938090,apiname:'crocodile',expectedCode:'progress_dependency'},{appid:3932890,apiname:'PMC_ACHIEVEMENT',expectedCode:'server_controlled'}];
// Dry-run preparation only: never call the writer or send a store message.
async function runReadOnlyProbes(client,{read=requestSnapshot,targets=TARGETS}={}) {
  const identity=client?.steamID?.toString();
  if(!identity)throw Error('Steam is disconnected.');
  const current=()=>{if(client.steamID?.toString()!==identity)throw Error('The Steam account changed during the probes.');};
  const results=[];
  const stats=s=>JSON.stringify((s.stats||[]).map(a=>({id:a.stat_id,value:a.stat_value})).sort((a,b)=>a.id-b.id));
  for(const target of targets){
    current();
    try{
      const initial=await read(client,target.appid,{timeoutMs:6000});current();
      const row=parseSnapshot(initial,target.appid).achievements.find(a=>a.apiname===target.apiname);
      let rejection=null;
      try{prepare(initial,target.appid,target.apiname);}catch(err){rejection={code:err.diagnostic?.code||'unknown',reason:err.message};}
      let progressPreview=null;
      if(row?.hasProgressDependency)try{const plan=prepare(initial,target.appid,target.apiname,{allowProgress:true});progressPreview={supported:true,revision:plan.revision,changes:plan.progressChanges};}catch(err){progressPreview={supported:false,reason:err.message,code:err.diagnostic?.code};}
      const final=await read(client,target.appid,{timeoutMs:6000});current();
      const after=parseSnapshot(final,target.appid).achievements.find(a=>a.apiname===target.apiname);
      const unchanged=stats(initial)===stats(final)&&Buffer.from(initial.schema).equals(Buffer.from(final.schema))&&row?.unlocked===after?.unlocked;
      results.push({...target,name:row?.name,hidden:row?.hidden,before:row?.unlocked,after:after?.unlocked,progress:row?.progressDetails||null,progressPreview,rejection,unchanged,writesSent:0,outcome:rejection?.code===target.expectedCode&&unchanged?'passed':'inconclusive'});
    }catch(err){current();results.push({...target,outcome:'unavailable',message:err.status?err.message:'The live probe could not complete.',writesSent:0});}
  }
  return {checkedAt:new Date().toISOString(),mode:'read-only guard probes',results};
}
module.exports={runReadOnlyProbes};
