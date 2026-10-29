'use strict';
const crypto=require('node:crypto');
const {Pool}=require('pg');
const SCHEMA='CREATE TABLE IF NOT EXISTS steamfarmer_app_state (id TEXT PRIMARY KEY, version BIGINT NOT NULL, encrypted JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())';
const error=()=>Object.assign(new Error('Persistent configuration is unavailable or changed in another server. Restart after checking the database; no changes will be reported as saved.'),{status:503});
function fingerprint(config){return crypto.createHash('sha256').update(JSON.stringify({timezone:config.timezone,panelAuth:config.panelAuth,accounts:config.accounts.map(a=>({id:a.id,games:a.games,paused:Boolean(a.paused),sleepMode:a.sleepMode,customStatus:a.customStatus||'',personaState:a.personaState,cardFarming:Boolean(a.cardFarming),chatAdmins:a.chatAdmins}))})).digest('hex');}
class AppState {
  constructor({url,key,pool,id='steamfarmer-main'}){
    this.key=Buffer.from(key||'','base64');
    if(this.key.length!==32)throw Error('APP_STATE_KEY must be a base64 encoded 32-byte encryption key.');
    this.pool=pool||new Pool({connectionString:url,max:1,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,statement_timeout:6000,query_timeout:8000});
    this.id=id;this.version=0;this.available=true;this.pending=Promise.resolve();this.restored=false;
    this.pool.on?.('error',err=>console.warn('[AppState] Idle pool client error:',err?.message||err));
  }
  failed(){this.available=false;this.onFailure?.();}
  encrypt(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(this.id));return {iv:iv.toString('hex'),data:Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]).toString('hex'),tag:cipher.getAuthTag().toString('hex')};}
  decrypt(value){const d=crypto.createDecipheriv('aes-256-gcm',this.key,Buffer.from(value.iv,'hex'));d.setAAD(Buffer.from(this.id));d.setAuthTag(Buffer.from(value.tag,'hex'));return JSON.parse(Buffer.concat([d.update(Buffer.from(value.data,'hex')),d.final()]).toString());}
  async load(){
    // Schema is migrated separately on a direct connection, before deployment.
    const r=await this.pool.query('SELECT version,encrypted FROM steamfarmer_app_state WHERE id=$1',[this.id]);
    if(!r.rows.length)return null;
    this.version=Number(r.rows[0].version);const value=this.decrypt(r.rows[0].encrypted);
    if(!value.config||!Array.isArray(value.config.accounts)||!value.tokens||typeof value.tokens!=='object')throw Error('Invalid persisted application state.');
    this.restored=true;return value;
  }
  assert(){if(!this.available)throw error();}
  save(config,vault){
    this.configFingerprint=fingerprint(config);
    this.assert();const tokens={};for(const id of Object.keys(vault.records))tokens[id]=vault.get(id);
    const value={config,tokens};if(Buffer.byteLength(JSON.stringify(value))>512*1024)throw Object.assign(new Error('Configuration exceeds the 512 KiB memory budget.'),{status:413});
    this.nextEncrypted=this.encrypt(value);
    if(this.draining)return;
    this.draining=true;
    this.pending=(async()=>{while(this.nextEncrypted){
      const encrypted=this.nextEncrypted;this.nextEncrypted=null;
      this.assert();let r;
      if(this.version===0)r=await this.pool.query('INSERT INTO steamfarmer_app_state(id,version,encrypted) VALUES($1,1,$2) ON CONFLICT DO NOTHING RETURNING version',[this.id,encrypted]);
      else r=await this.pool.query('UPDATE steamfarmer_app_state SET encrypted=$2,version=version+1,updated_at=NOW() WHERE id=$1 AND version=$3 RETURNING version',[this.id,encrypted,this.version]);
      if(r.rowCount!==1)throw error();this.version=Number(r.rows[0].version);
    }})().catch(()=>{this.nextEncrypted=null;this.failed();throw error();}).finally(()=>{this.draining=false;});
    // Observe rejection even for background saves. flush still rejects for callers.
    this.pending.catch(()=>{});
  }
  async flush(){await this.pending;this.assert();}
  status(){return {mode:'postgres',persistent:true,encrypted:true,available:this.available,restored:this.restored,version:this.version,configFingerprint:this.configFingerprint};}
  async close(){try{await this.flush();}finally{await this.pool.end();}}
}
module.exports={AppState,SCHEMA};
