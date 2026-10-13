'use strict';
const uint=value=>Number.isInteger(value)&&value>=0&&value<=0xffffffff;
function classifyAchievement(row,snapshot,rows,index) {
  const result=(status,reason,code= status,action='Use Refresh to check the latest Steam data.')=>({status,reason,code,action,canUnlock:status==='provisional'&&row.unlocked===false});
  if(row.serverControlled || (Number(row.blockPermission||0)&2)) return result('restricted',"This achievement is controlled by the game's servers. Your Steam client session cannot grant it.",'server_controlled','Complete the requirement in the game and let its official service synchronize with Steam. This panel cannot modify publisher account progress.');
  if([row.permission,row.blockPermission].some(p=>p!=null&&String(p)!=='0')) return result('restricted','Steam declares write permissions this panel does not support. The schema does not establish a launcher-related cause.','unsupported_permission','Use the game\'s own achievement flow.');
  if(row.trustedServerUnknown)return result('insufficient_data','The trusted-server declaration cannot be interpreted safely. No client activation is permitted.','unknown_trusted_server_flag');
  if(row.hasProgressDependency) return result('dependency','This achievement depends on progress statistics. Activating its bit alone could leave inconsistent progress.','progress_dependency','Use the progress preview when supported, or complete the requirement in the game. Protected publisher progress cannot be changed by this panel.');
  const values=index?.stats.get(row.statId)||(snapshot.stats||[]).filter(s=>s.stat_id===row.statId);
  if(typeof row.unlocked!=='boolean'||values.length!==1||!Object.hasOwn(values[0],'stat_value')||!uint(values[0].stat_value)) return result('insufficient_data','Steam returned the definitions but no usable personal achievement state. This can happen when statistics are unavailable or not initialized; the exact cause is not known.','personal_state_unavailable','If you own the game, open it normally through Steam, complete any required publisher sign-in, and refresh. This is a troubleshooting step, not a guaranteed fix.');
  if(!Object.hasOwn(snapshot,'crc_stats')||!uint(snapshot.crc_stats)) return result('insufficient_data','Steam did not return the statistics version needed to submit a consistent update.','stats_version_unavailable','Refresh the direct Steam reading before trying again.');
  const names=index?index.names.get(row.apiname):rows.filter(a=>a.apiname===row.apiname).length;
  const bits=index?index.bits.get(row.statId+':'+row.bitIndex):rows.filter(a=>a.statId===row.statId&&a.bitIndex===row.bitIndex).length;
  if(names!==1||bits!==1) return result('insufficient_data','The achievement identifier or bit is ambiguous.');
  return result('provisional','Eligible according to the current Steam schema. Compatibility is provisional until a write is verified.');
}
module.exports={classifyAchievement,uint};
