// Diagnostic views of the same supplied dummy, outside gameplay.
import {Scene,Color,AmbientLight,DirectionalLight,WebGLRenderer,OrthographicCamera,Box3,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const asset=await new GLTFLoader().loadAsync('/local-world-assets/targets/Training-dummy.glb');
const scene=new Scene();scene.background=new Color('#30363f');scene.add(asset.scene,new AmbientLight(0xffffff,2));
const light=new DirectionalLight(0xffffff,3);light.position.set(3,5,4);scene.add(light);
const center=new Box3().setFromObject(asset.scene).getCenter(new Vector3());
for(const [name,x,z] of [['+X',4,0],['-X',-4,0],['+Z',0,4],['-Z',0,-4]]){
  const wrapper=document.createElement('div'),label=document.createElement('h2');label.textContent=name;wrapper.append(label);document.body.append(wrapper);
  const renderer=new WebGLRenderer({antialias:true});renderer.setSize(300,440);wrapper.append(renderer.domElement);
  const camera=new OrthographicCamera(-1.5,1.5,2.2,-2.2,.1,20);camera.position.copy(center).add(new Vector3(x,.15,z));camera.lookAt(center);renderer.render(scene,camera);
}
document.body.dataset.ready='true';
