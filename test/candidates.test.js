'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {scanCandidates}=require('../lib/achievement-candidates');
test('candidate scan only inspects Steam-confirmed owned games and never calls a write transport',async()=>{
  const visited=[];const client={steamID:{toString:()=> '76561198000000001'},getUserOwnedApps:async(_,options)=>{assert.deepEqual(options.filterAppids,[883710,550,3932890]);return {apps:[{appid:883710,name:'Owned hidden game'},{appid:550,name:'Owned progress game'},{appid:3932890,name:'Owned protected game'},{appid:999,name:'Not selected'}]};},_send:()=>{throw Error('No transport writes authorized');}};
  const report=await scanCandidates(client,[883710,550,3932890],{read:async(_,id)=>{visited.push(id);return {achievements:id===883710?[{apiname:'H',name:'Hidden',hidden:true,unlocked:false,compatibility:{canUnlock:true}}]:id===550?[{apiname:'P',unlocked:false,hasProgressDependency:true,compatibility:{canUnlock:false},progressDetails:{currentValue:3,maximum:10}}]:[{apiname:'S',unlocked:false,compatibility:{code:'server_controlled',canUnlock:false}}]};}});
  assert.equal(report.hidden.length,1);assert.equal(report.progress.length,1);assert.equal(report.protected.length,1);assert.ok(!visited.includes(999));assert.equal(report.hidden[0].appid,883710);
});
test('already unlocked, unknown and ineligible hidden achievements are not activation candidates',async()=>{
  const client={steamID:{toString:()=> '76561198000000001'},getUserOwnedApps:async()=>({apps:[{appid:550,name:'Owned'}]})};
  const report=await scanCandidates(client,[550],{read:async()=>({achievements:[{hidden:true,unlocked:true,compatibility:{canUnlock:false}},{hidden:true,unlocked:null,compatibility:{canUnlock:false}},{hidden:true,unlocked:false,hasProgressDependency:true,compatibility:{canUnlock:false}}]})});assert.deepEqual(report.hidden,[]);
});
test('account changes stop the read-only scan rather than attributing another library to this account',async()=>{
  const client={steamID:{toString:()=> '76561198000000001'},getUserOwnedApps:async()=>{client.steamID=null;return {apps:[]};}};await assert.rejects(scanCandidates(client,[550]),/account changed/);
});
