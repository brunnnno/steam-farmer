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
      if(row?.hasProgressDependency)try{const plan=prepare(initial,target.appid,target.apiname,{allowProgress:true});progressPreview=plan.payload?{supported:true,revision:plan.revision,changes:plan.progressChanges}:{supported:false,code:'already_unlocked',reason:'This achievement is already unlocked. No update is needed.'};}catch(err){progressPreview={supported:false,reason:err.message,code:err.diagnostic?.code};}
      const final=await read(client,target.appid,{timeoutMs:6000});current();
      const after=parseSnapshot(final,target.appid).achievements.find(a=>a.apiname===target.apiname);
      const unchanged=stats(initial)===stats(final)&&Buffer.from(initial.schema).equals(Buffer.from(final.schema))&&row?.unlocked===after?.unlocked;
      results.push({...target,name:row?.name,hidden:row?.hidden,before:row?.unlocked,after:after?.unlocked,progress:row?.progressDetails||null,progressPreview,rejection,unchanged,writesSent:0,outcome:row?.unlocked===true&&after?.unlocked===true&&unchanged?'observed_unlocked':rejection?.code===target.expectedCode&&unchanged?'passed':'inconclusive'});
    }catch(err){current();results.push({...target,outcome:'unavailable',message:err.status?err.message:'The live probe could not complete.',writesSent:0});}
  }
  return {checkedAt:new Date().toISOString(),mode:'read-only guard probes',results};
}
async function runSharedImpactProbes(client){
  const identity=client?.steamID?.toString(),current=()=>{if(!identity||client.steamID?.toString()!==identity)throw Error('Steam changed during the shared-counter review.');};
  const selected=[550,240,8870,1250,218620,440,620,1938090,271590];
  current();const owned=await client.getUserOwnedApps(client.steamID,{filterAppids:selected,includePlayedFreeGames:true,includeAppInfo:true,skipUnvettedApps:false});current();const results=[];
  for(const game of (owned.apps||[]).filter(a=>selected.includes(a.appid)).slice(0,9)){
    try{const snapshot=await requestSnapshot(client,game.appid,{timeoutMs:6000});current();const view=parseSnapshot(snapshot,game.appid),target=view.achievements.find(a=>a.progressSupport?.canPreviewShared);
      if(target){const review=require('./achievement-progress').sharedPreview(snapshot,game.appid,target.apiname);results.push({game:game.name,...review,writesSent:0});}
      else {const reasons={};for(const row of view.achievements.filter(a=>a.hasProgressDependency&&a.unlocked!==true)){const reason=row.progressSupport?.code||'unknown';reasons[reason]=(reasons[reason]||0)+1;}results.push({appid:game.appid,game:game.name,message:'No interpretable locked shared-counter candidate was returned.',reasons,writesSent:0});}
    }catch(err){current();results.push({appid:game.appid,game:game.name,message:err.status?err.message:'The shared-counter reading is unavailable.',writesSent:0});}
  }
  return {checkedAt:new Date().toISOString(),results};
}
module.exports={runReadOnlyProbes,runSharedImpactProbes};
