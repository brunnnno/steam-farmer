(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.DraftSettings=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const MAX_FIELDS=32;
  function create({document,ids}={}){
    if(!document?.getElementById||!Array.isArray(ids)||ids.length>MAX_FIELDS)throw TypeError('Draft settings require a document and up to 32 field IDs.');
    const fields=new Map();
    for(const id of ids){
      if(typeof id!=='string'||!id||id.length>128)throw TypeError('Invalid draft setting ID.');
      if(fields.has(id))continue;
      const input=document.getElementById(id);
      if(!input||!('value' in input))throw TypeError('Draft setting field is unavailable: '+id);
      const field={input,dirty:false,version:0};
      fields.set(id,field);
    }
    const names=[...fields.keys()];
    for(const field of fields.values()){
      field.onEdit=()=>{field.dirty=true;field.version++;};
      field.input.addEventListener('input',field.onEdit);field.input.addEventListener('change',field.onEdit);
    }
    const selected=names=>Array.isArray(names)?names:[];
    return Object.freeze({
      apply(id,value){
        const field=fields.get(id);
        if(!field||field.dirty||document.activeElement===field.input)return false;
        if(field.input.type==='checkbox')field.input.checked=Boolean(value);
        else field.input.value=value==null?'':String(value);
        return true;
      },
      snapshot(requested=names){
        return Object.freeze(Object.fromEntries(selected(requested).filter(id=>fields.has(id)).map(id=>[id,fields.get(id).version])));
      },
      commit(names,versions){
        for(const id of selected(names)){
          const field=fields.get(id);if(!field)continue;
          if(versions&&(!Object.hasOwn(versions,id)||versions[id]!==field.version))continue;
          field.dirty=false;
        }
      },
      reset(){for(const field of fields.values()){field.dirty=false;field.version++;}},
      dispose(){for(const field of fields.values()){field.input.removeEventListener('input',field.onEdit);field.input.removeEventListener('change',field.onEdit);}fields.clear();}
    });
  }
  return Object.freeze({create});
});
