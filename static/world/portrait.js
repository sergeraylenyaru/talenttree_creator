import {AmbientLight, Color, DirectionalLight, PerspectiveCamera, Scene, SRGBColorSpace,
  WebGLRenderTarget} from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';

export function capturePortrait(renderer, model, bounds, hero) {
  const size = 112;
  const output = new WebGLRenderTarget(size, size);
  output.texture.colorSpace = SRGBColorSpace;
  const scene = new Scene();
  scene.background = new Color(hero ? 0x23354a : 0x46372b);
  const subject = clone(model);
  const light = new DirectionalLight(0xffebd2, 2);
  light.position.set(2, 4, hero ? -3 : 3);
  scene.add(subject, light, new AmbientLight(0xe9efff, 1.5));
  const height = bounds.max[1] - bounds.min[1];
  const y = bounds.max[1] - height * (hero ? 0.13 : 0.38);
  const camera = new PerspectiveCamera(35,1,.03,30);
  camera.position.set(hero ? .20 : height*.50, y+.05, -height*(hero?.54:.24));
  camera.lookAt(0,y,0);
  const pixels = new Uint8Array(size*size*4);
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(output);
    renderer.render(scene,camera);
    renderer.readRenderTargetPixels(output,0,0,size,size,pixels);
  } finally {
    renderer.setRenderTarget(previous);
    output.dispose();
    const skeletons = new Set();
    subject.traverse(node => { if (node.isSkinnedMesh) skeletons.add(node.skeleton); });
    for (const skeleton of skeletons) skeleton.dispose();
  }
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=size;
  const context=canvas.getContext('2d');
  const image=context.createImageData(size,size);
  for(let row=0;row<size;row++) image.data.set(pixels.subarray(row*size*4,(row+1)*size*4),(size-row-1)*size*4);
  context.putImageData(image,0,0);
  return canvas.toDataURL();
}
