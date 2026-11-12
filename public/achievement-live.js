(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.AchievementLive=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  function create(options={}){
    const {canRun,poll,onStatus=()=>{}}=options;
    if(typeof canRun!=='function'||typeof poll!=='function'||typeof onStatus!=='function')throw TypeError('Live achievements require polling and availability callbacks.');
    const intervalMs=Number.isFinite(options.intervalMs)&&options.intervalMs>0?Math.min(60000,options.intervalMs):10000;
    const maxDelayMs=Number.isFinite(options.maxDelayMs)&&options.maxDelayMs>0?Math.max(intervalMs,Math.min(60000,options.maxDelayMs)):60000;
    const setTimer=options.setTimeout||globalThis.setTimeout,clearTimer=options.clearTimeout||globalThis.clearTimeout;
    const Controller=options.AbortController||globalThis.AbortController;
    if(typeof setTimer!=='function'||typeof clearTimer!=='function'||typeof Controller!=='function')throw TypeError('Live achievements require timers and cancellation support.');
    let active=false,context,generation=0,timer=null,inFlight=null,wakeGeneration=null,failures=0;
    const current=record=>active&&record.generation===generation;
    function cancelTimer(){if(timer!==null){clearTimer(timer);timer=null;}}
    function schedule(delay){
      if(!active)return;cancelTimer();const scheduledGeneration=generation;
      timer=setTimer(()=>{timer=null;if(active&&scheduledGeneration===generation)return tick();},delay);
    }
    function notify(state,detail={}){onStatus(state,{context,...detail});}
    function stop(notifyPaused=true){
      const oldContext=context,wasActive=active;active=false;generation++;cancelTimer();wakeGeneration=null;failures=0;
      if(inFlight)inFlight.controller.abort();context=undefined;
      if(notifyPaused&&wasActive)onStatus('paused',{context:oldContext});
    }
    async function tick(){
      if(!active)return;cancelTimer();
      if(inFlight){wakeGeneration=generation;return inFlight.task;}
      if(!canRun(context)){notify('paused');schedule(intervalMs);return;}
      const record={generation,context,controller:new Controller(),task:null};inFlight=record;wakeGeneration=null;
      record.task=(async()=>{
        let delay=intervalMs,failed=false;
        try{
          notify('checking');if(!current(record)||record.controller.signal.aborted)return;
          const result=await poll(record.context,{signal:record.controller.signal});
          if(!current(record)||record.controller.signal.aborted)return;
          failures=0;notify('live',{result,delayMs:intervalMs});return result;
        }catch(error){
          if(!current(record)||record.controller.signal.aborted)return;
          failed=true;failures=Math.min(16,failures+1);delay=Math.min(maxDelayMs,intervalMs*2**failures);
          notify('retrying',{error,delayMs:delay});
        }finally{
          if(inFlight===record)inFlight=null;
          if(active){
            const requestedWake=wakeGeneration===generation;wakeGeneration=null;
            if(current(record))schedule(requestedWake&&!failed?0:delay);
            else if(requestedWake)schedule(0);
            else if(timer===null)schedule(intervalMs);
          }
        }
      })();
      return record.task;
    }
    return Object.freeze({
      start(nextContext){
        stop(false);context=nextContext;active=true;
        notify(canRun(context)?'live':'paused',{delayMs:intervalMs});schedule(intervalMs);
      },
      stop(){stop();},
      wake(){if(!active)return Promise.resolve();return tick();},
      tick
    });
  }
  return Object.freeze({create});
});
