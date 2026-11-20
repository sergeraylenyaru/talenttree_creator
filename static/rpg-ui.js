export const label = key => String(key).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/^./,char=>char.toUpperCase());
export const format = new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format;

export function element(tag, text, className){
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  if(className)node.className=className;
  return node;
}
export function button(name,run){
  const result=element('button',name);
  result.type='button';
  result.onclick=run;
  return result;
}
export function field(name,value,onChange,options={}){
  const wrapper=element('label');
  wrapper.append(element('span',name));
  const input=element(options.choices?'select':options.multiline?'textarea':'input');
  input.name=options.key??name;
  if(options.choices){
    for(const entry of options.choices){
      const [id,title]=Array.isArray(entry)?entry:[entry,label(entry)];
      input.append(new Option(title,id));
    }
  }else if(options.number){
    input.type='number';input.step=options.step??'any';
    input.min=options.min??0;input.max=options.max??1e8;
  }else if(options.check)input.type='checkbox';
  if(options.check)input.checked=Boolean(value);
  else input.value=value??'';
  input.onchange=()=>onChange(options.check?input.checked:options.number&&input.value!==''?input.valueAsNumber:input.value);
  wrapper.append(input);
  return wrapper;
}
export function section(title,...children){
  const root=element('section',undefined,'rpg-section');
  root.append(element('h3',title),...children);
  return root;
}
export function grid(...children){
  const root=element('div',undefined,'rpg-grid');
  root.append(...children);
  return root;
}
export function table(headers,rows){
  const root=element('div',undefined,'rpg-table-wrap');
  const t=element('table');
  const head=t.createTHead().insertRow();
  for(const header of headers)head.append(element('th',header));
  const body=t.createTBody();
  for(const row of rows){
    const tr=body.insertRow();
    for(const item of row){
      const cell=tr.insertCell();
      if(item instanceof Node)cell.append(item);
      else cell.textContent=typeof item==='number'?format(item):item??'—';
    }
  }
  root.append(t);
  return root;
}
export function download(name,text,type='application/json'){
  const link=element('a');
  link.href=URL.createObjectURL(new Blob([text],{type}));
  link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),0);
}
export function tabs(root, choose, pages){
  const nav=element('div',undefined,'rpg-tabs');
  nav.setAttribute('role','group');
  for(const title of pages){
    const option=button(title,()=>choose(title));
    option.setAttribute('aria-pressed',String(title===root));
    nav.append(option);
  }
  return nav;
}
