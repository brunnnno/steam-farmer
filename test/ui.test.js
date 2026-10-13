'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
function ui(t, responder) {
  const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8'),{url:'https://panel.example',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window;w.AbortSignal=AbortSignal;
  w.fetch=async(url)=>url==='/api/panel/session'?new Promise(()=>{}):({ok:true,status:200,json:async()=>responder(url)});
  w.eval(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8')+`\nwindow.testUI={open:openAchModal,close:closeAchModal,filter:setFilter,search:onSearchInput,refresh:forceRefreshAchievements,select:id=>{activeAccountId=id;}};`);
  w.testUI.select('a');return w;
}
const response=rows=>({achievements:rows,source:'Steam test',checkedAt:new Date().toISOString()});
test('cambiar de juego limpia filtros y búsquedas que ocultaban logros',async t=>{
  const w=ui(t,()=>response([{name:'First',description:'',unlocked:false,percent:25}]));
  await w.testUI.open(240,'One');w.testUI.search('nothing');assert.equal(w.document.querySelectorAll('.ach-item').length,0);
  w.testUI.filter('status','unlocked');await w.testUI.open(550,'Two');assert.equal(w.document.querySelectorAll('.ach-item').length,1);assert.equal(w.document.getElementById('achSearchInput').value,'');
});
test('Actualización manual evita caché y no arrastra respuestas de otros juegos',async t=>{
  const urls=[];const w=ui(t,url=>{urls.push(url);return response([{name:'One',unlocked:false,percent:null}]);});
  await w.testUI.open(240,'One');w.testUI.search('One');await w.testUI.refresh();assert.ok(urls.at(-1).includes('refresh=1'));assert.equal(w.document.querySelectorAll('.ach-item').length,1);
});
test('normaliza rareza ausente o texto y conserva estado sin verificar',async t=>{
  const w=ui(t,()=>response([{name:'Unknown',unlocked:null},{name:'String percent',unlocked:false,percent:'0.0'}]));await w.testUI.open(240,'One');
  assert.equal(w.document.querySelectorAll('.ach-item').length,2);assert.match(w.document.getElementById('achListContainer').textContent,/Rareza desconocida/);assert.match(w.document.getElementById('achListContainer').textContent,/0.0%/);assert.match(w.document.getElementById('achProgressText').textContent,/1 sin verificar/);
});
test('modal permite cerrar con Escape y restaura scroll del documento',async t=>{
  const w=ui(t,()=>response(Array.from({length:200},(_,i)=>({name:`Achievement ${i}`,unlocked:false,percent:null}))));await w.testUI.open(240,'Many');assert.equal(w.document.querySelectorAll('.ach-item').length,200);assert.ok(w.document.body.classList.contains('achievement-open'));
  w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(w.document.getElementById('achModal').style.display,'none');assert.ok(!w.document.body.classList.contains('achievement-open'));
});
test('respuesta lenta anterior no reemplaza el juego recién abierto',async t=>{
  let release;const w=ui(t,url=>url.includes('appid=240')?new Promise(r=>release=r):response([{name:'New game',unlocked:false,percent:null}]));
  const old=w.testUI.open(240,'Old');await w.testUI.open(550,'New');release(response([{name:'Stale',unlocked:false,percent:null}]));await old;assert.equal(w.document.querySelector('.ach-title').textContent,'New game');
});
