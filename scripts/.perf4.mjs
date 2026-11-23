import { createJiti } from 'jiti';
import path from 'node:path';
const ROOT = '/home/z/my-project/pixel-world-box';
const noop = () => {};
const makeCtx = () => {
  let m = [1,0,0,1,0,0]; const stack = [];
  const ctx = { canvas: {width:0,height:0},
    save:()=>stack.push([...m]), restore:()=>{if(stack.length)m=stack.pop();},
    setTransform:(a,b,c,d,e,f)=>{m=[a,b,c,d,e,f];},
    translate:(x,y)=>{m[4]+=m[0]*x+m[2]*y;m[5]+=m[1]*x+m[3]*y;},
    scale:(x,y)=>{m[0]*=x;m[1]*=x;m[2]*=y;m[3]*=y;},
    fillRect:noop, drawImage:noop, clearRect:noop,beginPath:noop,arc:noop,fill:noop,stroke:noop,
    moveTo:noop,lineTo:noop,setLineDash:noop,strokeRect:noop,clip:noop,rect:noop,closePath:noop,ellipse:noop,
    createImageData:(w,h)=>({data:new Uint8ClampedArray(Math.max(4,w*h*4)),width:w,height:h}),
    getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(Math.max(4,w*h*4)),width:w,height:h}),
    putImageData:noop,measureText:()=>({width:0}),
    createLinearGradient:()=>({addColorStop:noop}),createRadialGradient:()=>({addColorStop:noop}),
    createPattern:()=>({}) };
  return new Proxy(ctx,{set:()=>true,get:(t,k)=>k in t?t[k]:noop});
};
globalThis.document={createElement:(t)=>t==='canvas'?{width:0,height:0,getContext:()=>makeCtx(),style:{}}:{style:{},appendChild:noop},addEventListener:noop,getElementById:()=>null};
globalThis.localStorage={getItem:()=>null,setItem:noop,removeItem:noop};
globalThis.requestAnimationFrame=noop;
const jiti=createJiti(import.meta.url,{alias:{'@':path.join(ROOT,'src')}});
const {GameEngine}=await jiti.import(path.join(ROOT,'src/lib/game/engine.ts'));
const {R,BUILD_KINDS}=await jiti.import(path.join(ROOT,'src/lib/game/types.ts'));
const {render}=await jiti.import(path.join(ROOT,'src/lib/game/render.ts'));
const eng=new GameEngine(88009477);
const civ=eng.civs[eng.spawnUnit(R.HUMAN,120,80).civ];
for(let k=0;k<300;k++){const u=eng.spawnUnit(R.HUMAN,100+Math.random()*40,65+Math.random()*30,{civ:civ.id});u.age=10;}
for(let k=0;k<40;k++){eng.buildBuilding(((65+(Math.random()*30|0))*256+100+(Math.random()*40|0)),BUILD_KINDS.HOUSE,civ.id);}
eng.cam.zoom=6.5;
render(eng,makeCtx(),1280,800);
const t0=performance.now(); const N=200;
for(let f=0;f<N;f++){eng.frameCount++;render(eng,makeCtx(),1280,800);}
console.log('zoom 6.5:',((performance.now()-t0)/N).toFixed(2),'ms/frame');
