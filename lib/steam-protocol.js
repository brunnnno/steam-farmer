'use strict';
const Schema = require('steam-user/protobufs/generated/_load.js');
const EMsg = require('steam-user/enums/EMsg');
const binaryKV = require('binarykvparser');
const { appId } = require('./core');
const { classifyAchievement, uint } = require('./achievement-compatibility');
const {inspectProgress}=require('./achievement-progress');
const {decodeFloat}=require('./float-progress');
function problem(message, status = 502, code = 'steam_protocol_error', action = 'Refresh the direct Steam reading. If it continues, inspect Steam connection and game access.') { return Object.assign(new Error(message), { status, diagnostic:{code,action} }); }
const english = value => typeof value === 'string' ? value : typeof value?.english === 'string' ? value.english : '';
const trustedServer=value=>value==null||['0','false'].includes(String(value).toLowerCase())?false:['1','true'].includes(String(value).toLowerCase())?true:null;
function libraryCorroborates(summary,unlocked,total,since){
  const time=Date.parse(since),now=Math.floor(Date.now()/1000);
  return Boolean(summary&&summary.unlocked===unlocked&&summary.total===total&&uint(summary.cacheTime)&&summary.cacheTime>0&&Number.isFinite(time)&&summary.cacheTime>=Math.floor(time/1000)&&summary.cacheTime<=now);
}
async function readLibrarySummary(client,id,{timeoutMs=1500}={}){
  const identity=client?.steamID?.toString();
  if(!/^765\d{14}$/.test(identity||'')||typeof client?._send!=='function')return null;
  return new Promise(resolve=>{
    let finished=false,job;const done=value=>{if(finished)return;finished=true;clearTimeout(timer);if(job)client._jobs?.delete?.(job);client.removeListener('disconnected',disconnected);client.removeListener('error',disconnected);resolve(value);};
    const disconnected=()=>done(null),timer=setTimeout(disconnected,timeoutMs);
    client.once('disconnected',disconnected);client.once('error',disconnected);
    try{const method='Player.GetAchievementsProgress#1',encoded=Buffer.from(Schema.CPlayer_GetAchievementsProgress_Request.encode({steamid:identity,language:'english',appids:[appId(id)]}).finish());
    client._send({msg:EMsg.ServiceMethodCallFromClient,proto:{target_job_name:method}},encoded,(response,header)=>{
      if(client.steamID?.toString()!==identity||header?.msg!==EMsg.ServiceMethodResponse||header?.proto?.target_job_name!==method||Number(header?.proto?.eresult)!==1)return done(null);
      let body;try{const bytes=response?.toBuffer?response.toBuffer():response;if(!Buffer.isBuffer(bytes)||bytes.length>65536)return done(null);body=Schema.CPlayer_GetAchievementsProgress_Response.decode(bytes);}catch{return done(null);}
      if(!Array.isArray(body?.achievement_progress)||body.achievement_progress.length!==1)return done(null);
      const row=body.achievement_progress[0];
      if(row.appid!==Number(id)||!Object.hasOwn(row,'unlocked')||!Object.hasOwn(row,'total')||!uint(row.unlocked)||!uint(row.total)||row.total>8192||row.unlocked>row.total)return done(null);
      done({unlocked:row.unlocked,total:row.total,cacheTime:Object.hasOwn(row,'cache_time')&&uint(row.cache_time)?row.cache_time:null});
    });job=String(client._currentJobID);if(finished)client._jobs?.delete?.(job);}catch{done(null);}
  });
}
function parseSnapshot(snapshot, id, planningContext) {
  id = appId(id);
  if (Number(snapshot.eresult) !== 1) throw problem(`Steam rejected direct verification (result ${Number(snapshot.eresult) || 2}). This response does not identify a launcher-related cause.`,502,'stats_read_rejected','Check the connected Steam account and game access. If the game uses a publisher account, check linking in its official launcher, then refresh.');
  if (String(snapshot.game_id) !== String(id)) throw problem('Steam returned statistics for a different game.');
  if (!snapshot.schema?.length || snapshot.schema.length > 4 * 1024 * 1024) throw problem('Steam did not return usable achievement definitions. Activation compatibility cannot be checked; this does not prove the game has no achievements.',502,'schema_unavailable','Try the standard Steam reading. Open the game normally if you own it and refresh; the exact cause is not known.');
  const rawStats = snapshot.stats || [], rawBlocks = snapshot.achievement_blocks || [];
  if(rawStats.length>32768||rawBlocks.length>4096)throw problem('Steam statistics exceed the bounded verification budget.');
  const root = binaryKV.parse(Buffer.from(snapshot.schema));
  // Accept only the requested AppID; a schema for another game is never substituted.
  const definition = root[String(id)] || (root.stats ? root : null);
  if (!definition?.stats) throw problem('Steam did not return an achievement schema for this game.');
  const index={byName:new Map(),numericCounts:new Map(),references:new Map()},rowBits=new Map();
  for(const [key,stat]of Object.entries(definition.stats)){if(stat?.name){if(!index.byName.has(stat.name))index.byName.set(stat.name,[]);index.byName.set(stat.name,[...index.byName.get(stat.name),[key,stat]]);}if(/^\d+$/.test(key))index.numericCounts.set(Number(key),(index.numericCounts.get(key|0)||index.numericCounts.get(Number(key))||0)+1);}
  const values = new Map(), statsById = new Map();
  let allStatsValid = true;
  for(const stat of rawStats) {
    if(!statsById.has(stat.stat_id))statsById.set(stat.stat_id,[]);
    statsById.get(stat.stat_id).push(stat);
    if(!Object.hasOwn(stat,'stat_id')||!Object.hasOwn(stat,'stat_value')||!uint(stat.stat_id)||!uint(stat.stat_value))allStatsValid=false;
  }
  for (const [statId, list] of statsById) {
    if (list.length === 1 && uint(statId) && Object.hasOwn(list[0],'stat_value') && uint(list[0].stat_value)) values.set(statId, list[0].stat_value);
  }
  const blocks = new Map(rawBlocks.map(b => [Number(b.achievement_id), b.unlock_time || []]));
  const rows = [];
  const nowSec = Date.now() / 1000;
  for (const [blockKey, stat] of Object.entries(definition.stats)) {
    if (!/^\d+$/.test(blockKey) || !stat || !['4', 'ACHIEVEMENTS'].includes(String(stat.type).toUpperCase())) continue;
    const blockId = Number(blockKey); if (!Number.isSafeInteger(blockId) || blockId > 0xffffffff) continue;
    const blockVal = values.get(blockId), hasBlockVal = values.has(blockId);
    const times = blocks.get(blockId);
    const statTrusted = trustedServer(stat.bSetByTrustedGS);
    for (const [bitKey, bit] of Object.entries(stat.bits || {})) {
      const bitIndex = Number(bitKey);
      if (!/^\d+$/.test(bitKey) || !Number.isInteger(bitIndex) || bitIndex < 0 || bitIndex > 31 || !bit?.name || typeof bit.name !== 'string') continue;
      const hasTime = Boolean(times && bitIndex < times.length);
      const timestamp = hasTime ? Number(times[bitIndex]) : 0;
      // If a previous store without explicit_reset cleared the bitmask while Steam
      // kept unlock_time and librarySummary.unlocked > 0, surface it as unlocked so Lock all can clear it with explicit_reset.
      const orphanedUnlock = Boolean(snapshot.librarySummary?.advisory && snapshot.librarySummary.unlocked > 0 && hasTime && timestamp > 0 && timestamp <= nowSec);
      const unlocked = hasBlockVal ? Boolean((blockVal & (1 << bitIndex)) || orphanedUnlock) : null;
      const icon = value => typeof value === 'string' && value ? `https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/${id}/${encodeURIComponent(value)}` : '';
      const display = bit.display || {};
      const bitTrusted = trustedServer(bit.bSetByTrustedGS);
      const serverControlled = Boolean(Number(bit.permission || 0) & 2) || bitTrusted === true || statTrusted === true;
      const trustedServerUnknown = bitTrusted === null || statTrusted === null;
      const hiddenRaw = display.hidden ?? bit.hidden;
      const hidden = hiddenRaw == null ? null : ['1','true'].includes(String(hiddenRaw).toLowerCase()) ? true : ['0','false'].includes(String(hiddenRaw).toLowerCase()) ? false : null;
      const row = {
        id:bit.name, apiname:bit.name, name:english(display.name) || bit.name, description:english(display.desc),
        iconOpen:icon(display.icon), iconClosed:icon(display.icon_gray || display.icon),
        unlocked, unlockTimestamp:unlocked && Number.isFinite(timestamp) && timestamp > 0 && timestamp <= nowSec ? timestamp : 0,
        percent:null, tier:'Unknown', serverControlled, statId:blockId, bitIndex,
        permission:bit.permission ?? null, blockPermission:stat.permission ?? null,
        hasProgressDependency:bit.progress != null,
        stateEvidence:{bitUnlocked:unlocked,unlockTimePresent:hasTime,reportedUnlockTimestamp:hasTime&&uint(timestamp)?timestamp:null},
        trustedServerUnknown, hidden
      };
      rows.push(row);
      if(rows.length>8192)throw problem('This game exceeds the bounded achievement-list budget.');
      rowBits.set(row,bit);
      if(bit.progress) {
        row.progressExpression=bit.progress.value||null;
        const statName=bit.progress.value?.operand1;
        const linked=typeof statName==='string'?index.byName.get(statName)||[]:[];
        const linkedStat=linked.length===1?linked[0]:null;
        const type=linkedStat?String(linkedStat[1].type).toUpperCase():null;
        const raw=linkedStat?values.get(Number(linkedStat[0])):undefined;
        const maximum=Number(bit.progress.max_val);
        const direct=bit.progress.value?.operation==='statvalue'&&Object.keys(bit.progress.value).every(k=>['operation','operand1'].includes(k));
        const numericType=['1','INT','2','FLOAT'].includes(type),currentValue=raw===undefined?null:['1','INT'].includes(type)?raw|0:['2','FLOAT'].includes(type)?decodeFloat(raw):null;
        row.progressDetails={statName:typeof statName==='string'?statName:null,type,currentValue:direct?currentValue:null,maximum:Number.isFinite(maximum)&&bit.progress.max_val!=null?maximum:null,interpreted:direct&&linked.length===1&&numericType};
      }
    }
  }
  if (!rows.length) throw problem('Steam returned no readable achievement definitions. Try the standard verification method.',502,'definitions_unavailable','Use the standard Steam reading; this panel cannot activate achievements without real definitions and identifiers.');
  let statsUnlocked = 0, serverControlledCount = 0;
  const retainedDates = [];
  for (const row of rows) {
    if (row.unlocked === true) statsUnlocked++;
    if (row.serverControlled) serverControlledCount++;
    if (row.stateEvidence.bitUnlocked === false && row.stateEvidence.reportedUnlockTimestamp > 0) retainedDates.push(row);
  }
  const library=snapshot.librarySummary;
  const summaryDisagrees=Boolean(library&&(library.total!==rows.length||library.unlocked!==statsUnlocked));
  // A cached aggregate predating this direct statistics read is not a new
  // conflicting personal snapshot. Keep its evidence without blanking the list.
  const staleLibrarySummary=Boolean(summaryDisagrees&&(library.advisory||!uint(library.cacheTime)||library.cacheTime===0||library.cacheTime<Math.floor(Date.now()/1000)));
  const stateConflict=summaryDisagrees&&!staleLibrarySummary;
  const names=new Map(),bits=new Map();
  for(const row of rows){
    if(stateConflict)row.unlocked=null;
    if(row.progressExpression){
      const visit=(value,depth=0)=>{if(depth>32)throw problem('Progress definitions are nested too deeply.');if(typeof value==='string'){if(!index.references.has(value))index.references.set(value,new Set());index.references.get(value).add(row.apiname);}else if(value&&typeof value==='object')for(const v of Object.values(value))visit(v,depth+1);};
      visit(row.progressExpression);
    }
    names.set(row.apiname,(names.get(row.apiname)||0)+1);
    const key=row.statId+':'+row.bitIndex;bits.set(key,(bits.get(key)||0)+1);
  }
  let allVerified = true;
  for (const row of rows) {
    if (typeof row.unlocked !== 'boolean') allVerified = false;
    row.compatibility = stateConflict
      ? {status:'insufficient_data',code:'library_state_conflict',canUnlock:false,reason:'Steam statistics and the Steam library summary disagree. The current personal state is not confirmed.',action:'Do not repeat the previous operation while these readings conflict. Check the achievement in Steam before reviewing another change.'}
      : classifyAchievement(row,snapshot,rows,{stats:statsById,names,bits});
  }
  const hasCrc = Object.hasOwn(snapshot,'crc_stats') && uint(snapshot.crc_stats);
  const complete = allVerified && hasCrc && statsById.size === rawStats.length && allStatsValid;
  for(const row of rows){
    const unrestricted=!row.serverControlled&&!row.trustedServerUnknown&&[row.permission,row.blockPermission].every(p=>p==null||String(p)==='0');
    const unique=names.get(row.apiname)===1&&bits.get(row.statId+':'+row.bitIndex)===1&&index.numericCounts.get(row.statId)===1;
    const canRemove=complete&&unique&&unrestricted&&row.unlocked===true;
    row.removalSupport={canRemove,reason:!complete?'Steam did not return a complete personal snapshot and statistics version. Refresh the direct reading.':!unrestricted?'Steam declares protected or unsupported achievement permissions.':!unique?'The achievement definition or bit is ambiguous.':row.unlocked!==true?'Steam must confirm the achievement is currently unlocked.':'The current Steam snapshot permits reviewing this achievement bit for removal.',...(row.hasProgressDependency?{warning:'Removal keeps the linked progress counter unchanged. The game or Steam may unlock this achievement again when it checks that progress.'}:{})};
    if(row.hasProgressDependency){
      const bit=rowBits.get(row);
      row.progressSupport=inspectProgress(row,bit,definition,values,rows,index);
      if(!hasCrc||names.get(row.apiname)!==1||bits.get(row.statId+':'+row.bitIndex)!==1)row.progressSupport={canComplete:false,code:'insufficient_progress_data',reason:'A valid statistics version and unique achievement definition are required.'};
    }
  }
  if(planningContext)Object.assign(planningContext,{definition,index,values,rowBits});
  return { achievements:rows, source:'Steam client protocol', outcome:'available', verified:allVerified, stateConflict, staleLibrarySummary, message:stateConflict?`Steam statistics report ${statsUnlocked}/${rows.length}, but Steam's library summary reports ${library.unlocked}/${library.total}. Personal state conflicts; achievement changes are blocked. No automatic retry is sent.`:'Read directly from your authenticated Steam session.', checkedAt:new Date().toISOString(), diagnostics:{ method:'ClientGetUserStats', librarySummary:library||null,statsUnlocked,serverControlled:serverControlledCount, retainedUnlockDateCount:retainedDates.length, retainedUnlockDates:retainedDates.slice(0,8).map(r=>({apiname:r.apiname,...r.stateEvidence})) } };
}
async function requestSnapshot(client, id, { timeoutMs = 10000 } = {}) {
  id = appId(id);
  const steamid = client?.steamID?.toString();
  if (!/^765\d{14}$/.test(steamid || '') || typeof client?._send !== 'function') throw problem('Connect to Steam before using direct verification.', 409);
  const snapshot = await new Promise((resolve, reject) => {
    let finished = false, job;
    const cleanup = () => { clearTimeout(timer); if (job) client._jobs?.delete?.(job); client.removeListener('disconnected', disconnected); client.removeListener('error', disconnected); };
    const complete = (err, value) => { if (finished) return; finished = true; cleanup(); err ? reject(err) : resolve(value); };
    const disconnected = () => complete(problem('Steam disconnected during direct verification.', 409));
    const timer = setTimeout(() => complete(problem('Steam did not answer direct verification in time. Try standard Refresh.', 504,'read_timeout','Refresh once Steam is connected. A timeout is not evidence that a launcher blocks activation.')), timeoutMs);
    client.once('disconnected', disconnected); client.once('error', disconnected);
    try {
      const body = Buffer.from(Schema.CMsgClientGetUserStats.encode({ game_id:String(id), steam_id_for_user:steamid, crc_stats:0, schema_local_version:0 }).finish());
      // steam-user 5.x exposes the generated schema but does not register these EMsgs.
      // This adapter sends only ClientGetUserStats; it cannot write/reset any statistics.
      client._send({ msg:EMsg.ClientGetUserStats, proto:{} }, body, (response, header) => {
        if (finished) return;
        try {
          if (header?.msg !== EMsg.ClientGetUserStatsResponse) throw problem('Steam returned an unexpected direct-verification response.');
          const buffer = response?.toBuffer ? response.toBuffer() : response;
          if (!Buffer.isBuffer(buffer) || buffer.length > 8 * 1024 * 1024) throw problem('Steam returned an invalid direct-verification payload.');
          complete(null, Schema.CMsgClientGetUserStatsResponse.decode(buffer));
        } catch (err) { complete(problem(err.status ? err.message : 'Steam returned unreadable direct-verification data.')); }
      });
      job = String(client._currentJobID); if (finished) client._jobs?.delete?.(job);
    } catch { complete(problem('Direct verification is unavailable with this Steam connection.')); }
  });
  if (client.steamID?.toString() !== steamid) throw problem('The Steam account changed during verification.', 409);
  if(Number(snapshot.eresult)!==1||String(snapshot.game_id)!==String(id)||!snapshot.schema?.length||snapshot.schema.length>4*1024*1024)parseSnapshot(snapshot,id);
  const summary=await readLibrarySummary(client,id,{timeoutMs:Math.min(timeoutMs,600)});
  if(summary)Object.defineProperty(summary,'advisory',{value:true});
  snapshot.librarySummary=summary;
  if(client.steamID?.toString()!==steamid)throw problem('The Steam account changed during verification.',409);
  return snapshot;
}
async function readProtocol(client, id, options) { return parseSnapshot(await requestSnapshot(client,id,options),id); }
module.exports = { readProtocol, parseSnapshot, requestSnapshot, readLibrarySummary,libraryCorroborates };
