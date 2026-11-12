'use strict';
const cheerio=require('cheerio');const {remote}=require('./steam-data');const {appId}=require('./core');
const plain=value=>cheerio.load(String(value||'')).text().replace(/\s+/g,' ').trim().slice(0,400);
function parseRequirements(id,api,page='') {
  id=appId(id);const entry=api?.[id],data=entry?.success?entry.data:null;
  const $=cheerio.load(page);const notices=$('.DRM_notice').toArray().map(el=>plain($(el).text()));
  const account=plain(data?.ext_user_account_notice)||notices.find(t=>/requires\s+(?:a\s+)?3rd.party\s+account/i.test(t))||null;
  const drm=plain(data?.drm_notice)||notices.find(t=>/3rd.party\s+DRM/i.test(t))||null;
  const launcher=notices.find(t=>/\blauncher\b/i.test(t))||null;
  const facts=[account,drm,launcher].filter(Boolean).filter((t,i,a)=>a.indexOf(t)===i);
  // Reviewed Steam Store requirement, used only when live metadata is absent.
  if(id===3932890&&!account)facts.push('Requires a linked Battlestate account (Steam Store requirement reviewed October 13, 2026).');
  const external=facts.length>0;
  return {appid:id,source:'Steam Store',sourceUrl:`https://store.steampowered.com/app/${id}/`,metadataAvailable:Boolean(data||notices.length),facts:facts.slice(0,4),externalAccountOrSoftware:external,launcherReported:Boolean(launcher),steamAchievements:data&&Array.isArray(data.categories)?data.categories.some(c=>Number(c.id)===22):null,
    explanation:external?'This game declares an external account or software requirement. This panel connects to Steam only: it cannot verify account linking or change progress stored by the publisher. An external launcher alone does not establish whether a Steam achievement is writable.':'An external launcher requirement has not been established from the available Steam Store data. Activation eligibility is checked separately using Steam achievement permissions and personal statistics.',
    action:external?'For account linking and progress synchronization, use the official game or launcher. For activation eligibility, use Verify directly and read the reason shown on each achievement.':'Use Verify directly to check the reason for each achievement.'};
}
async function gameRequirements(id,request=remote) {
  id=appId(id);const opts={timeoutMs:5000,maxBytes:1024*1024};
  const results=await Promise.allSettled([request(`https://store.steampowered.com/api/appdetails?appids=${id}&l=english`,opts),request(`https://store.steampowered.com/app/${id}/?l=english`,opts)]);
  let api={};if(results[0].status==='fulfilled')try{api=JSON.parse(results[0].value.body);}catch{}
  return parseRequirements(id,api,results[1].status==='fulfilled'?results[1].value.body:'');
}
module.exports={gameRequirements,parseRequirements};
