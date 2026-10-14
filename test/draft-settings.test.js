'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');const fs=require('node:fs');const path=require('node:path');
const DraftSettings=require('../public/draft-settings');
function fixture(t){
  const dom=new JSDOM('<input id="start"><input id="end"><input id="enabled" type="checkbox"><input id="zone"><input id="status"><button id="save">Save</button>',{runScripts:'outside-only'});
  t.after(()=>dom.window.close());const document=dom.window.document,ids=['start','end','enabled','zone','status'];
  const drafts=DraftSettings.create({document,ids});t.after(()=>drafts.dispose());
  const edit=(id,value,event='input')=>{const input=document.getElementById(id);if(input.type==='checkbox')input.checked=value;else input.value=value;input.dispatchEvent(new dom.window.Event(event,{bubbles:true}));};
  return {dom,document,drafts,ids,edit};
}
test('status polling preserves draft schedule and status while the user moves between fields',t=>{
  const {document,drafts,edit}=fixture(t);drafts.apply('start',3);drafts.apply('end',8);drafts.apply('enabled',false);drafts.apply('zone','America/Montevideo');drafts.apply('status','');
  document.getElementById('start').focus();edit('start','22');document.getElementById('end').focus();edit('enabled',true,'change');edit('zone','UTC');edit('status','My draft');document.getElementById('save').focus();
  for(let i=0;i<3;i++){drafts.apply('start',3);drafts.apply('end',8);drafts.apply('enabled',false);drafts.apply('zone','America/Montevideo');drafts.apply('status','');}
  assert.equal(document.getElementById('start').value,'22');assert.equal(document.getElementById('enabled').checked,true);assert.equal(document.getElementById('zone').value,'UTC');assert.equal(document.getElementById('status').value,'My draft');
  assert.equal(document.getElementById('end').value,'8');
});
test('focused untouched fields stay stable and successful save clears only the committed form',t=>{
  const {document,drafts,edit}=fixture(t);drafts.apply('start',3);drafts.apply('end',8);document.getElementById('end').focus();assert.equal(drafts.apply('end',9),false);assert.equal(document.getElementById('end').value,'8');
  edit('start','22');edit('status','Keep this draft');document.getElementById('save').focus();drafts.commit(['start']);assert.equal(drafts.apply('start',23),true);assert.equal(drafts.apply('status','Server status'),false);
  assert.equal(document.getElementById('start').value,'23');assert.equal(document.getElementById('status').value,'Keep this draft');assert.equal(drafts.apply('end',9),true);
});
test('an edit made while a save is pending survives its successful response and account reset clears it',t=>{
  const {document,drafts,edit,ids}=fixture(t);edit('start','22');edit('enabled',true,'change');const saved=drafts.snapshot(['start','enabled']);edit('start','23');
  drafts.commit(['start','enabled'],saved);assert.equal(drafts.apply('start',22),false);assert.equal(drafts.apply('enabled',true),true);assert.equal(document.getElementById('start').value,'23');
  const oldAccount=drafts.snapshot(ids);drafts.reset();edit('start','20');drafts.commit(ids,oldAccount);assert.equal(drafts.apply('start',3),false);drafts.reset();assert.equal(drafts.apply('start',3),true);assert.equal(document.getElementById('start').value,'3');assert.equal(drafts.apply('enabled',false),true);assert.equal(document.getElementById('enabled').checked,false);
});
test('field tracking is bounded and unknown IDs cannot mutate arbitrary controls',t=>{
  const {document,drafts,edit}=fixture(t);assert.throws(()=>DraftSettings.create({document,ids:Array(33).fill('start')}),/up to 32/);assert.throws(()=>DraftSettings.create({document,ids:['missing']}),/unavailable/);assert.throws(()=>DraftSettings.create({document,ids:[null]}),/Invalid/);
  assert.equal(drafts.apply('save','Changed'),false);edit('status','Draft');drafts.commit(['save']);assert.equal(drafts.apply('status','Server'),false);drafts.dispose();edit('status','After disposal');assert.equal(drafts.apply('status','Server'),false);
});
test('browser entry exposes the same draft protection without loading Node dependencies',t=>{
  const {dom,document}=fixture(t);dom.window.eval(fs.readFileSync(path.join(__dirname,'../public/draft-settings.js'),'utf8'));const drafts=dom.window.DraftSettings.create({document,ids:['zone']});
  drafts.apply('zone','UTC');document.getElementById('zone').value='America/Montevideo';document.getElementById('zone').dispatchEvent(new dom.window.Event('input'));assert.equal(drafts.apply('zone','UTC'),false);assert.equal(document.getElementById('zone').value,'America/Montevideo');drafts.dispose();
});
