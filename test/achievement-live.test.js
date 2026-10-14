'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const AchievementLive=require('../public/achievement-live');
function clock(){
  let serial=0;const timers=new Map();
  return {setTimeout:(callback,delay)=>{const id=++serial;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),size:()=>timers.size,delay:()=>[...timers.values()][0]?.delay,
    fire:async()=>{const [id,timer]=timers.entries().next().value||[];assert.ok(timer,'Expected a scheduled read.');timers.delete(id);return timer.callback();}};
}
function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}
function fixture(t,options={}){
  const time=clock(),statuses=[];const live=AchievementLive.create({canRun:()=>true,poll:async()=>({}),intervalMs:10,maxDelayMs:60,...time,onStatus:(state,detail)=>statuses.push({state,...detail}),...options});
  t.after(()=>live.stop());return {time,statuses,live};
}
test('monitoring schedules one read, passes cancellation, and schedules the next read after completion',async t=>{
  let calls=0;const {live,time,statuses}=fixture(t,{poll:async(context,{signal})=>{calls++;assert.equal(context.game,550);assert.equal(signal.aborted,false);return {unlocked:70};}});
  live.start({game:550});assert.equal(calls,0);assert.equal(time.size(),1);assert.equal(time.delay(),10);await time.fire();assert.equal(calls,1);assert.equal(time.size(),1);assert.equal(time.delay(),10);assert.deepEqual(statuses.map(s=>s.state),['live','checking','live']);assert.equal(statuses.at(-1).result.unlocked,70);
});
test('concurrent ticks share one poll and wake coalesces to one follow-up',async t=>{
  const gate=deferred();let calls=0,active=0,peak=0;const {live,time}=fixture(t,{poll:async()=>{calls++;peak=Math.max(peak,++active);if(calls===1)await gate.promise;active--;return {calls};}});
  live.start({game:550});const first=live.tick(),second=live.tick(),third=live.wake();assert.equal(calls,1);assert.equal(time.size(),0);gate.resolve();await Promise.all([first,second,third]);assert.equal(peak,1);assert.equal(time.size(),1);assert.equal(time.delay(),0);await time.fire();assert.equal(calls,2);assert.equal(peak,1);assert.equal(time.size(),1);assert.equal(time.delay(),10);
});
test('stop aborts the current read, ignores its late success and leaves no timer',async t=>{
  const gate=deferred();let signal,calls=0;const {live,time,statuses}=fixture(t,{poll:async(_,options)=>{calls++;signal=options.signal;return gate.promise;}});
  live.start({game:550});const task=live.tick();live.stop();assert.equal(signal.aborted,true);const count=statuses.length;gate.resolve({stale:true});await task;assert.equal(statuses.length,count);assert.equal(time.size(),0);await live.tick();await live.wake();assert.equal(calls,1);
});
test('replacement waits for the aborted read to settle and an old response cannot update the new context',async t=>{
  const gate=deferred();let calls=0,oldSignal;const seen=[];const {live,time,statuses}=fixture(t,{poll:async(context,{signal})=>{seen.push(context.game);if(++calls===1){oldSignal=signal;return gate.promise;}return {game:context.game};}});
  live.start({game:550});const oldTask=live.tick();live.start({game:240});const replacement=live.wake();assert.equal(oldSignal.aborted,true);assert.equal(calls,1);assert.equal(time.size(),0);gate.resolve({game:550});await Promise.all([oldTask,replacement]);assert.ok(!statuses.some(s=>s.result?.game===550));assert.equal(time.delay(),0);await time.fire();assert.deepEqual(seen,[550,240]);assert.equal(statuses.at(-1).context.game,240);assert.equal(statuses.at(-1).result.game,240);assert.equal(time.size(),1);
});
test('old failures after replacement cannot back off the new context',async t=>{
  const gate=deferred();let calls=0;const {live,time,statuses}=fixture(t,{poll:async()=>++calls===1?gate.promise:{fresh:true}});
  live.start({game:550});const old=live.tick();live.start({game:240});gate.reject(Error('Old context failed'));await old;assert.equal(time.delay(),10);assert.ok(!statuses.some(s=>s.state==='retrying'));await time.fire();assert.equal(statuses.at(-1).result.fresh,true);assert.equal(time.delay(),10);
});
test('errors back off within the configured cap and one successful read resets the interval',async t=>{
  let fail=true;const {live,time,statuses}=fixture(t,{poll:async()=>{if(fail)throw Error('Steam busy');return {fresh:true};}});live.start({game:550});
  for(const delay of [20,40,60,60,60]){await live.tick();assert.equal(time.size(),1);assert.equal(time.delay(),delay);assert.equal(statuses.at(-1).state,'retrying');assert.equal(statuses.at(-1).delayMs,delay);}
  fail=false;await time.fire();assert.equal(time.delay(),10);assert.equal(statuses.at(-1).state,'live');
});
test('hidden, closed or review-paused availability skips network work and wake resumes immediately',async t=>{
  let allowed=false,calls=0;const {live,time,statuses}=fixture(t,{canRun:()=>allowed,poll:async()=>{calls++;return {};}});live.start({game:550});await live.tick();await time.fire();assert.equal(calls,0);assert.equal(time.delay(),10);assert.equal(statuses.at(-1).state,'paused');allowed=true;await live.wake();assert.equal(calls,1);assert.equal(statuses.at(-1).state,'live');assert.equal(time.delay(),10);live.stop();assert.equal(time.size(),0);
});
test('availability changes before the scheduled read and stopped timers never poll',async t=>{
  let allowed=true,calls=0;const {live,time}=fixture(t,{canRun:()=>allowed,poll:async()=>{calls++;}});live.start({game:550});allowed=false;await time.fire();assert.equal(calls,0);live.stop();assert.equal(time.size(),0);allowed=true;await live.wake();assert.equal(calls,0);
});
test('browser entry is dependency-free and enforces a maximum delay of sixty seconds',async t=>{
  const time=clock(),context={AbortController,...time};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/achievement-live.js'),'utf8'),context);assert.equal(typeof context.AchievementLive.create,'function');const live=context.AchievementLive.create({canRun:()=>true,poll:async()=>{throw Error('Busy');},intervalMs:10000,maxDelayMs:999999,...time,AbortController});t.after(()=>live.stop());live.start({game:550});for(let i=0;i<10;i++)await live.tick();assert.equal(time.delay(),60000);assert.equal(time.size(),1);
});
