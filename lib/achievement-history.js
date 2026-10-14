'use strict';
// Do not load full verification payloads for every achievement. A game may have thousands of receipts.
function summarySql(ref='receipt'){
  const plain=['operationId','action','appid','apiname','name','checkedAt','verifiedAt','outcome','before','after','statId','bitIndex'];
  return `jsonb_strip_nulls(jsonb_build_object(${plain.map(k=>`'${k}',${ref}->'${k}'`).join(',')},'message',left(${ref}->>'message',512),'diagnostic',jsonb_build_object('code',left(${ref}->'diagnostic'->>'code',128),'action',left(${ref}->'diagnostic'->>'action',512)),'progressChanges',CASE WHEN octet_length((${ref}->'progressChanges')::text)<=2048 THEN ${ref}->'progressChanges' ELSE NULL END))`;
}
async function readGameHistory(query,account,id){
  const rows=(await query(`SELECT apiname,${summarySql()} AS receipt FROM steamfarmer_achievement_writes WHERE account_id=$1 AND appid=$2 LIMIT 8193`,[account,id])).rows;
  if(rows.length>8192)throw Object.assign(new Error('The game history exceeds the bounded reading budget. Writes are blocked.'),{status:409});
  const result=new Map(rows.map(r=>[r.apiname,r.receipt]));
  if((await query("SELECT to_regclass('public.steamfarmer_shared_reservations') AS present",[])).rows[0]?.present){
    const pending=(await query(`SELECT r.apiname,${summarySql('w.receipt')} AS receipt FROM steamfarmer_shared_reservations r JOIN steamfarmer_achievement_writes w ON w.account_id=r.account_id AND w.appid=r.appid AND w.apiname=r.owner_apiname WHERE r.account_id=$1 AND r.appid=$2 LIMIT 8193`,[account,id])).rows;
    if(pending.length>8192)throw Object.assign(new Error('The game reservations exceed the bounded reading budget.'),{status:409});
    for(const row of pending)result.set(row.apiname,{...row.receipt,outcome:'requested',message:'An unresolved shared-counter operation reserves this achievement. Review its history before writing.'});
  }
  return result;
}
async function guardOperations(client,account,id,names){
  if((await client.query("SELECT 1 FROM steamfarmer_achievement_writes WHERE account_id=$1 AND (receipt->>'outcome' IS NULL OR receipt->>'outcome' NOT IN ('confirmed','already_unlocked')) LIMIT 1",[account])).rows.length)throw Object.assign(new Error('A previous achievement attempt remains unresolved. Review its history before new writes.'),{status:409});
  if(!(await client.query("SELECT to_regclass('public.steamfarmer_operation_targets') AS present")).rows[0]?.present)return;
  if((await client.query('SELECT 1 FROM steamfarmer_operation_targets WHERE account_id=$1 AND reserved LIMIT 1',[account])).rows.length)throw Object.assign(new Error('A previous reviewed operation remains unresolved. Review its history before new writes.'),{status:409});
  if((await client.query('SELECT 1 FROM steamfarmer_operation_targets WHERE account_id=$1 AND appid=$2 AND apiname=ANY($3::text[]) AND reserved LIMIT 1',[account,id,names])).rows.length)throw Object.assign(new Error('An unresolved reviewed operation reserves this achievement.'),{status:409});
  if((await client.query("SELECT 1 FROM steamfarmer_achievement_operations WHERE account_id=$1 AND created_at>NOW()-INTERVAL '1 minute' LIMIT 1",[account])).rows.length)throw Object.assign(new Error('Wait one minute between achievement operations.'),{status:429});
}
module.exports={summarySql,readGameHistory,guardOperations};
