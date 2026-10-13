'use strict';
const {Pool}=require('pg');
const fail=(message,status=503)=>Object.assign(new Error(message),{status});
const fields=['appid','apiname','name','checkedAt','before','after','outcome','changed','acknowledgement','diagnostic','unexpectedStatChanges','otherAchievementChanges','message','progressChanges','statId','bitIndex'];
function clean(receipt){
  const result={};for(const k of fields)if(receipt[k]!==undefined)result[k]=structuredClone(receipt[k]);
  if(JSON.stringify(result).length>65536)throw fail('The achievement receipt exceeds the journal limit.',409);
  return result;
}
class AchievementJournal{
  constructor({cfg,save,url='',pool,now=Date.now}){
    this.cfg=cfg;this.save=save;this.now=now;this.pool=pool||(url?new Pool({connectionString:url,max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,statement_timeout:5000,query_timeout:6000}):null);
    this.persistent=Boolean(this.pool);this.available=!this.pool;this.pool?.on?.('error',()=>{this.available=false;});
    this.initPromise=null;this.cfg.achievementWrites ||= {};
  }
  status(){return {mode:this.persistent?'postgres':'local',persistent:this.persistent,available:this.available,message:this.persistent?(this.available?'Write history is stored in PostgreSQL.':'PostgreSQL history is unavailable. Achievement writes are blocked until it recovers.'):'Write history is local and can be lost when Render restarts or redeploys. Configure ACHIEVEMENT_DATABASE_URL for persistent history.'};}
  async ready(){
    if(!this.pool)return;
    if(!this.initPromise)this.initPromise=(async()=>{
      await this.pool.query('CREATE TABLE IF NOT EXISTS steamfarmer_achievement_writes (account_id TEXT NOT NULL, appid BIGINT NOT NULL, apiname TEXT NOT NULL, receipt JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (account_id,appid,apiname))');
      const records={...this.cfg.achievementWrites};
      for(const [key,value]of Object.entries(this.cfg.achievementExperiments||{}))if(value.apiname&&!records[key+':'+value.apiname])records[key+':'+value.apiname]=value;
      for(const [key,value]of Object.entries(records)){
        const [account,id,...name]=key.split(':');const apiname=name.join(':');
        if(!/^765\d{14}$/.test(account)||!/^\d+$/.test(id)||!apiname||apiname.length>256)continue;
        const receipt=clean(value);await this.pool.query('INSERT INTO steamfarmer_achievement_writes(account_id,appid,apiname,receipt,created_at) VALUES($1,$2,$3,$4,COALESCE($5::timestamptz,NOW())) ON CONFLICT DO NOTHING',[account,Number(id),apiname,receipt,Number.isFinite(Date.parse(receipt.checkedAt))?receipt.checkedAt:null]);
      }
      this.available=true;
    })().catch(()=>{this.available=false;this.initPromise=null;throw fail('Persistent achievement history is unavailable. No achievement write will be sent.');});
    await this.initPromise;
  }
  async query(sql,args){await this.ready();try{const r=await this.pool.query(sql,args);this.available=true;return r;}catch{this.available=false;throw fail('Persistent achievement history is unavailable. No local fallback will be used.');}}
  async get(account,id,name){
    if(!this.pool){const old=this.cfg.achievementExperiments?.[account+':'+id];return this.cfg.achievementWrites[account+':'+id+':'+name]||(old?.apiname===name?old:null);}
    return (await this.query('SELECT receipt FROM steamfarmer_achievement_writes WHERE account_id=$1 AND appid=$2 AND apiname=$3',[account,id,name])).rows[0]?.receipt||null;
  }
  async forGame(account,id){
    if(this.pool)return new Map((await this.query('SELECT apiname,receipt FROM steamfarmer_achievement_writes WHERE account_id=$1 AND appid=$2',[account,id])).rows.map(r=>[r.apiname,r.receipt]));
    const prefix=account+':'+id+':',result=new Map(Object.entries(this.cfg.achievementWrites).filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k.slice(prefix.length),v]));const old=this.cfg.achievementExperiments?.[account+':'+id];if(old?.apiname&&!result.has(old.apiname))result.set(old.apiname,old);return result;
  }
  async reserve(account,id,name,evidence){
    const receipt=clean({...evidence,outcome:'requested'}),key=account+':'+id+':'+name;
    if(!this.pool){
      const old=this.cfg.achievementExperiments?.[account+':'+id];
      if(this.cfg.achievementWrites[key]||old?.apiname===name)throw fail('A write was already attempted for this achievement. Automatic retries are disabled.',409);
      const entries=Object.entries(this.cfg.achievementWrites),recent=entries.filter(([k])=>k.startsWith(account+':')).some(([,r])=>this.now()-Date.parse(r.checkedAt)<60000);
      if(recent)throw fail('Wait one minute between achievement writes.',429);
      if(entries.length>=128){const completed=entries.find(([,r])=>['confirmed','already_unlocked'].includes(r.outcome));if(!completed)throw fail('The local write journal is full of unresolved results.',409);delete this.cfg.achievementWrites[completed[0]];}
      this.cfg.achievementWrites[key]=receipt;this.save();return;
    }
    await this.ready();let client;
    try{
      client=await this.pool.connect();await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='4s'");
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[account]);
      if((await client.query('SELECT 1 FROM steamfarmer_achievement_writes WHERE account_id=$1 AND appid=$2 AND apiname=$3',[account,id,name])).rows.length)throw fail('A write was already attempted for this achievement. Automatic retries are disabled.',409);
      if((await client.query("SELECT 1 FROM steamfarmer_achievement_writes WHERE account_id=$1 AND created_at>NOW()-INTERVAL '1 minute' LIMIT 1",[account])).rows.length)throw fail('Wait one minute between achievement writes.',429);
      if(Number((await client.query('SELECT COUNT(*) AS count FROM steamfarmer_achievement_writes WHERE account_id=$1',[account])).rows[0].count)>=10000)throw fail('The persistent journal has reached its retention limit. Export and review it before continuing.',409);
      await client.query('INSERT INTO steamfarmer_achievement_writes(account_id,appid,apiname,receipt) VALUES($1,$2,$3,$4)',[account,id,name,receipt]);await client.query('COMMIT');this.available=true;
    }catch(err){if(client)try{await client.query('ROLLBACK');}catch{}if(err.status)throw err;this.available=false;throw fail('Persistent write intent could not be confirmed. No Steam write will be sent; review history before retrying.');}finally{client?.release();}
  }
  async finish(account,id,name,result){
    const receipt=clean(result),key=account+':'+id+':'+name;
    if(!this.pool){if(this.cfg.achievementWrites[key]){this.cfg.achievementWrites[key]={...this.cfg.achievementWrites[key],...receipt};this.save();}return;}
    const r=await this.query('UPDATE steamfarmer_achievement_writes SET receipt=receipt || $4::jsonb,updated_at=NOW() WHERE account_id=$1 AND appid=$2 AND apiname=$3',[account,id,name,receipt]);if(r.rowCount!==1)throw fail('The Steam result could not be attached to its persistent intent. Review history before retrying.');
  }
  async list(account,{before}={}){
    if(this.pool){const r=await this.query('SELECT receipt,created_at FROM steamfarmer_achievement_writes WHERE account_id=$1 AND ($2::timestamptz IS NULL OR created_at<$2::timestamptz) ORDER BY created_at DESC,appid,apiname LIMIT 100',[account,before||null]);return r.rows.map(r=>({...r.receipt,recordedAt:r.created_at.toISOString()}));}
    return Object.entries(this.cfg.achievementWrites).filter(([k])=>k.startsWith(account+':')).map(([,v])=>clean(v)).filter(r=>!before||Date.parse(r.checkedAt)<Date.parse(before)).sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt)).slice(0,100);
  }
  async close(){await this.pool?.end();}
}
module.exports={AchievementJournal,clean};
