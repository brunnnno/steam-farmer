'use strict';
const {ResultCache}=require('./cache');
const {appId}=require('./core');
const {globalPercentages}=require('./steam-percentages');
const {validPercent,normalizeTitle,uniformHundred}=require('../public/achievement-rarity');
const seeds=require('../data/rarity-snapshots.json');
function createPercentageReader({read=globalPercentages,snapshots=seeds,now=Date.now}={}){
  const history=new ResultCache({maxBytes:256*1024,maxEntries:16,ttl:7*86400000,now});
  const validMap=map=>map&&typeof map==='object'&&!Array.isArray(map)&&Object.keys(map).length>0&&Object.keys(map).length<=8192&&Object.entries(map).every(([k,v])=>k&&k.length<=256&&validPercent(v)!==null)&&!uniformHundred(Object.values(map));
  const valid=result=>validMap(result.percentages)||validMap(result.titlePercentages);
  const reader=async(id,options)=>{
    id=appId(id);
    let result,error;try{result=await read(id,undefined,options);}catch(e){error=e;}
    if(result&&result.appid!==id){error=Object.assign(new Error('Steam percentage data belongs to a different game.'),{status:502});result=null;}
    if(result&&valid(result)&&result.rarityStatus!=='suspect_uniform_100'){
      history.set(id,structuredClone(result));return result;
    }
    let previous=history.get(id),note='';
    if(!previous){
      const seed=snapshots.find(s=>s.appid===id&&Date.parse(s.expiresAt)>now()&&Date.parse(s.capturedAt)<=now());
      if(seed&&Array.isArray(seed.rows)&&seed.rows.length<=8192){
        const map=Object.create(null),duplicates=new Set();
        for(const row of seed.rows){const key=normalizeTitle(row.name);if(duplicates.has(key))continue;if(Object.hasOwn(map,key)){delete map[key];duplicates.add(key);}else map[key]=row.percent;}
        if(Date.parse(seed.capturedAt)&&seed.sourceUrl?.startsWith('https://steamcommunity.com/stats/')){previous={percentages:{},titlePercentages:map,checkedAt:seed.capturedAt,source:'Steam Community historical indexed copy',sourceUrl:seed.sourceUrl};note=seed.sourceNote;}
      }
    }
    if(previous&&valid(previous))return {...structuredClone(previous),appid:id,rarityStatus:'historical',historical:true,lastAttemptAt:new Date(now()).toISOString(),rarityMessage:note?'Historical Steam percentages: indexed copy recovered '+previous.checkedAt.slice(0,10)+'; exact original date unavailable. Current Steam data could not be validated.':'Last known Steam percentages from '+previous.checkedAt+'. Current Steam percentages could not be validated.'};
    if(error)throw error;return result;
  };
  reader.prune=()=>history.prune();reader.clear=()=>history.clear();reader.bytes=()=>history.bytes;
  return reader;
}
module.exports={createPercentageReader};
