'use strict';
const {readProtocol}=require('./steam-protocol');
async function scanCandidates(client,configuredGames,{read=readProtocol,maxGames=12}={}) {
  if(!client?.steamID||typeof client.getUserOwnedApps!=='function')throw Error('The connected Steam session cannot retrieve the owned library.');
  const identity=client.steamID.toString();
  const current=()=>{if(client.steamID?.toString()!==identity)throw Error('Steam disconnected or the account changed during the read-only scan.');};
  const selected=[...new Set(configuredGames)].slice(0,32);
  if(!selected.length)return {state:'complete',scope:'Configured games only',ownedGames:[],games:[],hidden:[],progress:[],protected:[],checkedAt:new Date().toISOString()};
  const pending=client.getUserOwnedApps(client.steamID,{filterAppids:selected,includePlayedFreeGames:true,includeAppInfo:true,skipUnvettedApps:false});
  const job=String(client._currentJobID);let library;
  try{library=await pending;}finally{client._jobs?.delete?.(job);}
  current();
  if(!Array.isArray(library?.apps))throw Error('Steam did not return a usable owned-game list.');
  const owned=library.apps.filter(a=>selected.includes(a.appid));
  const preferred=[883710,1888930,3932890,1938090,271590,220240,379720,323470,3764200,550,240];
  owned.sort((a,b)=>(preferred.indexOf(a.appid)<0?99:preferred.indexOf(a.appid))-(preferred.indexOf(b.appid)<0?99:preferred.indexOf(b.appid)));
  const report={state:'complete',scope:'Steam-confirmed owned games from the panel and requested titles',ownedGames:owned.map(a=>({appid:a.appid,name:a.name||`AppID ${a.appid}`})),games:[],hidden:[],progress:[],protected:[],checkedAt:new Date().toISOString()};
  for(const game of owned.slice(0,maxGames)) {
    current();
    try {
      const result=await read(client,game.appid,{timeoutMs:6000});current();
      const rows=result.achievements||[];
      const hiddenRows=rows.filter(a=>a.hidden===true);
      const hiddenReasons={};
      for(const row of hiddenRows){const reason=row.unlocked===true?'already_unlocked':row.compatibility?.code||'unknown';hiddenReasons[reason]=(hiddenReasons[reason]||0)+1;}
      report.games.push({appid:game.appid,name:game.name,total:rows.length,hidden:hiddenRows.length,hiddenReasons,hiddenExamples:hiddenRows.filter(a=>a.unlocked!==true).slice(0,3).map(a=>({name:a.name,apiname:a.apiname,unlocked:a.unlocked,reason:a.compatibility?.code,permission:a.permission,blockPermission:a.blockPermission})),lockedHiddenEligible:rows.filter(a=>a.hidden===true&&a.unlocked===false&&a.compatibility?.canUnlock).length,progress:rows.filter(a=>a.hasProgressDependency).length,protected:rows.filter(a=>a.compatibility?.code==='server_controlled').length});
      for(const row of rows) {
        if(row.unlocked===true)continue;
        const entry={appid:game.appid,game:game.name||`AppID ${game.appid}`,apiname:row.apiname,name:row.name,description:row.description,hidden:row.hidden,unlocked:row.unlocked,compatibility:row.compatibility,progressDetails:row.progressDetails||null};
        if(row.hidden===true&&row.unlocked===false&&row.compatibility?.canUnlock&&report.hidden.length<4)report.hidden.push(entry);
        if(row.hasProgressDependency){report.progress.push(entry);report.progress.sort((a,b)=>Number(b.compatibility?.code==='progress_dependency')-Number(a.compatibility?.code==='progress_dependency'));report.progress=report.progress.slice(0,4);}
        if(row.compatibility?.code==='server_controlled'&&report.protected.length<4)report.protected.push(entry);
      }
    } catch(err) {current();report.games.push({appid:game.appid,name:game.name,error:err.status?err.message:'Steam did not return readable statistics.'});}
  }
  return report;
}
module.exports={scanCandidates};
