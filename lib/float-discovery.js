'use strict';
const crypto=require('node:crypto');
const {readProtocol}=require('./steam-protocol');
async function ownedFloatLibrary(client){
  if(!client?.steamID||typeof client.getUserOwnedApps!=='function')throw Error('Connect the main Steam account to search its library.');
  const identity=client.steamID.toString();
  let library;const pending=client.getUserOwnedApps(client.steamID,{includeAppInfo:true,includePlayedFreeGames:true,skipUnvettedApps:false}),job=String(client._currentJobID);
  try{library=await pending;}finally{client._jobs?.delete?.(job);}
  if(client.steamID?.toString()!==identity)throw Error('The Steam account changed during library reading.');
  if(!Array.isArray(library?.apps)||library.apps.length>8192)throw Error('Steam did not return a bounded owned library.');
  const unique=new Map();
  for(const app of library.apps){if(Number.isInteger(app.appid)&&app.appid>0&&app.appid<=0xffffffff&&!unique.has(app.appid))unique.set(app.appid,{appid:app.appid,name:String(app.name||`AppID ${app.appid}`).slice(0,128),played:Number(app.playtime_forever)||0});}
  const games=[...unique.values()].sort((a,b)=>Number(b.played>0)-Number(a.played>0)||a.appid-b.appid).map(({appid,name})=>({appid,name}));
  return {games,revision:crypto.createHash('sha256').update(JSON.stringify(games)).digest('hex')};
}
async function scanFloatBatch(client,library,cursor,{read=readProtocol}={}){
  if(!Number.isInteger(cursor)||cursor<0||cursor>library.games.length)throw Error('Invalid decimal search position.');
  const identity=client?.steamID?.toString(),current=()=>{if(!identity||client.steamID?.toString()!==identity)throw Error('Steam disconnected or changed during decimal search.');};
  const candidates=[],games=[];current();
  for(const game of library.games.slice(cursor,cursor+8)){
    try{
      const view=await read(client,game.appid,{timeoutMs:1200});current();
      const decimals=(view.achievements||[]).filter(row=>['2','FLOAT'].includes(row.progressDetails?.type)).sort((a,b)=>Number(b.progressSupport?.canPreviewFloat===true)-Number(a.progressSupport?.canPreviewFloat===true));
      games.push({appid:game.appid,name:game.name,decimalCount:decimals.length,readable:true});
      for(const row of decimals.slice(0,4))candidates.push({appid:game.appid,game:game.name,apiname:row.apiname,name:row.name,unlocked:row.unlocked,before:row.progressDetails.currentValue,goal:row.progressDetails.maximum,statName:row.progressDetails.statName,canPreview:row.progressSupport?.canPreviewFloat===true,reason:row.progressSupport?.reason||row.compatibility?.reason||'Personal decimal state needs verification.'});
    }catch(error){current();games.push({appid:game.appid,name:game.name,readable:false,message:error.status?error.message:'Steam statistics could not be read. This game has not been ruled out.'});}
  }
  const nextCursor=cursor+games.length;
  candidates.sort((a,b)=>Number(b.canPreview)-Number(a.canPreview));
  return {revision:library.revision,cursor,nextCursor,totalGames:library.games.length,complete:nextCursor===library.games.length,games,candidates:candidates.slice(0,16),checkedAt:new Date().toISOString(),writesSent:0};
}
module.exports={ownedFloatLibrary,scanFloatBatch};
