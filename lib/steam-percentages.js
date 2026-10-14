'use strict';
const {appId}=require('./core');const {remote,parseHtml}=require('./steam-data');const {percentageMap,normalizeRows,normalizeTitle,uniformHundred}=require('../public/achievement-rarity');
async function globalPercentages(id,request=remote,{includeTitles=false}={}){
  id=appId(id);const opts={timeoutMs:5000,maxBytes:512*1024};
  const readCommunity=()=>Promise.resolve().then(()=>request('https://steamcommunity.com/stats/'+id+'/achievements/?l=english',opts));
  const tasks=[Promise.resolve().then(()=>request('https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid='+id,opts))];
  if(includeTitles)tasks.push(readCommunity());
  const results=await Promise.allSettled(tasks);let list=null;
  try{list=JSON.parse(results[0].value.body).achievementpercentages?.achievements;}catch{}
  const api=percentageMap(list);
  // An anomalous/missing API response may use Community titles, even for direct client reads.
  if(!includeTitles&&(api.suspect||!Object.keys(api.percentages).length)&&(!Array.isArray(list)||list.length))results[1]=(await Promise.allSettled([readCommunity()]))[0];
  const rawRows=results[1]?.status==='fulfilled'?parseHtml(results[1].value.body):[],communitySuspect=uniformHundred(rawRows.map(r=>r.percent));
  const rows=normalizeRows(rawRows),titlePercentages=Object.create(null),duplicates=new Set();
  for(const row of rows){
    const name=normalizeTitle(row.name),p=row.percent;
    if(!name||name.length>256||p===null||duplicates.has(name))continue;
    if(Object.hasOwn(titlePercentages,name)){delete titlePercentages[name];duplicates.add(name);}else titlePercentages[name]=p;
  }
  const available=Object.keys(api.percentages).length||Object.keys(titlePercentages).length,suspect=!available&&(api.suspect||communitySuspect);
  if(!available&&!suspect&&!Array.isArray(list))throw Object.assign(new Error('Steam did not return global achievement percentages. Unknown values have not been replaced.'),{status:502});
  return {appid:id,percentages:api.percentages,...(includeTitles||results[1]?{titlePercentages}:{}),checkedAt:new Date().toISOString(),source:Object.keys(api.percentages).length?'Steam global achievement percentages':Object.keys(titlePercentages).length?'Steam Community global percentages':'Steam percentages unavailable',rarityStatus:suspect?'suspect_uniform_100':available?'available':'unavailable',rarityMessage:suspect?'Steam returned 100% for every achievement. This unusual response cannot establish rarity; percentages remain unverified. Try again later.':''};
}
module.exports={globalPercentages};
