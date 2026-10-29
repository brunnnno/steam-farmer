'use strict';
// Compatibility wrapper for the original, explicitly selected experiment.
const writer=require('./achievement-writer');
const {parseSnapshot}=require('./steam-protocol');
const TARGET=Object.freeze({appid:3764200,name:'Model Mania',description:'View all models.'});
function prepare(snapshot){
  const rows=parseSnapshot(snapshot,TARGET.appid).achievements.filter(a=>a.name===TARGET.name&&a.description===TARGET.description);
  if(rows.length!==1)throw Object.assign(new Error('The selected achievement could not be identified uniquely in Steam.'),{status:409});
  return writer.prepare(snapshot,TARGET.appid,rows[0].apiname);
}
async function unlockModelMania(client,options={}) {
  return writer.unlockAchievement(client,TARGET.appid,options.expectedApiname,{...options,selectTarget:snapshot=>{
    const selected=prepare(snapshot).target.apiname;
    if(options.expectedApiname&&options.expectedApiname!==selected)throw Object.assign(new Error('The achievement identifier changed.'),{status:409});
    return selected;
  },validateTarget:row=>{if(row.name!==TARGET.name||row.description!==TARGET.description)throw Object.assign(new Error('The selected achievement changed.'),{status:409});}});
}
module.exports={TARGET,prepare,store:writer.store,unlockModelMania};
