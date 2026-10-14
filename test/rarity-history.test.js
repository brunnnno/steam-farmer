'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPercentageReader}=require('../lib/rarity-history');
const good=()=>({appid:550,percentages:{A:2,B:10,C:25},titlePercentages:{},checkedAt:'2026-10-14T04:00:00Z',source:'Steam API',rarityStatus:'available'});
const bad=()=>({appid:550,percentages:{},titlePercentages:{},rarityStatus:'suspect_uniform_100'});
test('an anomalous live response preserves the last valid percentages with explicit historical provenance',async()=>{
  let fail=false,time=Date.parse('2026-10-14T16:00:00Z');const reader=createPercentageReader({snapshots:[],now:()=>time,read:async()=>fail?bad():good()});
  const current=await reader(550);current.percentages.A=99;fail=true;const historic=await reader(550);
  assert.equal(historic.percentages.A,2);assert.equal(historic.rarityStatus,'historical');assert.equal(historic.checkedAt,'2026-10-14T04:00:00Z');assert.match(historic.rarityMessage,/Last known/);
  historic.percentages.A=80;assert.equal((await reader(550)).percentages.A,2);time+=8*86400000;assert.equal((await reader(550)).rarityStatus,'suspect_uniform_100');
});
test('the official L4D2 indexed fallback has all 101 unique titles, source and expiry, and live data wins',async()=>{
  const now=()=>Date.parse('2026-10-14T16:00:00Z');let live=false;const reader=createPercentageReader({now,read:async()=>live?good():bad()});const r=await reader(550);
  assert.equal(Object.keys(r.titlePercentages).length,101);assert.equal(r.titlePercentages.cl0wnd,9.8);assert.equal(r.titlePercentages['gnome alone'],69.6);assert.equal(r.rarityStatus,'historical');assert.match(r.sourceUrl,/steamcommunity.com/);assert.match(r.rarityMessage,/exact original date unavailable/);
  live=true;assert.equal((await reader(550)).rarityStatus,'available');await assert.rejects(reader(240),/different game/);
  const expired=createPercentageReader({now:()=>Date.parse('2026-11-05T00:00:00Z'),read:async()=>bad()});assert.equal((await expired(550)).rarityStatus,'suspect_uniform_100');
});
test('fallback does not transfer another game or retain invalid uniform data, and has a 256 KiB bound',async()=>{
  const reader=createPercentageReader({snapshots:[],read:async id=>({...good(),appid:id})});for(let id=1;id<=100;id++)await reader(id);assert.ok(reader.bytes()<=256*1024);reader.clear();assert.equal(reader.bytes(),0);
  const missing=createPercentageReader({now:()=>Date.parse('2026-10-14T16:00:00Z'),read:async()=>{throw Error('Unavailable');}});await assert.rejects(missing(240),/Unavailable/);assert.equal((await missing(550)).historical,true);
});
