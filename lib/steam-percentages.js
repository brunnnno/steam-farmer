'use strict';
const {appId}=require('./core');const {remote}=require('./steam-data');
async function globalPercentages(id,request=remote){
  id=appId(id);const response=await request(`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${id}`,{timeoutMs:5000,maxBytes:512*1024});
  const list=JSON.parse(response.body).achievementpercentages?.achievements;
  if(!Array.isArray(list))throw Object.assign(new Error('Steam did not return global achievement percentages. Unknown values have not been replaced.'),{status:502});
  const percentages=Object.create(null),duplicates=new Set();
  for(const item of list){
    if(typeof item?.name!=='string'||!item.name||item.name.length>256||item.percent==null||item.percent==='')continue;
    if(!['number','string'].includes(typeof item.percent)||typeof item.percent==='string'&&!item.percent.trim())continue;
    const p=Number(item.percent);if(!Number.isFinite(p)||p<0||p>100||duplicates.has(item.name))continue;
    if(Object.hasOwn(percentages,item.name)){delete percentages[item.name];duplicates.add(item.name);continue;}
    percentages[item.name]=p;
  }
  return {appid:id,percentages,checkedAt:new Date().toISOString(),source:'Steam global achievement percentages'};
}
module.exports={globalPercentages};
