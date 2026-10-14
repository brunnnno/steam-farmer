'use strict';
const crypto=require('node:crypto');
const {readGameHistory,summarySql,guardOperations}=require('./achievement-history');
const {historyRevision}=require('./achievement-changes');
const fail=(message,status=503)=>Object.assign(new Error(message),{status});
const receiptFields=['operationId','appid','selection','revision','historyRevision','effects','progressChanges','checkedAt','verifiedAt','outcome','acknowledgement','verification','message'];
function cleanOperation(value){
  const result={};for(const field of receiptFields)if(value[field]!==undefined)result[field]=structuredClone(value[field]);
  if(JSON.stringify(result).length>65536)throw fail('The reviewed operation exceeds its history budget.',409);
  return result;
}
class AchievementOperations{
  constructor(journal){this.journal=journal;this.schemaAt=0;this.schemaValue=false;}
  async schema(query){
    if(!this.journal.persistent)return false;
    query ||= this.journal.query.bind(this.journal);
    if(Date.now()-this.schemaAt<30000)return this.schemaValue;
    const r=await query("SELECT to_regclass('public.steamfarmer_achievement_operations') AS operations,to_regclass('public.steamfarmer_operation_targets') AS targets,to_regclass('public.steamfarmer_operation_targets_active') AS reservations",[]);
    this.schemaValue=Boolean(r.rows[0]?.operations&&r.rows[0]?.targets&&r.rows[0]?.reservations);this.schemaAt=Date.now();return this.schemaValue;
  }
  async latest(account,id,query){
    if(!this.journal.persistent)return this.journal.forGame(account,id);
    query ||= this.journal.query.bind(this.journal);
    const receipts=await readGameHistory(query,account,id);
    if(!await this.schema(query))return receipts;
    const rows=(await query(`SELECT DISTINCT ON(t.apiname) t.apiname,t.reserved,${summarySql('t.receipt')} || jsonb_build_object('operationId',o.operation_id::text,'checkedAt',o.receipt->'checkedAt','verifiedAt',o.receipt->'verifiedAt','outcome',o.receipt->'outcome') AS receipt FROM steamfarmer_operation_targets t JOIN steamfarmer_achievement_operations o USING(account_id,operation_id) WHERE t.account_id=$1 AND t.appid=$2 AND (t.reserved OR t.receipt->>'action' IN ('unlock','remove')) ORDER BY t.apiname,t.created_at DESC,t.operation_id DESC LIMIT 8193`,[account,id])).rows;
    if(rows.length>8192)throw fail('The operation history exceeds the bounded game budget.',409);
    for(const row of rows){const old=receipts.get(row.apiname);if(row.reserved||(!old||old.outcome==='confirmed')&&(!old||Date.parse(row.receipt.checkedAt)>=Date.parse(old.checkedAt)))receipts.set(row.apiname,row.reserved?{...row.receipt,outcome:'requested',message:'An unresolved reviewed operation reserves this achievement.'}:row.receipt);}
    return receipts;
  }
  async reserve(account,plan){
    if(!Array.isArray(plan.effects)||!plan.effects.length||plan.effects.length>64||!Array.isArray(plan.names)||new Set(plan.names).size!==plan.effects.length||plan.effects.some(e=>!plan.names.includes(e.apiname)))throw fail('Invalid reviewed reservation scope.',409);
    if(!await this.schema())throw fail('Install the reviewed-operations migration before confirming a selection.');
    await this.journal.ready();const operationId=crypto.randomUUID(),checkedAt=new Date().toISOString(),receipt=cleanOperation({...plan,operationId,checkedAt,outcome:'requested'});let client;
    try{
      client=await this.journal.pool.connect();await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='4s'");await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[account]);
      await guardOperations(client,account,plan.appid,plan.names);
      const latest=await this.latest(account,plan.appid,client.query.bind(client));
      if(historyRevision(latest,plan.names)!==plan.historyRevision)throw fail('Recorded history changed after review. Review the selection again.',409);
      if(plan.names.some(name=>latest.get(name)&&latest.get(name).outcome!=='confirmed'))throw fail('A related operation remains unresolved. No write is permitted.',409);
      const recent=await client.query("SELECT 1 FROM steamfarmer_achievement_writes WHERE account_id=$1 AND created_at>NOW()-INTERVAL '1 minute' UNION ALL SELECT 1 FROM steamfarmer_achievement_operations WHERE account_id=$1 AND created_at>NOW()-INTERVAL '1 minute' LIMIT 1",[account]);if(recent.rows.length)throw fail('Wait one minute between achievement operations.',429);
      const count=await client.query('SELECT (SELECT COUNT(*) FROM steamfarmer_achievement_operations WHERE account_id=$1)+(SELECT COUNT(*) FROM steamfarmer_achievement_writes WHERE account_id=$1) AS count',[account]);if(Number(count.rows[0]?.count)>=10000)throw fail('The persistent operation history is full. Export and review it before continuing.',409);
      await client.query('INSERT INTO steamfarmer_achievement_operations(account_id,operation_id,appid,receipt) VALUES($1,$2,$3,$4)',[account,operationId,plan.appid,receipt]);
      await client.query("INSERT INTO steamfarmer_operation_targets(account_id,operation_id,appid,apiname,receipt) SELECT $1,$2,$3,e->>'apiname',e FROM jsonb_array_elements($4::jsonb) e",[account,operationId,plan.appid,JSON.stringify(plan.effects)]);
      await client.query('COMMIT');return receipt;
    }catch(err){if(client)try{await client.query('ROLLBACK');}catch{}if(err.status)throw err;throw fail('The complete persistent intent could not be reserved. No Steam write is permitted.');}finally{client?.release();}
  }
  async finish(account,result){
    const receipt=cleanOperation(result);let client;
    try{
      client=await this.journal.pool.connect();await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='4s'");await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[account]);
      const intent=(await client.query('SELECT receipt FROM steamfarmer_achievement_operations WHERE account_id=$1 AND operation_id=$2 FOR UPDATE',[account,result.operationId])).rows[0]?.receipt;
      if(!intent||intent.revision!==receipt.revision)throw fail('The result does not match its durable reviewed intent.',409);
      if(intent.outcome==='confirmed'&&receipt.outcome!=='confirmed')throw fail('A confirmed operation cannot be replaced by an unconfirmed result.',409);
      if(receipt.outcome==='confirmed'){
        const v=receipt.verification,ack=receipt.acknowledgement;
        if(v?.confirmed!==true||ack?.result!==1||ack.stale!==false||ack.gameId!==String(intent.appid)||!Array.isArray(ack.rejectedStats)||ack.rejectedStats.length||!Array.isArray(v.effects)||v.effects.length!==intent.effects.length||new Set(v.effects.map(e=>e.apiname)).size!==intent.effects.length||intent.effects.some(e=>{const observed=v.effects.find(o=>o.apiname===e.apiname);return observed?.verified!==true||observed.observedUnlocked!==e.after;})||!Array.isArray(v.progress)||v.progress.length!==intent.progressChanges.length||new Set(v.progress.map(p=>p.statId)).size!==intent.progressChanges.length||intent.progressChanges.some(p=>{const observed=v.progress.find(o=>o.statId===p.statId);return observed?.verified!==true||observed.observedRaw!==p.afterRaw;})||!Array.isArray(v.unexpectedStatChanges)||v.unexpectedStatChanges.length||!Array.isArray(v.otherAchievementChanges)||v.otherAchievementChanges.length)throw fail('Every original reviewed effect must be verified before releasing its reservations.',409);
      }
      const finalReceipt={...intent};for(const field of ['verifiedAt','outcome','acknowledgement','verification','message'])if(receipt[field]!==undefined)finalReceipt[field]=receipt[field];
      await client.query('UPDATE steamfarmer_achievement_operations SET receipt=$3::jsonb,updated_at=NOW() WHERE account_id=$1 AND operation_id=$2',[account,result.operationId,finalReceipt]);
      if(receipt.outcome==='confirmed')await client.query('UPDATE steamfarmer_operation_targets SET reserved=FALSE WHERE account_id=$1 AND operation_id=$2',[account,result.operationId]);
      await client.query('COMMIT');
    }catch(err){if(client)try{await client.query('ROLLBACK');}catch{}throw fail('The operation result could not be saved. Its reservations remain unresolved; do not retry.');}finally{client?.release();}
  }
  async list(account,before){
    if(!await this.schema())return [];
    const rows=(await this.journal.query('SELECT receipt FROM steamfarmer_achievement_operations WHERE account_id=$1 AND ($2::timestamptz IS NULL OR created_at<$2::timestamptz) ORDER BY created_at DESC,operation_id DESC LIMIT 100',[account,before||null])).rows;return rows.map(row=>row.receipt);
  }
}
module.exports={AchievementOperations,cleanOperation};
