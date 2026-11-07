// Process files separately so a large batch never raises the API request limit.
export function bindIconUploads({api,categoryOptions,loadIcons,notice}){
 const $=s=>document.querySelector(s),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let queue=[],busy=false,checking=false;
 const read=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Could not read the file'));reader.readAsDataURL(file);});
 function reconcile(){const seen=new Map();for(const item of queue){if(!item.fingerprint||item.duplicate||item.status==='uploaded'||item.status==='checking'||item.status==='invalid')continue;if(seen.has(item.fingerprint))item.status='repeat';else{if(item.status==='repeat')item.status='ready';seen.set(item.fingerprint,item.id);}}}
 function eligible(item){return ['ready','failed'].includes(item.status)&&!item.duplicate;}
 function paint(){
  $('#uploadQueue').innerHTML=queue.map(item=>`<article class="upload-entry" data-upload-row="${item.id}"><img src="${item.url}" alt="Preview of ${esc(item.file.name)}"><div class="upload-entry-name"><label>Name<input data-upload-name="${item.id}" value="${esc(item.name)}" maxlength="80" ${eligible(item)?'required':''} ${busy||!eligible(item)?'disabled':''}></label><small>${esc(item.file.name)}</small></div><label>Category<select data-upload-category="${item.id}" ${busy||!eligible(item)?'disabled':''}>${categoryOptions(item.category)}</select></label><p class="upload-status ${item.status}" role="status">${esc(item.duplicate?'Already exists: '+item.duplicate.name+(item.duplicate.enabled?'':' (removed — restore it in the library)'):({checking:'Checking image…',ready:'Ready to upload',repeat:'Duplicate in this selection',uploaded:'Uploaded',uploading:'Uploading…',invalid:item.error,failed:item.error}[item.status]||''))}</p><button type="button" data-remove-upload="${item.id}" aria-label="Remove ${esc(item.file.name)} from selection" ${busy||checking?'disabled':''}>×</button></article>`).join('');
  const ready=queue.filter(eligible).length;$('#uploadSummary').textContent=queue.length?`${queue.length} files · ${ready} ready · ${queue.filter(i=>i.status==='uploaded').length} uploaded`:'';
  $('#uploadIcons').disabled=busy||checking||!ready;$('#uploadIcons').textContent=busy?'Uploading…':`Upload${ready?' ('+ready+')':''}`;$('#clearUploadQueue').hidden=!queue.length;$('#clearUploadQueue').disabled=busy||checking;$('#uploadFile').disabled=busy||checking;
 }
 function remove(item){URL.revokeObjectURL(item.url);queue=queue.filter(i=>i!==item);reconcile();paint();}
 $('#uploadQueue').oninput=e=>{const item=queue.find(i=>i.id===e.target.dataset.uploadName);if(item)item.name=e.target.value;};
 $('#uploadQueue').onchange=e=>{const item=queue.find(i=>i.id===e.target.dataset.uploadCategory);if(item)item.category=e.target.value;};
 $('#uploadQueue').onclick=e=>{const button=e.target.closest('[data-remove-upload]');if(button&&!busy&&!checking)remove(queue.find(i=>i.id===button.dataset.removeUpload));};
 $('#clearUploadQueue').onclick=()=>{if(busy||checking)return;for(const item of queue)URL.revokeObjectURL(item.url);queue=[];paint();};
 $('#uploadFile').onchange=async e=>{
  const files=[...e.target.files];e.target.value='';if(!files.length)return;
  if(queue.length+files.length>100){notice('Select up to 100 files at a time. Clear the list to start another batch.');return;}
  const added=files.map(file=>({id:crypto.randomUUID(),file,url:URL.createObjectURL(file),name:file.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').trim().slice(0,80),category:$('#uploadCategory').value,status:'checking'}));queue.push(...added);checking=true;paint();
  try{for(const item of added){try{if(item.file.size>1000000)throw Error('Maximum file size is 1 MB');const result=await api('/icons/check',{image:await read(item.file)});item.fingerprint=result.fingerprint;item.duplicate=result.duplicate;item.status=result.duplicate?'duplicate':'ready';}catch(error){item.status='invalid';item.error=error.message;}reconcile();paint();}}finally{checking=false;paint();}
 };
 $('#uploadCategory').onchange=()=>{for(const item of queue)if(eligible(item))item.category=$('#uploadCategory').value;paint();};
 $('#iconUpload').onsubmit=async e=>{
  e.preventDefault();if(busy||checking)return;const selected=queue.filter(eligible);if(!selected.length)return;busy=true;let uploaded=0,failed=0;
  try{for(const item of selected){item.status='uploading';paint();try{const result=await api('/icons',{name:item.name.trim(),category:item.category,image:await read(item.file)});item.status='uploaded';for(const other of queue)if(other!==item&&other.fingerprint===item.fingerprint&&other.status!=='uploaded'){other.duplicate={id:result.id,name:item.name.trim(),enabled:true};other.status='duplicate';}uploaded++;}catch(error){item.duplicate=error.duplicate;item.status=item.duplicate?'duplicate':'failed';item.error=error.message;failed++;}paint();}
   await loadIcons();notice(`${uploaded} icons uploaded${failed?' · '+failed+' could not be uploaded. Check the file list.':'. Available in the main website picker.'}`);
  }catch(error){notice(error.message);}finally{busy=false;reconcile();paint();}
 };paint();
}
