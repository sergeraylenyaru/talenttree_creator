// Fit artwork inside icon frames without changing stored images or their IDs.
export function iconContentBox(pixels,width,height){
 const corners=[0,(width-1)*4,(height-1)*width*4,(height*width-1)*4],color=[...pixels.slice(0,4)];
 const blackBorder=color[3]===255&&Math.max(...color.slice(0,3))<=16&&corners.every(i=>color.every((v,c)=>pixels[i+c]===v));
 let left=width,top=height,right=-1,bottom=-1;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,empty=pixels[i+3]===0||(blackBorder&&color.every((v,c)=>pixels[i+c]===v));
  if(!empty){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
 }
 return right<left?[0,0,width,height]:[left,top,right-left+1,bottom-top+1];
}
export function initIconFitting(){
 const selector='img[src^="/media/icons/"],.admin-icon-grid img,.upload-entry img',seen=new WeakMap(),cache=new Map();
 function fit(img){
  if(!img.matches(selector))return;const source=img.src;if(seen.get(img)===source)return;seen.set(img,source);
  const apply=()=>{
   if(img.src!==source||!img.naturalWidth)return;
   try{
    if(!cache.has(source)){
     const sample=document.createElement('canvas'),scale=Math.min(1,256/Math.max(img.naturalWidth,img.naturalHeight));
     sample.width=Math.max(1,Math.round(img.naturalWidth*scale));sample.height=Math.max(1,Math.round(img.naturalHeight*scale));
     const context=sample.getContext('2d',{willReadFrequently:true});context.drawImage(img,0,0,sample.width,sample.height);
     const [x,y,w,h]=iconContentBox(context.getImageData(0,0,sample.width,sample.height).data,sample.width,sample.height);
     let fitted=source;
     if(x||y||w!==sample.width||h!==sample.height){
      const output=document.createElement('canvas');output.width=output.height=128;const target=output.getContext('2d'),zoom=Math.max(128/w,128/h),dw=w*zoom,dh=h*zoom;
      target.imageSmoothingQuality='high';target.drawImage(img,x*img.naturalWidth/sample.width,y*img.naturalHeight/sample.height,w*img.naturalWidth/sample.width,h*img.naturalHeight/sample.height,(128-dw)/2,(128-dh)/2,dw,dh);fitted=output.toDataURL('image/png');
     }
     cache.set(source,fitted);if(cache.size>256)cache.delete(cache.keys().next().value);
    }
    const fitted=cache.get(source);if(fitted&&fitted!==source){seen.set(img,fitted);img.src=fitted;}
   }catch{/* Leave the original visible if browser image access is unavailable. */}
  };
  if(img.complete)apply();else img.addEventListener('load',apply,{once:true});
 }
 function scan(root){if(root.nodeType!==1)return;if(root.matches(selector))fit(root);for(const img of root.querySelectorAll(selector))fit(img);}
 new MutationObserver(records=>{for(const record of records){if(record.type==='attributes')fit(record.target);else for(const node of record.addedNodes)scan(node);}}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
 scan(document.body);
}
