'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {globalPercentages}=require('../lib/steam-percentages');
test('global percentages preserve genuine zero, reject missing/invalid values and ambiguous names',async()=>{const r=await globalPercentages(550,async(url,opts)=>{assert.match(url,/gameid=550/);assert.equal(opts.maxBytes,512*1024);return {body:JSON.stringify({achievementpercentages:{achievements:[{name:'COMMON',percent:95},{name:'ZERO',percent:0},{name:'UNKNOWN',percent:null},{name:'EMPTY',percent:''},{name:'INVALID',percent:101},{name:'DUP',percent:5},{name:'DUP',percent:10}]}})}});assert.equal(r.percentages.COMMON,95);assert.equal(r.percentages.ZERO,0);assert.deepEqual(Object.keys(r.percentages),['COMMON','ZERO']);});
test('missing percentage response stays unavailable, not an invented zero list',async()=>{await assert.rejects(globalPercentages(550,async()=>({body:'{}'})),e=>e.status===502);});
test('community percentages supply unique English title matches when XML identifiers are unavailable',async()=>{
  const row=(name,p)=>`<div class="achieveRow"><h3>${name}</h3><h5>description</h5><div class="achievePercent">${p}%</div></div>`;
  const result=await globalPercentages(550,async url=>({body:url.includes('api.steampowered')?'malformed':row('GNOME ALONE',69.8)+row('Zero',0)+row('Duplicate',5)+row('Duplicate',10)}),{includeTitles:true});
  assert.equal(Object.keys(result.percentages).length,0);assert.equal(result.titlePercentages['gnome alone'],69.8);assert.equal(result.titlePercentages.zero,0);assert.equal(Object.hasOwn(result.titlePercentages,'duplicate'),false);
});
test('direct ID lookup does not fetch community metadata and tolerates missing optional titles',async()=>{
  let calls=0;const result=await globalPercentages(550,async url=>{calls++;if(url.includes('steamcommunity'))throw Error('Unavailable');return {body:JSON.stringify({achievementpercentages:{achievements:[{name:'API',percent:10}]}})};},{includeTitles:true});assert.equal(calls,2);assert.equal(result.percentages.API,10);assert.deepEqual(Object.keys(result.titlePercentages),[]);
  calls=0;await globalPercentages(550,async()=>{calls++;return {body:'{"achievementpercentages":{"achievements":[]}}'};});assert.equal(calls,1);
});
