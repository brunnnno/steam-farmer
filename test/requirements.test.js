'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {parseRequirements,gameRequirements}=require('../lib/game-requirements');
test('external launcher and publisher account requirements are context, not an activation ban',()=>{
  const result=parseRequirements(123,{123:{success:true,data:{categories:[{id:22}],ext_user_account_notice:'Publisher Account'}}},'<div class="DRM_notice">Requires Third Party Launcher</div>');
  assert.equal(result.externalAccountOrSoftware,true);assert.equal(result.launcherReported,true);assert.equal(result.steamAchievements,true);assert.match(result.explanation,/alone does not establish/);assert.equal(result.canUnlock,undefined);
});
test('unknown store data never invents a launcher restriction or absence of Steam achievements',()=>{
  const result=parseRequirements(123,{},'<html>Age verification</html>');assert.equal(result.metadataAvailable,false);assert.equal(result.launcherReported,false);assert.equal(result.steamAchievements,null);assert.match(result.explanation,/has not been established/);assert.deepEqual(result.facts,[]);
});
test('Tarkov context names the established Battlestate requirement without claiming publisher progress access',()=>{
  const result=parseRequirements(3932890,{});assert.match(result.facts[0],/Battlestate/);assert.match(result.explanation,/cannot verify account linking/);assert.equal(result.launcherReported,false);
});
test('metadata fetches run together, remain bounded and tolerate store unavailability',async()=>{
  const called=[];let release;const gate=new Promise(r=>release=r);
  const pending=gameRequirements(123,async(url,opts)=>{called.push(url);assert.equal(opts.timeoutMs,5000);assert.equal(opts.maxBytes,1024*1024);await gate;throw Error('unavailable');});assert.equal(called.length,2);release();assert.equal((await pending).metadataAvailable,false);
});
test('store markup is converted to bounded text without injecting HTML into the panel',()=>{
  const result=parseRequirements(123,{123:{success:true,data:{drm_notice:'<b>External DRM</b>'+('x'.repeat(1000))}}});assert.ok(result.facts[0].length<=400);assert.ok(!result.facts[0].includes('<b>'));
});
