'use strict';
(function(root){
  function validPercent(value){
    if(typeof value==='string'){value=value.trim();if(!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value))return null;value=Number(value);}
    return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?value:null;
  }
  function tier(value){const p=validPercent(value);return p===null?'Unknown':p<5?'Mythic':p<15?'Epic':p<40?'Rare':'Common';}
  function uniformHundred(values){return values.length>1&&values.every(p=>validPercent(p)===100);}
  function normalizeTitle(name){return String(name).trim().replace(/\s+/g,' ').toLowerCase();}
  function normalizeRows(rows){
    const suspect=uniformHundred(rows.map(r=>r.percent));
    return rows.map(row=>{const p=suspect?null:validPercent(row.percent);return {...row,percent:p,tier:tier(p)};});
  }
  function percentageMap(entries){
    const percentages=Object.create(null),duplicates=new Set();
    for(const item of Array.isArray(entries)?entries:[]){
      const p=validPercent(item?.percent);
      if(typeof item?.name!=='string'||!item.name||item.name.length>256||p===null||duplicates.has(item.name))continue;
      if(Object.hasOwn(percentages,item.name)){delete percentages[item.name];duplicates.add(item.name);}else percentages[item.name]=p;
    }
    const suspect=uniformHundred(Object.values(percentages));
    return {percentages:suspect?Object.create(null):percentages,suspect};
  }
  const api={validPercent,tier,uniformHundred,normalizeTitle,normalizeRows,percentageMap};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AchievementRarity=api;
})(typeof globalThis!=='undefined'?globalThis:this);
