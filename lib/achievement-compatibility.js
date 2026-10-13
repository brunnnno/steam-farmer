'use strict';
const uint=value=>Number.isInteger(value)&&value>=0&&value<=0xffffffff;
function classifyAchievement(row,snapshot,rows,index) {
  const result=(status,reason)=>({status,reason,canUnlock:status==='provisional'&&row.unlocked===false});
  if(row.serverControlled || [row.permission,row.blockPermission].some(p=>p!=null&&String(p)!=='0')) return result('restricted','Steam declares restricted or unsupported write permissions.');
  if(row.hasProgressDependency) return result('dependency','This achievement depends on progress statistics; individual activation is unavailable.');
  const values=index?.stats.get(row.statId)||(snapshot.stats||[]).filter(s=>s.stat_id===row.statId);
  if(typeof row.unlocked!=='boolean'||values.length!==1||!Object.hasOwn(values[0],'stat_value')||!uint(values[0].stat_value)) return result('insufficient_data','Steam did not return a unique verified personal bitmask.');
  if(!Object.hasOwn(snapshot,'crc_stats')||!uint(snapshot.crc_stats)) return result('insufficient_data','Steam did not return a usable statistics CRC.');
  const names=index?index.names.get(row.apiname):rows.filter(a=>a.apiname===row.apiname).length;
  const bits=index?index.bits.get(row.statId+':'+row.bitIndex):rows.filter(a=>a.statId===row.statId&&a.bitIndex===row.bitIndex).length;
  if(names!==1||bits!==1) return result('insufficient_data','The achievement identifier or bit is ambiguous.');
  return result('provisional','Eligible according to the current Steam schema. Compatibility is provisional until a write is verified.');
}
module.exports={classifyAchievement,uint};
