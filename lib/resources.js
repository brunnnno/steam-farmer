'use strict';
const unavailable=()=>Object.assign(new Error('The server is busy or conserving memory. Wait for the current operation to finish, then retry.'),{status:429});
class ResourceBudget {
  constructor({rss=()=>process.memoryUsage.rss(),softLimit=360*1024*1024}={}){this.rss=rss;this.softLimit=softLimit;this.active={heavy:0,small:0};}
  acquire(kind='heavy'){
    if(this.rss()>=this.softLimit||this.active[kind]>=(kind==='heavy'?1:4))throw unavailable();
    this.active[kind]++;let released=false;
    return ()=>{if(!released){released=true;this.active[kind]--;}};
  }
  async run(task,kind='heavy'){const release=this.acquire(kind);try{return await task();}finally{release();}}
  status(){return {activeHeavy:this.active.heavy,activeSmall:this.active.small,softLimitBytes:this.softLimit};}
}
module.exports={ResourceBudget};
