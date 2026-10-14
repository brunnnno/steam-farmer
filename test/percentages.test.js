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

test('uniform 100% API falls back to unique Community titles even for a direct lookup',async()=>{
  const calls=[],result=await globalPercentages(550,async url=>{calls.push(url);return {body:url.includes('api.steampowered')?JSON.stringify({achievementpercentages:{achievements:[{name:'A',percent:100},{name:'B',percent:100}]}}):'<div class="achieveRow"><h3>Epic</h3><div class="achievePercent">10%</div></div><div class="achieveRow"><h3>Mythic</h3><div class="achievePercent">2%</div></div>'};});assert.equal(calls.length,2);assert.deepEqual(Object.keys(result.percentages),[]);assert.equal(result.titlePercentages.epic,10);assert.equal(result.titlePercentages.mythic,2);assert.equal(result.rarityStatus,'available');
});
test('both official sources reporting every achievement at 100% are clearly marked unverified',async()=>{
  const result=await globalPercentages(550,async url=>({body:url.includes('api.steampowered')?'{"achievementpercentages":{"achievements":[{"name":"A","percent":100},{"name":"B","percent":100}]}}':'<div class="achieveRow"><h3>One</h3><div class="achievePercent">100%</div></div><div class="achieveRow"><h3>Two</h3><div class="achievePercent">100%</div></div>'}));assert.equal(result.rarityStatus,'suspect_uniform_100');assert.deepEqual(Object.keys(result.percentages),[]);assert.deepEqual(Object.keys(result.titlePercentages),[]);assert.match(result.rarityMessage,/100%/);
});
test('a genuine single 100% and a mixed distribution remain valid',async()=>{for(const entries of [[{name:'ONE',percent:100}],[{name:'ONE',percent:100},{name:'TWO',percent:10}]]){let calls=0;const result=await globalPercentages(240,async()=>{calls++;return {body:JSON.stringify({achievementpercentages:{achievements:entries}})};});assert.equal(calls,1);assert.equal(result.percentages.ONE,100);assert.equal(result.rarityStatus,'available');}});

test('missing percentages are distinct from a complete uniform 100% distribution',()=>{const {normalizeRows,uniformHundred}=require('../public/achievement-rarity');assert.equal(uniformHundred([100,100,null]),false);assert.equal(normalizeRows([{percent:100},{percent:100},{percent:null}])[0].percent,100);});
