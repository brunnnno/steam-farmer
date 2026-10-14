'use strict';
const FLOAT_MAX=3.4028234663852886e38;
function decodeFloat(raw){
  if(!Number.isInteger(raw)||raw<0||raw>0xffffffff)return null;
  const bytes=Buffer.allocUnsafe(4);bytes.writeUInt32LE(raw);const value=bytes.readFloatLE();
  return Number.isFinite(value)?value:null;
}
function floatBits(value){
  if(!Number.isFinite(value)||!Number.isFinite(Math.fround(value)))return null;
  const bytes=Buffer.allocUnsafe(4);bytes.writeFloatLE(value);return bytes.readUInt32LE();
}
const decimal=(value,fallback)=>value==null?fallback:/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(value))&&Number.isFinite(Number(value))?Number(value):NaN;
function inspectFloat(stat,progress,raw,shared,options={}){
  const no=(code,reason)=>({canComplete:false,canPreviewFloat:false,code,reason});
  const before=decodeFloat(raw),goal=decimal(progress.max_val,NaN),min=decimal(stat.min,-FLOAT_MAX),max=decimal(stat.max,FLOAT_MAX),maxChange=decimal(stat.maxchange,0);
  if(before===null)return no('float_value_unavailable','Steam did not return a unique finite FLOAT progress value.');
  if(![goal,min,max,maxChange].every(Number.isFinite)||goal<=0||goal>FLOAT_MAX||min<-FLOAT_MAX||max>FLOAT_MAX||min>max||maxChange<0||maxChange>FLOAT_MAX||before<0||!['0','1','false','true'].includes(String(stat.incrementonly??'0').toLowerCase()))return no('invalid_float_constraints','The decimal target or statistic constraints cannot be interpreted safely.');
  let after=before;
  if(before<goal){
    after=Math.fround(goal);
    // Round upward if the nearest float falls below the achievement's target.
    if(after<goal)after=decodeFloat(floatBits(after)+1);
  }
  if(after===null||!Number.isFinite(after)||before<min||before>max||after<min||after>max||(maxChange>0&&after-before>maxChange))return no('float_progress_bounds','The representable decimal update exceeds the declared limits or maximum change.');
  if(shared&&!options.allowSharedFloat)return no('shared_float_progress','This decimal counter affects other achievements. Shared FLOAT activation is not supported yet.');
  return {canComplete:false,canPreviewFloat:true,code:'float_review_only',reason:'Decimal progress requires review of the exact counter change and persistent history. Steam acceptance remains unverified until an individually confirmed attempt.',before,after,goal,beforeRaw:raw,afterRaw:floatBits(after),min,max,maxChange,incrementOnly:['1','true'].includes(String(stat.incrementonly??'0').toLowerCase())};
}
module.exports={decodeFloat,floatBits,inspectFloat};
