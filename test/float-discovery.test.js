'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {ownedFloatLibrary,scanFloatBatch}=require('../lib/float-discovery');
const sid='76561198000000001';
test('decimal search retrieves only owned games, deduplicates IDs and prioritizes played titles',async()=>{
  let removed;const client={steamID:{toString:()=>sid},_currentJobID:12,_jobs:{delete:id=>removed=id},getUserOwnedApps:async(_,options)=>{assert.equal(options.includePlayedFreeGames,true);return {apps:[{appid:4,name:'Unplayed',playtime_forever:0},{appid:2,name:'Played',playtime_forever:1},{appid:2,name:'Duplicate'},{appid:-1}]};}};
  const library=await ownedFloatLibrary(client);assert.deepEqual(library.games,[{appid:2,name:'Played'},{appid:4,name:'Unplayed'}]);assert.equal(library.revision.length,64);assert.equal(removed,'12');
});
test('decimal batches bound reads, preserve unknown games and report eligible, protected and unlocked FLOATs',async()=>{
  const library={revision:'r',games:Array.from({length:12},(_,i)=>({appid:i+1,name:'Game '+i}))},visited=[];
  const row=(name,canPreview=false,unlocked=false)=>({name,apiname:name,unlocked,progressDetails:{type:'FLOAT',statName:'DISTANCE',currentValue:1.25,maximum:10.5},progressSupport:{canPreviewFloat:canPreview,reason:canPreview?'Read-only preview available':'Protected or not supported'}});
  const result=await scanFloatBatch({steamID:{toString:()=>sid}},library,0,{read:async(_,id,options)=>{visited.push(id);assert.equal(options.timeoutMs,1200);if(id===2)throw Error('Timeout');return {achievements:id===1?[row('Protected'),row('Already unlocked',false,true),row('Eligible',true),{progressDetails:{type:'INT'}}]:[]};}});
  assert.equal(visited.length,8);assert.equal(result.nextCursor,8);assert.equal(result.complete,false);assert.equal(result.candidates[0].name,'Eligible');assert.equal(result.candidates.length,3);assert.equal(result.games[1].readable,false);assert.equal(result.writesSent,0);
  const rest=await scanFloatBatch({steamID:{toString:()=>sid}},library,8,{read:async()=>({achievements:[]})});assert.equal(rest.nextCursor,12);assert.equal(rest.complete,true);
  await assert.rejects(scanFloatBatch({steamID:{toString:()=>sid}},library,-1));
});
test('decimal search stops when Steam identity changes and never attributes results to another account',async()=>{
  const client={steamID:{toString:()=>sid}},library={revision:'r',games:[{appid:1,name:'Owned'}]};
  await assert.rejects(scanFloatBatch(client,library,0,{read:async()=>{client.steamID=null;return {achievements:[]};}}),/Steam disconnected or changed/);
});
