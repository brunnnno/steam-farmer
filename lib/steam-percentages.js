'use strict';
const {appId}=require('./core');const {remote,parseHtml}=require('./steam-data');
async function globalPercentages(id,request=remote,{includeTitles=false}={}){
  id=appId(id);const opts={timeoutMs:5000,maxBytes:512*1024};
  const tasks=[Promise.resolve().then(()=>request(`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${id}`,opts))];
  if(includeTitles)tasks.push(Promise.resolve().then(()=>request(`https://steamcommunity.com/stats/${id}/achievements/?l=english`,opts)));
  const results=await Promise.allSettled(tasks);let list=null;
  try{list=JSON.parse(results[0].value.body).achievementpercentages?.achievements;}catch{}
  const percentages=Object.create(null),duplicates=new Set();
  for(const item of Array.isArray(list)?list:[]){
    if(typeof item?.name!=='string'||!item.name||item.name.length>256||item.percent==null||item.percent==='')continue;
    if(!['number','string'].includes(typeof item.percent)||typeof item.percent==='string'&&!item.percent.trim())continue;
    const p=Number(item.percent);if(!Number.isFinite(p)||p<0||p>100||duplicates.has(item.name))continue;
    if(Object.hasOwn(percentages,item.name)){delete percentages[item.name];duplicates.add(item.name);continue;}
    percentages[item.name]=p;
  }
  const titlePercentages=Object.create(null),duplicateTitles=new Set();
  if(results[1]?.status==='fulfilled')for(const row of parseHtml(results[1].value.body)){
    const name=row.name.trim().replace(/\s+/g,' ').toLowerCase(),p=row.percent;
    if(!name||name.length>256||!Number.isFinite(p)||p<0||p>100||duplicateTitles.has(name))continue;
    if(Object.hasOwn(titlePercentages,name)){delete titlePercentages[name];duplicateTitles.add(name);continue;}titlePercentages[name]=p;
  }
  if(!Array.isArray(list)&&!Object.keys(titlePercentages).length)throw Object.assign(new Error('Steam did not return global achievement percentages. Unknown values have not been replaced.'),{status:502});
  return {appid:id,percentages,...(includeTitles?{titlePercentages}:{}),checkedAt:new Date().toISOString(),source:'Steam global achievement percentages'};
}
module.exports={globalPercentages};
