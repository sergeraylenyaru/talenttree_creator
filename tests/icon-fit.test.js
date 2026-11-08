import test from 'node:test';
import assert from 'node:assert/strict';
import {iconContentBox} from '../static/icon-fit.js';
function image(width,height,background,rect,color){const pixels=new Uint8ClampedArray(width*height*4);for(let i=0;i<pixels.length;i+=4)pixels.set(background,i);if(rect)for(let y=rect[1];y<rect[3];y++)for(let x=rect[0];x<rect[2];x++)pixels.set(color,(y*width+x)*4);return pixels;}
test('fits artwork past transparent padding, including hidden RGB values',()=>{assert.deepEqual(iconContentBox(image(64,64,[100,20,30,0],[16,12,48,52],[0,100,255,255]),64,64),[16,12,32,40]);});
test('fits artwork past a uniform black border without removing black inside the drawing',()=>{
 const pixels=image(64,64,[0,0,0,255],[8,8,56,56],[255,100,0,255]);pixels.set([0,0,0,255],(30*64+30)*4);
 assert.deepEqual(iconContentBox(pixels,64,64),[8,8,48,48]);
});
test('preserves full-frame artwork, colored borders, and empty images',()=>{
 for(const color of [[0,0,0,0],[0,0,0,255],[255,200,0,255]])assert.deepEqual(iconContentBox(image(32,32,color),32,32),[0,0,32,32]);
 assert.deepEqual(iconContentBox(image(64,64,[255,200,0,255],[8,8,56,56],[0,0,255,255]),64,64),[0,0,64,64]);
});
