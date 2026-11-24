// Geocentric sphere expressed in the observer's east/north/up frame (kilometres).
window.AtlasWorld = (() => {
'use strict';
const baseURL=new URL('.',document.currentScript?.src||new URL('observatory/world.js',document.baseURI));
const D=window.AtlasWorldData,R=6371.0088,deg=Math.PI/180,lat0=18.79*deg,lon0=98.985*deg;
const finite=Number.isFinite,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),mix=(a,b,t)=>a+(b-a)*t;
// Six-hour GFS accumulation in mm. Color grows continuously from trace to heavy rain.
const regionalRainStops=[
 [0.05,143,202,207,0],[0.5,111,217,228,94],[2,66,178,223,154],
 [10,89,128,237,202],[25,170,133,239,225],[50,241,184,235,240]
];
const regionalRainMax=Math.log1p(regionalRainStops.at(-1)[0]);
const regionalRainRamp=new Uint8ClampedArray(256*4);
for(let i=0,band=1;i<256;i++){
 const value=i*regionalRainMax/255;
 while(band<regionalRainStops.length-1&&value>Math.log1p(regionalRainStops[band][0]))band++;
 const low=regionalRainStops[band-1],high=regionalRainStops[band];
 const f=clamp((value-Math.log1p(low[0]))/(Math.log1p(high[0])-Math.log1p(low[0])),0,1);
 for(let ch=0;ch<4;ch++)regionalRainRamp[i*4+ch]=mix(low[ch+1],high[ch+1],f);
}
const add=(a,b)=>a.map((x,i)=>x+b[i]),sub=(a,b)=>a.map((x,i)=>x-b[i]),mul=(v,k)=>v.map(a=>a*k);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=v=>mul(v,1/(Math.hypot(...v)||1)),lerp=(a,b,t)=>a.map((x,i)=>mix(x,b[i],t));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x)};
function geo(lo,la,z=0){
 const a=la*deg,b=lo*deg-lon0,r=R+z,ca=Math.cos(a),sa=Math.sin(a);
 return [r*ca*Math.sin(b),r*(sa*Math.cos(lat0)-ca*Math.cos(b)*Math.sin(lat0)),r*(sa*Math.sin(lat0)+ca*Math.cos(b)*Math.cos(lat0))-R];
}
function fromLocal(e,n){const a=Math.atan2(e,n),d=Math.hypot(e,n)/R;
 const p=Math.asin(Math.sin(lat0)*Math.cos(d)+Math.cos(lat0)*Math.sin(d)*Math.cos(a));
 return [(lon0+Math.atan2(Math.sin(a)*Math.sin(d)*Math.cos(lat0),Math.cos(d)-Math.sin(lat0)*Math.sin(p)))/deg,p/deg]}
function decode(block){
 const b=Uint8Array.from(atob(block.z),c=>c.charCodeAt(0)),arr=new Int16Array(b.length/2);
 for(let i=0;i<arr.length;i++)arr[i]=b[i*2]+256*b[i*2+1];
 return {...block,z:arr};
}
const patches=[decode(D.region),decode(D.province),decode(D.near)];
const peaks={'mon-long':{name:'Doi Mon Long',ll:[98.8352842,18.9200572]},suthep:{name:'Doi Suthep',ll:[98.89236,18.816608]},pui:{name:'Doi Pui',ll:[98.88854,18.831757]}};
function inside(lo,la,box){return lo>=box[0]&&lo<=box[2]&&la>=box[1]&&la<=box[3]}
function elevation(lo,la){
 for(let n=patches.length-1;n>=0;n--){const {box,w,h,z}=patches[n];if(!inside(lo,la,box))continue;
 const x=clamp((lo-box[0])/(box[2]-box[0])*(w-1),0,w-1.00001),y=clamp((la-box[1])/(box[3]-box[1])*(h-1),0,h-1.00001);
 const i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j,k=j*w+i;return mix(mix(z[k],z[k+1],u),mix(z[k+w],z[k+w+1],u),v)}
 return null;
}
const localGround=(e,n)=>elevation(...fromLocal(e,n));
const poseGround=elevation(98.985,18.79)+1.7;
const scales=['window','province','region','global'];
// All cartographic patches yield to the continuous sphere before the planetary field fades in.
function patchVisible(index,travel){
 if(index===1)return travel>.28&&travel<2.16;
 if(index===2)return travel>.12&&travel<2.15;
 return (index===3||index===4)&&travel<2.15;
}
function mesh(w,h,point,skip){
 const pos=new Float32Array(w*h*3),col=new Float32Array(w*h*3),uv=new Float32Array(w*h*2),ind=[];
 for(let j=0;j<h;j++)for(let i=0;i<w;i++){
  const k=j*w+i,v=point(i,j);pos.set(v.p,k*3);col.set(v.c,k*3);uv.set(v.uv,k*2);
  if(i<w-1&&j<h-1&&(!skip||!skip(i,j)))ind.push(k,k+1,k+w+1,k,k+w+1,k+w);
 }
 return {pos,col,uv,ind:new Uint16Array(ind),w,h};
}
const assets=[],layout=patches.map(p=>({box:p.box.slice(),hole:null}));
const opticalBasin=[98.53,18.49,99.27,19.16],opticalHighlands=patches[1].box,opticalRegion=[70,-8,133,40];
for(let level=1;level<patches.length;level++){
 const parent=layout[level-1],p=patches[level-1],child=patches[level],box=parent.box;
 const dx=(box[2]-box[0])/(p.w-1),dy=(box[3]-box[1])/(p.h-1);
 const hole=child.box.map((v,k)=>Math.round((v-box[k%2])/(k%2?dy:dx)));
 parent.hole=hole;layout[level].box=[box[0]+hole[0]*dx,box[1]+hole[1]*dy,box[0]+hole[2]*dx,box[1]+hole[3]*dy];
}
const cragDetail=window.AtlasCragTerrain;
if(cragDetail?.patch){
 const p=decode(cragDetail.patch),parent=layout[1],coarse=patches[1],b=parent.box;
 const dx=(b[2]-b[0])/(coarse.w-1),dy=(b[3]-b[1])/(coarse.h-1);
 const hole=p.box.map((v,k)=>(k<2?Math.floor:Math.ceil)((v-b[k%2])/(k%2?dy:dx)));
 parent.cragHole=hole;patches.push(p);layout.push({box:[b[0]+hole[0]*dx,b[1]+hole[1]*dy,b[0]+hole[2]*dx,b[1]+hole[3]*dy]});
}
function patchSample(p,lo,la){
 const [w,s,e,n]=p.box,x=clamp((lo-w)/(e-w)*(p.w-1),0,p.w-1.0001),y=clamp((la-s)/(n-s)*(p.h-1),0,p.h-1.0001);
 const i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j,k=j*p.w+i;
 return mix(mix(p.z[k],p.z[k+1],u),mix(p.z[k+p.w],p.z[k+p.w+1],u),v);
}
function geography(index){
 if(assets[index])return assets[index];
 if(index===0)return assets[0]=mesh(145,73,(i,j)=>({p:geo(i*2.5-180,j*2.5-90),c:[1,1,1],uv:[i/144,1-j/72]}));
 const level=index-1,p=patches[level],apron=level===3?1:0,w=p.w+2*apron,h=p.h+2*apron,{box,hole}=layout[level];
 const source=apron?p.box:box,dx=(source[2]-source[0])/(p.w-1),dy=(source[3]-source[1])/(p.h-1);
 const parent=level===3?1:level-1,coarse=level?geography(parent+1):null,pc=level?patches[parent]:null,pb=level?layout[parent].box:null;
 function underlying(lo,la){
  const x=clamp((lo-pb[0])/(pb[2]-pb[0])*(pc.w-1),0,pc.w-1.0001),y=clamp((la-pb[1])/(pb[3]-pb[1])*(pc.h-1),0,pc.h-1.0001);
  const i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j,k=j*pc.w+i;
  const ks=u>=v?[k,k+1,k+pc.w+1]:[k,k+pc.w+1,k+pc.w],ws=u>=v?[1-u,u-v,v]:[1-v,u,v-u];
  return [0,1,2].map(ch=>ks.reduce((sum,index,n)=>sum+coarse.pos[index*3+ch]*ws[n],0));
 }
 return assets[index]=mesh(w,h,(i,j)=>{
  const lo=apron?(i===0?box[0]:i===w-1?box[2]:source[0]+dx*(i-1)):box[0]+dx*i;
  const la=apron?(j===0?box[1]:j===h-1?box[3]:source[1]+dy*(j-1)):box[1]+dy*j,ht=patchSample(p,lo,la);
  const ex=(patchSample(p,lo+dx,la)-patchSample(p,lo-dx,la))/(dx*111000*Math.cos(la*deg)*2),ny=(patchSample(p,lo,la+dy)-patchSample(p,lo,la-dy))/(dy*111000*2);
  const light=clamp(.98+(-ex*.84+ny*.6)/Math.sqrt(1+ex*ex+ny*ny),.50,1.45),f=clamp((ht-300)/2100,0,1);
  let pos=geo(lo,la,Math.max(ht,0)/1000);
  const edge=Math.min(i,w-1-i,j,h-1-j);
  if(level===3){
   const margin=Math.min((lo-p.box[0])/dx,(p.box[2]-lo)/dx,(la-p.box[1])/dy,(p.box[3]-la)/dy);
   if(margin<5||edge<5)pos=lerp(underlying(lo,la),pos,smooth(Math.min(margin,edge)/5));
  }else if(coarse&&edge<8)pos=lerp(underlying(lo,la),pos,smooth(edge/8));
  return {p:pos,c:ht<1?[.13,.30,.35]:[mix(.31,.73,f),mix(.46,.68,f),mix(.33,.5,f)].map(k=>k*light),uv:[(lo+180)/360,(90-la)/180]};
 },(i,j)=>[hole,layout[level].cragHole].some(h=>h&&i>=h[0]&&j>=h[1]&&i<h[2]&&j<h[3]));
}
const style=`
.aw{background:#101e26;color:#edeedf;border-radius:18px;overflow:hidden;font:14px/1.4 system-ui;position:relative;isolation:isolate}.aw .aw-stage{height:clamp(425px,55vw,690px);position:relative;overflow:hidden}.aw canvas{width:100%;height:100%;display:block;touch-action:none;cursor:grab}.aw canvas:active{cursor:grabbing}.aw button,.aw select,.aw summary{font:inherit;min-height:44px;cursor:pointer}.aw button,.aw select{background:#1b383a;color:#f7f5e6;border:1px solid #526867;border-radius:9px;padding:6px 10px}.aw button[aria-pressed=true]{background:#f2d89e;color:#172829}.aw button:focus-visible,.aw input:focus-visible,.aw canvas:focus-visible,.aw summary:focus-visible{outline:3px solid #f3cd78;outline-offset:-3px}.aw .aw-flight{display:flex;gap:3px;position:absolute;left:10px;top:10px;padding:3px;background:#10272ce6;border-radius:12px;z-index:2}.aw .aw-flight button{font-size:12px;background:transparent;border:0}.aw .aw-flight button[aria-pressed=true]{background:#f0deae}.aw .aw-dot{position:absolute;left:0;top:0;pointer-events:none;color:#fff2cc;background:#172e32eb;border-radius:5px;padding:3px 7px;font-size:12px;white-space:nowrap;transform:translate(7px,-100%);border-left:2px solid #f0c477}.aw .aw-status{font-size:12px;color:#dce5dc;margin:0;padding:8px 13px;background:#193138}.aw .aw-controls{padding:9px 12px;background:#112930;display:flex;gap:6px;align-items:center;flex-wrap:wrap}.aw .aw-controls button{font-size:13px}.aw .aw-controls label{display:inline-flex;align-items:center;gap:7px;min-height:44px;font-size:12px}.aw input{accent-color:#edca83}.aw .aw-controls input[type=range]{width:100px;min-height:44px}.aw .aw-details{padding:0 13px;background:#112930}.aw summary{display:list-item;align-content:center;font-size:13px}.aw .aw-tools{display:flex;gap:8px 14px;flex-wrap:wrap;align-items:center;padding-bottom:8px}.aw .aw-tools label{display:inline-flex;gap:5px;align-items:center;min-height:44px}.aw .aw-place{position:absolute;pointer-events:none;font-size:10px;letter-spacing:.04em;font-weight:600;color:#f5f5db;text-shadow:0 1px 3px #20362e,0 0 3px #20362e;transform:translate(-50%,-50%);white-space:nowrap}.aw .aw-ruler{position:absolute;bottom:12px;left:12px;color:#f6efdf;background:#152a30da;border-radius:5px;padding:4px 8px;font-size:11px;pointer-events:none}.aw .aw-btm{position:absolute;right:10px;bottom:8px;display:flex;gap:3px}.aw .aw-btm button{min-width:44px;background:#122a32da}.aw .aw-caption{font-size:12px;background:#10272d;padding:1px 13px 11px;color:#c6d8cf}.aw .aw-observation:not(:empty){padding:0 13px 9px;font-size:12px;color:#efdbaa;background:#10272d}.aw .aw-home{position:absolute;pointer-events:none;color:white;background:#15312cef;border-radius:5px;transform:translate(-50%,7px);padding:3px 8px;font-size:12px;line-height:1.4;border:1px solid #d8e9d888}.aw .aw-home:before{content:"";position:absolute;left:calc(50% - 3px);top:-11px;width:6px;height:6px;border-radius:50%;background:#f5e4ad;border:1px solid #23392f}.aw .aw-credit{position:absolute;right:9px;bottom:58px;background:#122b2cbb;color:#e1e7d6;border-radius:4px;padding:3px 6px;font:10px/1.3 system-ui;text-decoration:none}.aw [hidden]{display:none!important}@media(max-width:570px){.aw .aw-stage{height:clamp(320px,93vw,465px)}.aw .aw-flight{left:5px;top:5px;gap:0}.aw .aw-flight button{padding:4px 8px}.aw .aw-controls{gap:4px}.aw .aw-dot{font-size:11px}.aw .aw-ruler{max-width:58%;left:6px}}
`;
function mount(container,options={}){
 const root=document.createElement('div');root.className='aw';root.innerHTML='<style>'+style+'</style><div class="aw-stage"><canvas tabindex="0" aria-label="Interactive 3D Earth. Drag to orbit. Use arrow keys, plus, minus, or Home."></canvas><nav class="aw-flight" aria-label="Camera destinations"></nav><span class="aw-dot"></span><span class="aw-ruler"></span><div class="aw-btm"><button type="button" data-cmd="out" aria-label="Zoom out">−</button><button type="button" data-cmd="in" aria-label="Zoom in">+</button><button type="button" data-cmd="reset">Reset</button></div></div><div class="aw-status" role="status"></div><details class="aw-details"><summary>Weather and terrain layers</summary><div class="aw-tools"></div></details><div class="aw-caption"></div><div class="aw-observation"></div>';
 container.replaceChildren(root);
 const q=s=>root.querySelector(s),stage=q('.aw-stage'),tag=q('.aw-dot'),ruler=q('.aw-ruler'),status=q('.aw-status'),caption=q('.aw-caption'),tools=q('.aw-tools');
 const sunScene=window.AtlasSun?.scene({stage,geo,elevation,paint});
 let solarSignature='',lastSolarStamp=null,solarChangeAt=-Infinity;
 function setSolarLayers(layers={},time,point){
  if(typeof layers.sunPath==='boolean')mapLayers.sunPath=layers.sunPath;
  const signature=JSON.stringify([layers.sunPath,layers.sky,layers.sun,layers.shadows,layers.roads,layers.rivers,time,point?.lat,point?.lon]);
  if(solarSignature===signature)return;
  if(finite(time)&&time!==lastSolarStamp){lastSolarStamp=time;solarChangeAt=performance.now();}
  solarSignature=signature;sunScene?.set(layers,time,point,queue);softKey='';queue();
 }
 const labels=[
  ['Northern highlands',98.25,19.45,1],['Chiang Rai',100.03,19.83,1],['Lamphun',99.20,17.68,1],['Lampang',100.03,18.41,1],
  ['Laos',103.65,19.8,2],['Cambodia',104.8,12.5,2],['Bay of Bengal',89,15,2],['Gulf of Thailand',101.1,10.1,2],['Myanmar',96,22.8,2],['Thailand',101.9,15.3,2],['Vietnam',108.5,13.4,2],['Andaman Sea',93.3,6.1,2],
  ['Asia',81,45,3],['Australia',134,-24,3],['Indian Ocean',76,-14,3]
 ].map(([name,lo,la,at])=>{const el=document.createElement('span');el.textContent=name;el.className='aw-place';el.hidden=true;stage.append(el);return {el,at,p:geo(lo,la,(elevation(lo,la)||0)/1000+.5)}});
 for(const point of cragDetail?.landmarks||[]){
  if(point.key==='crag')continue;
  const el=document.createElement('span');el.className='aw-place';el.textContent=point.name+' · '+point.elevation+' m';el.hidden=true;stage.append(el);
  labels.push({el,crag:point.key,at:.2,p:geo(point.lon,point.lat,(elevation(point.lon,point.lat)??point.elevation)/1000+.008)});
 }
 const initialTerrain=true;
 let photoMode=!initialTerrain,dolly=false,pinching=false;
 let dollyCarry=null,reportedPosition,reportedTarget;
 const touches=new Map();
 let cv=q('canvas'),disposed=false,state={peak:'mon-long',columns:[],level:850,cloudBase:null,scenario:false},scale='window',orbit=initialTerrain;
 let t=initialTerrain?.36:0,target=t,transition=null,heading=0,tilt=0,zoom=1,spin=0,drag=null,last=0,raf=0,idleTimer=0,visible=true;
 let cloudRenderer=null,cloudRenderMode='off',weatherMode='terrain',systemLayer='composite',systemVersion=0,cloudBand='all',systemFeature=null;
 let systemRecord={status:'off',origin:null},systemPixels=null;
 function systemsActive(){return weatherMode==='systems'&&!!images.systems}
 function setWeatherMode(mode){if(!['terrain','systems'].includes(mode))return;weatherMode=mode;syncFrames();queue()}
 function setSystemLayer(layer){if(!['composite','low','mid','high','pressure','precip'].includes(layer))return;systemLayer=layer;syncFrames();queue()}
 function replaceSystemTexture(canvas){
  if(canvas){images.systems=canvas;systemPixels={data:canvas.atlasPixels,w:canvas.width,h:canvas.height}}
  else {delete images.systems;systemPixels=null}
  systemVersion++;softKey='';queue();
 }
 function synopticAt(lo,la){
  if(!systemsActive())return null;
  const {data,w,h}=systemPixels,i=4*(clamp(Math.floor((90-la)/180*h),0,h-1)*w+((Math.floor((lo+180)/360*w)%w+w)%w));return data.subarray(i,i+4)
 }

 let blend=.55,weather=[],wind=[],choice='all',baseLines=[],gpu=null,soft=null,softwareImage=null,softwarePlanet=null,softSurface=null,softKey='',cam,cloudMarks=[];
 const homeTag=document.createElement('span');homeTag.className='aw-home';stage.append(homeTag);
 const credit=document.createElement('a');credit.className='aw-credit';credit.href='https://cloudless.eox.at/';credit.title='Sentinel-2 cloudless 2024 by EOX IT Services GmbH. Contains modified Copernicus Sentinel data 2024. Relief shading and colour grading added.';credit.target='_blank';credit.rel='noopener noreferrer';credit.textContent='Sentinel-2 cloudless 2024 · EOX / Copernicus';stage.append(credit);
 const osmCredit=document.createElement('a');osmCredit.className='aw-credit';osmCredit.href='https://www.openstreetmap.org/copyright';osmCredit.target='_blank';osmCredit.rel='noopener';osmCredit.textContent='© OpenStreetMap contributors';osmCredit.style.bottom='76px';osmCredit.hidden=true;stage.append(osmCredit);
 const flags={terrain:true,cloud:true,wind:true,animate:false,parcel:false,trace:true,spin:true,satellite:false,radar:false,planet:true};
 let provinceClouds=null,provinceReport='',flowDrawn=false,windMarkOverlay=false;
 let cloudOpacity=.55,cloudStyle='natural',cloudMotion=!matchMedia('(prefers-reduced-motion: reduce)').matches,flowEnabled=false,flowAnimated=true,flowVariable='wind',localFlow=null;
 function setCloudStyle(style){if(style!==cloudStyle&&['natural','height','humidity'].includes(style)){cloudStyle=style;queue()}}
 let cloudSpeed=1;
 function setCloudMotion(enabled,factor=1){
  const motion=Boolean(enabled),speed=[1,30,120].includes(factor)?factor:1;if(cloudMotion===motion&&cloudSpeed===speed)return;
  cloudMotion=motion;cloudSpeed=speed;gpu?.suspendClouds();cloudRenderer?.suspend?.();queue()
 }
 function setFlowLayer(enabled,variable='wind',animated=true){
  const active=Boolean(enabled),motion=Boolean(animated),v=['wind','rh','temp'].includes(variable)?variable:'wind';
  if(active===flowEnabled&&v===flowVariable&&motion===flowAnimated)return;
  flowEnabled=active;flowAnimated=motion;flowVariable=v;queue();
 }

 function setCloudOpacity(fraction){
  if(!Number.isFinite(fraction))return;
  const value=clamp(fraction,0,1);if(cloudOpacity===value)return;
  cloudOpacity=value;if(weatherMode==='systems'&&systemRecord.grid)rebuildSystems(systemRecord);syncFrames();queue();
 }
 const mapLayers={localRain:false,sunPath:false,cragPaths:true,cragContours:false,summitHeights:false,eyewitness:true,low:true,mid:true,high:true,pressure:true,precip:false,borders:true,labels:true,markers:true,features:true,terrain:true,relief:true};
 function setMapLayers(partial={}){
  let changed=false;
  for(const [key,val] of Object.entries(partial)){
   if(typeof val!=='boolean')continue;
   if(key in mapLayers&&mapLayers[key]!==val){mapLayers[key]=val;if(key==='sunPath'){sunScene?.setSunPath(val);solarSignature=''}changed=true}
   const alias=key==='relief'?'terrain':key;
   if(key!=='terrain'&&alias in flags&&flags[alias]!==val){
    flags[alias]=val;changed=true;const input=tools.querySelector('[data-layer="'+alias+'"] input');if(input)input.checked=val;
   }
  }
  if(changed){softKey='';softwareImage=null;rebuildParcel();syncFrames();describe();queue()}
 }
 function regionalBaseTextureKey(){return mapLayers.terrain?'southeastAsia':'southeastRelief'}
 function opticalWeights(){
  const region=images[regionalBaseTextureKey()]?smooth((t-.22)/.60)*(1-smooth((t-2.25)/.65)):0;
  const interior=!mapLayers.terrain?0:weatherMode==='systems'?1-smooth((t-.46)/.26):1;
  return {region,highlands:interior*(1-smooth((t-1.04)/.54)),
   basin:interior*(1-smooth((t-.66)/.57))};
 }
 function globeCloudVisible(){
  return weatherMode==='terrain'&&flags.planet&&flags.cloud&&state.provinceModel!==false&&mapLayers.low&&mapLayers.mid&&mapLayers.high;
 }
 function cloudStrength(){return smooth((t-.60)/.35)*mix(.63,.94,smooth((t-1.25)/1.45))}
 const images={},boundary=[];for(const ring of D.boundary||[])for(let i=1;i<ring.length;i++){
   boundary.push(geo(...ring[i-1],Math.max(0,elevation(...ring[i-1])||0)/1000+.12),geo(...ring[i],Math.max(0,elevation(...ring[i])||0)/1000+.12));
 }
 let rainBox=null,rainTime=null,rainRevision=null;
 function setRainSurface(canvas,bounds){
  if(!canvas?.width||!canvas.height||bounds?.length!==4||!bounds.every(finite)||bounds[0]>=bounds[2]||bounds[1]>=bounds[3])canvas=null;
  if((images.rainSurface||null)===canvas&&(!canvas||rainRevision===canvas.atlasRevision&&rainTime===state.time&&bounds.every((n,i)=>n===rainBox[i])))return;
  images.rainSurface=canvas;rainBox=canvas?bounds.slice():null;rainTime=canvas?state.time:null;rainRevision=canvas?.atlasRevision;
  delete softTiles.rainSurface;softKey='';queue();
 }
 function rainStrength(){
  if(!rainBox||rainTime!==state.time||!mapLayers.localRain||weatherMode!=='terrain'||state.provinceModel===false||
     (scale!=='window'&&scale!=='province'))return 0;
  // In a lookout, let the eye read the rock and vegetation through the rain.
  // The cartographic wash gains contrast as the camera pulls back to a map.
  const surfaceContrast=observer ? .26 : mix(.64,1,smooth((t-.35)/.53));
  return surfaceContrast*(1-smooth((t-1.32)/.19));
 }
 const loading=new Set();function ensureImage(id){if(images[id]||loading.has(id))return;loading.add(id);const im=new Image();im.onload=()=>{images[id]=im;queue()};im.src=id==='earth'?D.earth:new URL(({basin:'world-basin.jpg',highlands:'world-highlands.jpg',southeastAsia:'world-southeast-asia.jpg',southeastRelief:'world-southeast-asia-relief.jpg',cragOpt:cragDetail?.image?.file,cloudAtlas:'cloud-volume.png'})[id],baseURL).href}
 // Line paths use the native grid's geographic coordinates; the composited
 // texture follows the same UV interpolation and depth test as the crag rock.
 const cragResolution=1280;
 let cragInk=null,cragInkKey='';
 function cragSurface(){
  if(!images.cragOpt||!cragDetail)return;
  const paths=mapLayers.cragPaths&&!!landmark,contours=mapLayers.cragContours&&!!landmark;
  const key=String(paths)+String(contours);if(key===cragInkKey)return;cragInkKey=key;
  if(!paths&&!contours){images.cragSurface=images.cragOpt;delete softTiles.cragSurface;softKey='';return}
  const size=cragResolution,box=cragDetail.image.box;
  if(!cragInk){
   cragInk={road:new Path2D(),major:new Path2D(),path:new Path2D()};
   for(const feature of cragDetail.map.features){
    const path=cragInk[feature.type];if(!path)continue;
    feature.points.forEach(([lon,lat],i)=>path[i?'lineTo':'moveTo']((lon-box[0])/(box[2]-box[0])*size,(box[3]-lat)/(box[3]-box[1])*size));
   }
  }
  if(contours&&!cragInk.minor){
   cragInk.minor=new Path2D();cragInk.index=new Path2D();
   const dem=patches.at(-1),sx=size/(dem.w-1),sy=size/(dem.h-1);
   for(let j=0;j<dem.h-1;j++)for(let i=0;i<dem.w-1;i++){
    const k=j*dem.w+i,z=[dem.z[k],dem.z[k+1],dem.z[k+dem.w+1],dem.z[k+dem.w]],x=[i,i+1,i+1,i],y=[j,j,j+1,j+1];
    for(let level=Math.ceil(Math.min(...z)/20)*20;level<=Math.max(...z);level+=20){
     const hit=[];
     for(let e=0;e<4;e++){const f=(e+1)%4;if((z[e]<level)===(z[f]<level))continue;
      const a=(level-z[e])/(z[f]-z[e]);hit.push([mix(x[e],x[f],a)*sx,size-mix(y[e],y[f],a)*sy])}
     if(hit.length===4&&((z[0]+z[1]+z[2]+z[3])/4<level)!==(z[0]<level))hit.push(hit.shift());
     const path=level%100?cragInk.minor:cragInk.index;for(let h=1;h<hit.length;h+=2){path.moveTo(...hit[h-1]);path.lineTo(...hit[h])}
    }
   }
  }
  const cv=cragInk.canvas??=document.createElement('canvas');if(cv.width!==size){cv.width=cv.height=size}
  const g=cv.getContext('2d');g.drawImage(images.cragOpt,0,0,size,size);g.lineCap='round';g.lineJoin='round';
  const stroke=(key,color,width,dash=[])=>{g.strokeStyle=color;g.lineWidth=width;g.setLineDash(dash);g.stroke(cragInk[key])};
  if(contours){stroke('minor','rgba(247,206,142,.68)',1.2);stroke('index','#f7d094',2.4)}
  if(paths){for(const type of ['road','major']){
   stroke(type,'rgba(50,46,35,.75)',type==='major'?5.5:3.7);stroke(type,'#ffe3af',type==='major'?3.5:1.9)}
   stroke('path','rgba(49,40,38,.8)',4);stroke('path','#ff977f',2.9,[5,3.5])}
  g.setLineDash([]);cv.atlasRevision=(cv.atlasRevision||0)+1;images.cragSurface=cv;delete softTiles.cragSurface;softKey='';
 }
 function queue(){
  if(idleTimer){clearTimeout(idleTimer);idleTimer=0}
  if(!raf&&!disposed&&visible&&!document.hidden)raf=requestAnimationFrame(draw);
 }
 function wakeAfter(ms){
  if(idleTimer||raf||disposed||!visible||document.hidden)return;
  idleTimer=setTimeout(()=>{idleTimer=0;queue()},ms);
 }
 function syncVisibility(){
  if(visible&&!document.hidden){queue();return}
  if(idleTimer)clearTimeout(idleTimer);if(raf)cancelAnimationFrame(raf);
  idleTimer=0;raf=0;last=0;gpu?.suspendClouds();cloudRenderer?.suspend?.();
 }
 function scaleControls(){
  q('.aw-flight').querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(scales[i]===scale)));
  caption.textContent='Drag to rotate. Pinch or scroll to zoom.';
 }
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 if(reduced)flags.spin=false;
 flags.animate=!reduced&&!navigator.connection?.saveData;
 function travel(to){dollyCarry=null;if(observer){observer=null;options.onObserverChange?.(null)}dolly=false;target=to;transition={from:t,capture:cam,start:performance.now(),duration:reduced?0:clamp(Math.abs(target-t)*720,570,2350)};queue()}
 function notifyScale(id){const changed=id!==scale;scale=id;scaleControls();syncFrames();describe();if(changed)options.onScaleChange?.(id)}
 function setScale(id){if(!scales.includes(id))return;clearHousePoint();resetPan();photoMode=id==='window'&&!initialTerrain;orbit=!photoMode;zoom=1;travel(id==='window'?(photoMode?0:.36):scales.indexOf(id));notifyScale(id)}

 const crag=[99.2369101,18.7822254];
 const cragSites=new Map((cragDetail?.landmarks||[{key:'crag',name:'Crazy Horse crag',lon:crag[0],lat:crag[1]}]).map(p=>[p.key,p]));
 let landmark=null,observer=null,housePoint=null;
 const houseTag=document.createElement('span');houseTag.className='aw-home aw-house';houseTag.textContent='My house';houseTag.hidden=true;stage.append(houseTag);
 function clearHousePoint(){
  if(!housePoint)return;
  housePoint=null;houseTag.hidden=true;resetPan();softKey='';queue();
 }
 function focusHousePoint(point){
  if(!finite(point?.lon)||!finite(point?.lat)||!inside(point.lon,point.lat,D.province.box))return false;
  resetPan();housePoint={lat:point.lat,lon:point.lon};landmark=null;photoMode=false;orbit=true;
  heading=tilt=0;zoom=1;softKey='';travel(.30);notifyScale('window');return true;
 }
 const overlays=new Set();
 function addOverlay(cb){overlays.add(cb);queue();return ()=>{overlays.delete(cb);queue()}}
 function resolveSite(site){return typeof site==='object'&&site?site:site==='crag'||(!site&&landmark)?cragSites.get('crag'):window.AtlasSun.home}
 function faceBearing(site,az,alt=3,mode='window'){
  const point=resolveSite(site);
  if(housePoint&&(point.lon!==housePoint.lon||point.lat!==housePoint.lat))clearHousePoint();
  resetPan();landmark=!housePoint&&Math.abs(point.lon-crag[0])<.004?'crag':null;
  photoMode=false;orbit=true;target=t=.19;transition=null;dolly=false;heading=tilt=0;zoom=1;
  observer={point,az,alt,mode};softKey='';notifyScale('window');options.onObserverChange?.(mode);queue();
 }
 function faceWindow(){faceBearing(null,270,3)}
 function focusSolarHorizon(stamp,which){
  if(observer?.mode==='window'||observer?.mode==='sunset')return observer.point;
  const previous=observer?.previous||{target,heading,tilt,zoom,orbit,photoMode,scale};
  const provincial=scale==='province'||which==='province';
  const point=provincial?(provincePoint?{lon:provincePoint[0],lat:provincePoint[1]}:{lon:98.90,lat:18.77}):resolveSite(which);
  const time=Number.isFinite(stamp)?stamp:sunScene?.time??state.time??Date.now()/1000;
  const position=window.AtlasSun.position(time,point),events=window.AtlasSun.events(time,point),az=position.alt>=0?position.az:time<events.rise.time?events.rise.az:events.set.az;
  photoMode=false;orbit=true;target=t=provincial?1:.19;transition=null;dolly=false;heading=tilt=0;zoom=1;
  observer={point,az,alt:clamp(position.alt*.5+2,7,45),framedAlt:position.alt,mode:'solar',previous};
  softKey='';notifyScale(provincial?'province':'window');queue();return point;
 }
 function keepSunInView(stamp){
  if(observer?.mode!=='solar'||!Number.isFinite(stamp)||!cam)return false;
  const point=observer.point,sun=window.AtlasSun.position(stamp,point);
  let az=sun.az,alt=sun.alt;
  if(alt<-.8){
   const ev=window.AtlasSun.events(stamp,point);az=stamp<ev.rise.time?ev.rise.az:ev.set.az;alt=3;
  }
  const p=cam.direction(az,alt);
  if(p&&p[0]>.14*cam.w&&p[0]<.86*cam.w&&p[1]>.19*cam.h&&p[1]<.80*cam.h)return false;
  heading=tilt=0;observer.az=az;observer.alt=clamp(alt*.5+2,7,45);observer.framedAlt=alt;zoom=1;softKey='';queue();return true;
 }
 function leaveSolarHorizon(){
  if(observer?.mode!=='solar')return false;
  const targetView=observer.previous;heading=targetView.heading;tilt=targetView.tilt;zoom=targetView.zoom;orbit=targetView.orbit;photoMode=targetView.photoMode;
  travel(targetView.scale===scale?targetView.target:scale==='province'?1:landmark?.19:.36);softKey='';queue();return true;
 }
 function faceSunset(site,stamp){
  const point=resolveSite(site),event=sunScene.terrainSet(stamp??sunScene.time??state.time??Date.now()/1000,point);
  faceBearing(point,event.az,Math.max(2,event.horizon+1),'sunset');return event;
 }
 const cragPin=document.createElement('button');cragPin.type='button';cragPin.textContent='◆ Crazy Horse';cragPin.setAttribute('aria-label','Inspect Crazy Horse crag');
 cragPin.style.cssText='position:absolute;transform:translate(-50%,-50%);font:600 11px/1.25 system-ui;min-height:44px;padding:4px 6px;background:#1a322ebd;color:#fff1c4;border:1px solid #d8c27e8a;z-index:1;white-space:nowrap';cragPin.hidden=true;stage.append(cragPin);
 cragPin.onclick=()=>{if(options.onPlace)options.onPlace('crag');else setLandmark('crag')};
 const cragWorld=geo(...crag,(elevation(...crag)??462)/1000+.004);
 function placeCrag(c){
  const p=c.project(cragWorld);cragPin.hidden=stage.classList.contains('scene-air-crag')||!mapLayers.markers||t<.18||t>1.48||!p||p[0]<48||p[0]>c.w-48||p[1]<54||p[1]>c.h-44||dot(norm(add(cragWorld,[0,0,R])),sub(c.eye,cragWorld))<0;
  if(!cragPin.hidden){cragPin.style.left=p[0]+'px';cragPin.style.top=p[1]+'px'}
 }

 function setLandmark(id){if(id!==null&&!cragSites.has(id))return;clearHousePoint();resetPan();landmark=id;if(id){photoMode=false;orbit=true;travel(.19);notifyScale('window')}else if(t<.72)travel(.36);queue()}
 function setPeak(id){landmark=null;if(!peaks[id]||state.peak===id)return;const from=cam;state.peak=id;if(!photoMode&&t<.8){travel(target);transition.capture=from}queue()}
 function focusProvincePoint(lon,lat){
  if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90)return false;
  clearHousePoint();resetPan();provincePoint=[lon,lat];landmark=null;photoMode=false;orbit=true;heading=tilt=0;zoom=1;
  travel(1);notifyScale('province');return true;
 }
 function focusRidge(){clearHousePoint();resetPan();
  photoMode=false;orbit=true;heading=0;tilt=0;zoom=1;
  travel(.30);notifyScale('window');
 }
 function orbitLocal(){photoMode=false;orbit=true;travel(.36);notifyScale('window')}
 function setZoomPosition(position,{fly=false}={}){
  if(!finite(position))return;
  const next=clamp(position,.18,3.35);
  photoMode=false;orbit=true;
  if(fly){travel(next);transition.followScale=true;return}
  // Preserve the displayed pose when a hand gesture interrupts a flight or leaves the horizon.
  if(!reduced&&cam&&(observer||transition?.capture))
   dollyCarry={capture:cam,start:performance.now(),duration:180};
  if(observer){observer=null;zoom=1;options.onObserverChange?.(null)}
  transition=null;target=next;dolly=true;queue();
 }
 function zoomBy(factor){
  if(!finite(factor)||factor<=0)return;
  if(observer&&!options.continuousZoom){zoom=clamp(zoom*factor,.6,4);softKey='';queue();return}
  const from=transition||photoMode?Math.max(t,.18):target;
  const limit=housePoint && !options.continuousZoom ? .68 : 3.35;
  setZoomPosition(clamp(from-Math.log(factor)*.255,.18,limit));
 }
 for(const id of scales){const b=document.createElement('button');b.type='button';b.textContent=id[0].toUpperCase()+id.slice(1);b.onclick=()=>setScale(id);q('.aw-flight').append(b)}
 for(const [key,text] of Object.entries({terrain:'Terrain',cloud:'Cloud volumes',wind:'Wind',animate:'Animate wind (120×)',parcel:'Parcel base',trace:'Fitted skyline',spin:'Rotate globe',satellite:'JMA infrared',radar:'TMD radar',planet:'Global modeled cloud cover'})){
   const label=document.createElement('label'),input=document.createElement('input');label.dataset.layer=key;input.type='checkbox';input.checked=flags[key];if(reduced&&(key==='spin'||key==='animate')){input.disabled=true;label.title='Paused by your reduced-motion preference'}label.append(input,document.createTextNode(text));tools.append(label);
   input.oninput=()=>{flags[key]=input.checked;if(key==='parcel')rebuildParcel();syncFrames();describe();queue()};
 }
 const select=document.createElement('select');select.setAttribute('aria-label','Inspect modeled cloud volume');tools.append(select);
 select.onchange=()=>{choice=select.value;describe();queue()};
 const frameState={satellite:{origin:null,status:'off'},radar:{origin:null,status:'off'},planet:{origin:null,status:'off'},globalWind:{origin:null,status:'off'}},frameMeshes={};
 let regionalNotice='';
 function imageryLabel(){
  if(options.onRegionalChange&&scale==='region'){
   const v=regionInformation(),status=v.status==='hidden'&&v.windStatus!=='off'?v.windStatus:v.status;
   const notice={...v,status:status==='off'||status==='hidden'?'missing':status,time:v.time??v.windTime,run:v.run??frameState.globalWind.run??null};
   const key=JSON.stringify(notice);if(regionalNotice!==key){regionalNotice=key;options.onRegionalChange(notice)}
  }else regionalNotice='';
  const entries=[];
  if(weatherMode==='systems'){const rec=systemRecord;entries.push(rec.status==='ready'?'NOAA GFS 1° · '+systemLayer+' · '+new Date(rec.time*1000).toISOString().slice(0,16).replace('T',' ')+' UTC':rec.status==='loading'?'Loading NOAA GFS synoptic grid':rec.status==='failed'?'NOAA GFS synoptic grid unavailable':'No matching NOAA GFS synoptic grid')}
  for(const key of ['satellite','radar']){
   if(!flags[key])continue;
   const name=key==='satellite'?'JMA B13 infrared':'TMD radar',frame=state.imagery?.[key],rec=frameState[key];
   if(!['province','region'].includes(scale)){entries.push(name+' · view in Province or Region');continue}
   if(!frame){entries.push(name+' · no frame at this time');continue}
   const stamp=finite(frame.time)?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(frame.time*1000)+' ICT':'time unavailable';
   entries.push(name+' · '+stamp+(rec.status==='failed'?' · unavailable':rec.status==='ready'?'':' · loading'));
  }
  if(flags.radar||flags.satellite)entries.push('Overhead footprints: infrared brightness traces colder tops; radar colors show echoes.');
  if(scale==='global'&&(flags.planet||flags.wind)){
   const f=state.imagery?.planet,rec=frameState.planet;
   const stamp=t=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(t*1000)+' UTC';
   if(flags.planet&&weatherMode==='terrain')entries.push('NOAA GFS 1° modeled total cloud cover'+(f?' · valid '+stamp(f.time)+(finite(f.run)?' · run '+stamp(f.run):'')+(rec.status==='ready'?'':rec.status==='failed'?' · unavailable':' · loading'):' · no matching frame'));
   if(flags.wind){const w=frameState.globalWind;
    entries.push('GFS 10 m wind · arrows show flow; longer arrows mean faster wind'+(w.status==='ready'&&f?' · valid '+stamp(f.time):w.status==='failed'?' · unavailable':w.status==='loading'?' · loading':' · no matching wind grid'))}
  }
  q('.aw-observation').textContent=entries.join('   |   ');

 }
 async function loadObservation(key,frame,rec){
  try{
   const response=await fetch(new URL(frame.url,document.baseURI),{signal:rec.abort.signal,credentials:'same-origin',referrerPolicy:'no-referrer'});
   if(!response.ok)throw Error('Frame unavailable');
   const blob=await response.blob();let img;
   if(window.createImageBitmap){img=await createImageBitmap(blob,key==='radar'?{resizeWidth:920,resizeHeight:1203,resizeQuality:'high'}:{});}
   else{const obj=URL.createObjectURL(blob);try{const source=new Image();source.src=obj;await source.decode();if(key==='radar'){const c=document.createElement('canvas');c.width=920;c.height=1203;c.getContext('2d').drawImage(source,0,0,c.width,c.height);img=c}else img=source}finally{URL.revokeObjectURL(obj)}}
   if(disposed||frameState[key]!==rec){img.close?.();return}
   rec.bitmap=img;rec.status='ready';images[key]=img;
  }catch(error){if(disposed||frameState[key]!==rec)return;rec.status='failed'}
  imageryLabel();queue();
 }
 function setCloudBand(band){
  if(!['all','low','mid','high'].includes(band))return;
  cloudBand=band;syncFrames();
  if(choice!=='all'){choice='all';select.value=choice;describe()}
  queue();
 }
 const featurePin=document.createElement('span');featurePin.hidden=true;featurePin.style.cssText='position:absolute;pointer-events:none;transform:translate(-50%,-100%);border-bottom:2px solid #f8d677;background:#132837ed;color:#fff0bb;font:600 12px/1.2 system-ui;padding:4px 7px;border-radius:4px';stage.append(featurePin);
 function featureMesh(f){
  const cells=f.footprintCells||[],points=[],edges=[],grid=new Map();
  function pt(x,y){const id=x+','+y;if(!grid.has(id))grid.set(id,geo(x,y,.06));return grid.get(id)}
  for(const [lo,la] of cells){
   const a=pt(lo-.5,la-.5),b=pt(lo+.5,la-.5),c=pt(lo+.5,la+.5),d=pt(lo-.5,la+.5);
   points.push([a,b,c,d]);
  }
  if(f.boundarySegments){for(const [a,b] of f.boundarySegments)edges.push([pt(...a),pt(...b)])}
  else for(const ring of f.outlines||[])for(let i=1;i<ring.length;i++)edges.push([pt(...ring[i-1]),pt(...ring[i])]);
  return {points,edges};
 }
 function drawFeature(c){
  if(!mapLayers.features||weatherMode!=='systems'||!systemFeature?.mesh)return;
  const fill=[],edge=[],globe=t>=2.12;
  const proj=(p)=>{if(globe&&dot(norm(add(p,[0,0,R])),sub(c.eye,p))<0)return null;const v=c.project(p);return v&&ndc(v[0],v[1],c)};
  const cache=new Map();function vertex(p){if(!cache.has(p))cache.set(p,proj(p));return cache.get(p)}
  for(const cell of systemFeature.mesh.points){
   const [a,b,d,e]=cell.map(vertex);if(a&&b&&d&&e)fill.push(a,b,d,a,d,e)
  }
  for(const [a,b] of systemFeature.mesh.edges){const x=vertex(a),y=vertex(b);if(x&&y)edge.push(x,y)}
  paint(fill,[1,.84,.46],.24,'TRIANGLES',true);paint(edge,[1,.91,.58],.98,'LINES',true);
 }
 function setSystemFeature(v){systemFeature=v&&finite(v.lat)&&finite(v.lon)?{...v,mesh:featureMesh(v),world:geo(v.lon,v.lat,Math.max(0,elevation(v.lon,v.lat)||0)/1000+.2)}:null;queue()}
 function positionFeature(c){
  featurePin.hidden=true;if(!mapLayers.markers||weatherMode!=='systems'||!systemFeature)return;
  const pos=systemFeature.world,farSide=dot(norm(add(pos,[0,0,R])),norm(sub(c.eye,pos)))<0;
  const v=sub(c.stretch(pos),c.eye),screen=c.project(pos);
  if(t>2.5&&(farSide||!screen))return;
  const x=screen?.[0]??(c.w/2+dot(v,c.right)),y=screen?.[1]??(c.h/2-dot(v,c.up));
  const inside=screen&&!farSide&&x>=38&&x<=c.w-38&&y>=52&&y<=c.h-42;
  const label=systemFeature.label||'Selected system';
  let px=x,py=y;
  if(!inside){
   const dx=x-c.w/2,dy=y-c.h/2,bx=Math.max(20,c.w/2-Math.min(96,c.w*.24)),by=Math.max(20,c.h/2-68);
   const f=Math.min(bx/Math.max(.001,Math.abs(dx)),by/Math.max(.001,Math.abs(dy)));
   px=c.w/2+dx*f;py=c.h/2+dy*f;
   const arrow=['→','↘','↓','↙','←','↖','↑','↗'][(Math.round(Math.atan2(dy,dx)/(Math.PI/4))+8)%8];
   const homeNormal=norm(add(geo(98.985,18.79),[0,0,R])),featureNormal=norm(add(pos,[0,0,R]));
   const distance=Math.round(R*Math.acos(clamp(dot(homeNormal,featureNormal),-1,1)));
   featurePin.textContent=arrow+' '+label+' · '+distance.toLocaleString()+' km';featurePin.title='Off map · distance from Chiang Mai';
  }else{featurePin.textContent='◆ '+label;featurePin.title='Selected location'}
  featurePin.style.maxWidth=Math.min(190,c.w*.43)+'px';featurePin.style.left=px+'px';featurePin.style.top=py+'px';featurePin.hidden=false;
 }
 function systemEvent(status,rec){
  const g=rec?.grid;
  options.onSystemsChange?.({status,time:rec?.time??null,grid:g?{width:360,height:181,west:-180,north:90,dx:1,dy:-1,low:g.bands[0],mid:g.bands[1],high:g.bands[2],mslp:g.mslp,precip:g.precip,precipStart:g.precipStart,precipEnd:g.precipEnd}:null})
 }
 const systemColors=[[69,207,188],[241,172,85],[172,148,245]];
 function decodeSystems(raw){
  if(raw.width!==360||raw.height!==181||raw.west!==-180||raw.north!==90||raw.dx!==1||raw.dy!==-1)throw Error('Unsupported weather grid');
  const n=raw.width*raw.height;
  function unpack(k,b){const x=atob(raw[k]);if(x.length!==n*b)throw Error('Incomplete weather grid');return Uint8Array.from(x,c=>c.charCodeAt(0))}
  const pressure=new DataView(unpack('mslp',2).buffer),mslp=new Float32Array(n);
  for(let i=0;i<n;i++)mslp[i]=pressure.getUint16(i*2,true)*raw.pressureScale;
  let precip=null;if(raw.precip6h){const view=new DataView(unpack('precip6h',2).buffer);precip=new Float32Array(n);for(let i=0;i<n;i++)precip[i]=view.getUint16(i*2,true)*raw.precipScale}
  return {bands:['low','mid','high'].map(k=>unpack(k,1)),mslp,precip,precipStart:raw.precipStart,precipEnd:raw.precipEnd};
 }
 function interpolate(field,x,y){
  const i=Math.floor(x),j=Math.floor(y),a=x-i,b=y-j,l=(i%360+360)%360,r=(l+1)%360,top=clamp(j,0,180)*360,bot=clamp(j+1,0,180)*360;
  return mix(mix(field[top+l],field[top+r],a),mix(field[bot+l],field[bot+r],a),b);
 }
 let chartGrain=null;
 function planformGrain(w,h){
  if(chartGrain)return chartGrain;
  const result=new Uint8Array(w*h*3),seeds=new Uint8Array(256*128);
  let seed=104729;for(let i=0;i<seeds.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;seeds[i]=seed>>>24}
  function noise(x,y){
   const i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j,a=u*u*(3-2*u),b=v*v*(3-2*v);
   const p=(j&127)*256,q=((j+1)&127)*256,l=i&255,r=(i+1)&255;
   return mix(mix(seeds[p+l],seeds[p+r],a),mix(seeds[q+l],seeds[q+r],a),b)/255;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const k=(y*w+x)*3,u=x/w*256,v=y/h*128,bend=noise(u*.25,v*.25)*4;
   // Cartographic texture encodes the displayed band, independently of forecast position or time.
   result[k]=255*(.50*noise(u*2,v*2)+.33*noise(u*4,v*4)+.17*noise(u*8,v*8));
   result[k+1]=255*(.66*noise(u,v*2+bend)+.34*noise(u*2,v*4+bend));
   result[k+2]=255*(.69*noise(u*.25,v*5+bend+2*Math.sin(u*Math.PI/32))+.31*noise(u*.5,v*9+bend));
  }
  return chartGrain=result;
 }
 function addChartBackground(dst,k,r,g,b,a){
  const rain=dst[k+3]/255;
  if(rain===0){dst[k]=r;dst[k+1]=g;dst[k+2]=b;dst[k+3]=a;return}
  const under=a/255*(1-rain),alpha=rain+under;
  dst[k]=(dst[k]*rain+r*under)/alpha;dst[k+1]=(dst[k+1]*rain+g*under)/alpha;
  dst[k+2]=(dst[k+2]*rain+b*under)/alpha;dst[k+3]=alpha*255;
 }
 function colorSystems(data,layer){
  const w=1080,h=540,cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const ctx=cv.getContext('2d'),im=ctx.createImageData(w,h),dst=im.data;
  const band=['low','mid','high'].indexOf(layer),grain=['precip','pressure'].includes(layer)?null:planformGrain(w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const k=4*(y*w+x),gx=(x+.5)*360/w,gy=(y+.5)*180/h;
   if(layer==='precip'||mapLayers.precip){
    const mm=mapLayers.precip&&data.precip?interpolate(data.precip,gx,gy):0;
    if(mm>.05){
     const offset=Math.min(255,Math.round(Math.log1p(mm)*255/regionalRainMax))*4;
     if(regionalRainRamp[offset+3]){
      for(let ch=0;ch<4;ch++)dst[k+ch]=regionalRainRamp[offset+ch];
     }
    }
    if(layer==='precip')continue;
   }
   if(layer==='pressure'&&!mapLayers.pressure)continue;
   if(layer==='pressure'){
    const pressure=interpolate(data.mslp,gx,gy),f=clamp((pressure-990)/44,0,1);
    addChartBackground(dst,k,mix(85,246,f),mix(158,185,f),mix(229,89,f),66);continue;
   }
   let sum=0,strength=0,red=0,green=0,blue=0;
   for(let b=0;b<3;b++){if((band!==-1&&band!==b)||!mapLayers[['low','mid','high'][b]])continue;
    const cover=clamp(interpolate(data.bands[b],gx,gy)/100,0,1);
    if(!cover)continue;const weight=cover*(.48+.90*grain[(y*w+x)*3+b]/255);
    sum+=weight;strength=Math.max(strength,weight);red+=systemColors[b][0]*weight;green+=systemColors[b][1]*weight;blue+=systemColors[b][2]*weight;
   }
   if(!sum)continue;
   addChartBackground(dst,k,red/sum,green/sum,blue/sum,235*clamp(strength,0,1)*cloudOpacity);
  }
  ctx.putImageData(im,0,0);cv.atlasPixels=dst;return cv;
 }
 function isobars(g){
  const out=[];
  for(let j=0;j<180;j++)for(let i=0;i<360;i++){
   const k=j*360+i,l=j*360+(i+1)%360,v=[g[k],g[l],g[l+360],g[k+360]],min=Math.min(...v),max=Math.max(...v);
   const step=i>=255&&i<=307&&j>=52&&j<=94?1:4;
   for(let p=step*Math.ceil(min/step);p<max;p+=step){
    const pts=[];
    for(let e=0;e<4;e++){const a=v[e],b=v[(e+1)%4];if((a<=p)===(b<=p))continue;
     const f=(p-a)/(b-a);pts.push([i-180+[f,1,1-f,0][e],90-j-[0,f,1,1-f][e]])}
    // Select the saddle connection using bilinear centre pressure.
    if(pts.length===4&&((v[0]<=p)!==(v.reduce((a,b)=>a+b,0)/4<=p)))pts.push(pts.shift());
    for(let n=1;n<pts.length;n+=2){const a=pts[n-1],b=pts[n];out.push({p,a,b,mid:[(a[0]+b[0])/2,(a[1]+b[1])/2]})}
   }
  }
  return out;
 }
 let hiddenPatches=[],hiddenKey='';
 function setHiddenPatches(items=[]){
  const entries=[];
  for(const f of items||[]){
   const band=f.band==='rain'?'precip':f.band;
   if(!['low','mid','high','precip'].includes(band)||!Array.isArray(f.footprintCells)||!finite(f.time))continue;
   const ids=[];for(const [lo,la] of f.footprintCells){
    if(!Number.isInteger(lo)||!Number.isInteger(la)||la>90||la< -90)continue;
    ids.push((90-la)*360+((lo+180)%360+360)%360)
   }
   if(ids.length)entries.push({band,time:f.time,ids});
  }
  const key=entries.map(f=>f.time+'@'+f.band+'/'+f.ids.join(',')).sort().join(';');
  if(key===hiddenKey)return;
  hiddenPatches=entries;hiddenKey=key;
  if(systemRecord.grid)rebuildSystems(systemRecord);queue();
 }
 function maskedFields(rec,relevant){
  if(!relevant.length)return rec.grid;
  const grid={...rec.grid,bands:[...rec.grid.bands]},cloned=new Map();
  for(const {band,ids} of relevant){
   const index=['low','mid','high'].indexOf(band),source=index===-1?rec.grid.precip:rec.grid.bands[index];
   if(!source)continue;
   if(!cloned.has(band)){const copy=source.slice();cloned.set(band,copy);if(index===-1)grid.precip=copy;else grid.bands[index]=copy}
   const field=cloned.get(band);for(const id of ids)field[id]=0;
  }
  return grid;
 }
 function rebuildSystems(rec){
  const relevant=hiddenPatches.filter(f=>f.time===rec.time);
  const key=[systemLayer,cloudOpacity,mapLayers.low,mapLayers.mid,mapLayers.high,mapLayers.pressure,mapLayers.precip,relevant.length?hiddenKey:''].join('/');
  if(!rec.grid||rec.layer===key)return;
  rec.materials??=new Map();if(!rec.materials.has(key)){if(rec.materials.size>=4)rec.materials.delete(rec.materials.keys().next().value);rec.materials.set(key,colorSystems(maskedFields(rec,relevant),systemLayer))}
  replaceSystemTexture(rec.materials.get(key));rec.layer=key;
 }
 function retrySystems(){
  if(systemRecord.status==='failed'){systemRecord.origin=null;syncSystems()}
 }
 function syncSystems(){
  const f=state.imagery?.systems||(state.imagery?.planet?.systemsUrl?{...state.imagery.planet,url:state.imagery.planet.systemsUrl}:null);
  const regional=weatherMode==='terrain'&&scale==='region'&&state.provinceModel!==false&&flags.cloud&&cloudOpacity>0&&['low','mid','high'].some(b=>mapLayers[b]&&(cloudBand==='all'||cloudBand===b));
  const origin=(weatherMode==='systems'||regional)&&f?.url?f.url+'@'+f.time:null;
  if(systemRecord.origin===origin){if(origin&&weatherMode==='systems'){
   if(systemRecord.grid&&!systemRecord.lines)systemRecord.lines=isobars(systemRecord.grid.mslp);
   rebuildSystems(systemRecord);
  }else if(weatherMode==='systems'&&systemRecord.status!=='missing'){systemRecord.status='missing';systemEvent('missing',null)}return}
  systemRecord.abort?.abort();replaceSystemTexture(null);
  const rec=systemRecord={origin,status:origin?'loading':'off'};
  if(!origin){systemEvent('missing',null);return}
  rec.time=f.time;rec.run=f.run;systemEvent('loading',rec);rec.abort=new AbortController();
  fetch(f.url,{signal:rec.abort.signal}).then(r=>{if(!r.ok)throw Error('Grid unavailable');return r.json()}).then(raw=>{
   if(disposed||systemRecord!==rec)return;if(Number(raw.time)!==Number(f.time)||finite(f.run)&&Number(raw.run)!==f.run)throw Error('Grid clock mismatch');
   rec.grid=decodeSystems(raw);rec.time=raw.time;rec.run=raw.run;rec.status='ready';if(weatherMode==='systems'){rec.lines=isobars(rec.grid.mslp);rebuildSystems(rec);}systemEvent('loaded',rec);imageryLabel();queue();
  }).catch(()=>{if(!disposed&&systemRecord===rec){rec.status='failed';systemEvent('error',rec);imageryLabel();queue()}});
 }
 const borderSets={};
 function countryOutlines(c){
  const center=grabPoint(c,c.cx,c.cy),latitude=Math.asin(clamp(center[1]*Math.cos(lat0)+center[2]*Math.sin(lat0),-1,1))/deg;
  const longitude=(lon0+Math.atan2(center[0],center[2]*Math.cos(lat0)-center[1]*Math.sin(lat0)))/deg;
  const global=t>=2.52||longitude<79||longitude>122||latitude<1||latitude>32,id=global?'global':'region',region=window.ScaleMapData?.[id];
  if(!mapLayers.borders||t<.68||weatherMode!=='systems'&&(t<1.54||t>2.45)||!region)return;
  if(!borderSets[id]){
   const [west,south,east,north]=region.bounds,[width,height]=region.size;
   const y0=Math.asinh(Math.tan(south*deg)),y1=Math.asinh(Math.tan(north*deg)),seen=new Set();
   const projectNode=(x,y)=>geo(mix(west,east,x/width),(global?mix(north,south,y/height):Math.atan(Math.sinh(mix(y1,y0,y/height)))/deg),.02);
   const borderSegments=borderSets[id]=[];
   for(const path of Object.values(region.paths))for(const ring of path.matchAll(/M([^Z]+)Z/g)){
    const xy=ring[1].trim().split(/\s+/).map(v=>v.split(',').map(Number));
    for(let i=0;i<xy.length;i++){
     const a=xy[i],b=xy[(i+1)%xy.length];
     if((a[0]===b[0]&&(a[0]===0||a[0]===width))||(a[1]===b[1]&&(a[1]===0||a[1]===height)))continue;
     const k=[a.join(','),b.join(',')].sort().join('/');if(seen.has(k))continue;seen.add(k);
     borderSegments.push([projectNode(...a),projectNode(...b)]);
    }
   }
  }
  const lines=[];
  for(const [a,b] of borderSets[id]){
   if(dot(norm(add(a,[0,0,R])),sub(c.eye,a))<0)continue;
   const pa=c.project(a),pb=c.project(b);if(!pa||!pb||Math.max(pa[0],pb[0])<0||Math.min(pa[0],pb[0])>c.w||Math.max(pa[1],pb[1])<0||Math.min(pa[1],pb[1])>c.h)continue;
   lines.push(ndc(pa[0],pa[1],c),ndc(pb[0],pb[1],c));
  }
  paint(lines,[.10,.20,.22],weatherMode==='systems'?(global?.50:.78):.37,'LINES',true);
 }
 const contourTags=[];
 function drawSystems(c){
  for(const tag of contourTags)tag.hidden=true;
  if(!systemsActive()||!mapLayers.pressure||t<.75)return;
  const globe=t>2.16,global=t>2.5,lines=[],major=[],labels=[],interval=global?4:t<1.55?1:2,margin=40;
  for(const seg of systemRecord.lines){
   if(seg.p%interval)continue;

   seg.midWorld??=geo(...seg.mid,0);
   const pp=seg.midWorld;
   if(dot(norm(add(pp,[0,0,R])),sub(c.eye,pp))<0)continue;
   const m=c.project(pp);if(!m||m[0]<-margin||m[0]>c.w+margin||m[1]<-margin||m[1]>c.h+margin)continue;
   const v=seg.screenCache??=( [seg.a,seg.b].map(([lo,la])=>geo(lo,la,(elevation(lo,la)||0)/1000+.05)) );
   const a=c.project(v[0]),b=c.project(v[1]);if(!a||!b)continue;
   const index=seg.p%(interval*2)===0;(index?major:lines).push(ndc(a[0],a[1],c),ndc(b[0],b[1],c));
   if(!mapLayers.labels||!index||m[0]<38||m[0]>c.w-38||m[1]<55||m[1]>c.h-46||labels.some(q=>Math.hypot(q[0]-m[0],q[1]-m[1])<(q[2]===seg.p?185:105)))continue;
   labels.push([m[0],m[1],seg.p]);
  }
  paint(lines,[.93,.94,.82],systemLayer==='pressure'?.77:.56,'LINES',true);paint(major,[1,.97,.81],.96,'LINES',true);
  for(let i=0;i<Math.min(labels.length,c.w<520?6:14);i++){
   let el=contourTags[i];if(!el){el=contourTags[i]=document.createElement('span');el.className='aw-isobar';el.style.cssText='position:absolute;pointer-events:none;transform:translate(-50%,-50%);font:600 10px/1.15 system-ui;color:#fff6cf;background:#172832cf;border-radius:4px;padding:2px 4px';stage.append(el)}
   el.textContent=labels[i][2]+' hPa';el.style.left=labels[i][0]+'px';el.style.top=labels[i][1]+'px';el.hidden=false;
  }
 }
 function syncFrames(){
  syncSystems();
  for(const key of ['satellite','radar','planet','globalWind']){
   const global=key==='planet'||key==='globalWind';
   const appropriate=global?(weatherMode==='systems'||state.provinceModel!==false)&&(scale==='global'||key==='globalWind'&&scale==='region'&&weatherMode==='terrain'):['province','region'].includes(scale);
   const source=state.imagery?.[key==='globalWind'?'planet':key];
   const frame=key==='globalWind'&&source?{time:source.time,run:source.run,url:source.windUrl}:source,active=(key==='globalWind'?flags.wind:flags[key])&&appropriate&&frame?.url;
   const origin=active?frame.url+'@'+frame.time:null,prev=frameState[key];
   if(prev.origin===origin)continue;
   prev.abort?.abort();prev.bitmap?.close?.();delete images[key];
   const rec={origin,status:!active?'off':'loading',abort:active?new AbortController():null};frameState[key]=rec;
   if(active){if(key==='globalWind')loadPlanetWind(frame,rec);else loadObservation(key,frame,rec)}
  }
  imageryLabel();
 }
 async function loadPlanetWind(frame,rec){
  try{
   const r=await fetch(new URL(frame.url,document.baseURI),{signal:rec.abort.signal,credentials:'same-origin',referrerPolicy:'no-referrer'});
   if(!r.ok)throw Error('Missing wind grid');
   const g=await r.json();if(g.width!==72||g.height!==37||g.u?.length!==2664||g.v?.length!==2664||g.units!=='m/s'||![g.north,g.west,g.dx,g.dy].every(finite))throw Error('Invalid 10 m wind grid');
   if(disposed||frameState.globalWind!==rec)return;
   if(g.time!==frame.time||finite(frame.run)&&g.run!==frame.run||g.north!==90||g.west!==-180||g.dx!==5||g.dy!==-5)throw Error('Wind grid clock or coordinates mismatch');
   rec.time=g.time;rec.run=g.run;rec.vectors=[];
   for(let j=1;j<g.height-1;j++)for(let i=0;i<g.width;i++){
    const k=j*g.width+i,u=g.u[k],v=g.v[k];if(!finite(u)||!finite(v))continue;
    const speed=Math.hypot(u,v);if(speed<.4)continue;
    const lo=g.west+i*g.dx,la=g.north+j*g.dy,p=geo(lo,la,.01);
    // The derivative of a great-circle step gives the projected 10 m wind direction.
    const q=geo(lo+.35*u/(speed*Math.cos(la*deg)),la+.35*v/speed,.01);
    rec.vectors.push({p,q,speed,dense:i%2!==0||j%2!==0});
   }
   rec.status='ready';
  }catch{if(disposed||frameState.globalWind!==rec)return;rec.status='failed'}
  imageryLabel();queue();
 }
 const regionalBands=['low','mid','high'];
 const regionalArea=[72,-10,136,44];
 function regionInformation(){
  const eligible=state.provinceModel!==false&&weatherMode==='terrain'&&scale==='region';
  const active=eligible&&!!flags.cloud&&cloudOpacity>0;
  const bands=regionalBands.filter(b=>mapLayers[b]&&(cloudBand==='all'||cloudBand===b));
  const data=systemRecord,wind=frameState.globalWind;
  return {eligible,status:!eligible?'off':!active||!bands.length?'hidden':data.status==='off'?'missing':data.status,
   time:active&&data.origin?data.time:null,run:active&&data.origin?data.run:null,bands:active?bands:[],
   windStatus:eligible&&flags.wind?(wind.status==='off'?'missing':wind.status):'off',windTime:eligible&&wind.status==='ready'?wind.time:null};
 }
 function regionalStrength(){return smooth((t-1.42)/.30)*(1-smooth((t-2.32)/.26))}
 function prepareRegionalCover(){
  const rec=systemRecord,active=weatherMode==='terrain'&&state.provinceModel!==false&&flags.cloud&&cloudOpacity>0&&regionalStrength()>.001&&rec.status==='ready';
  const bands=active?regionalBands.map((b,i)=>mapLayers[b]&&(cloudBand==='all'||cloudBand===b)?i:-1).filter(i=>i>=0):[];
  let cover=null;
  if(bands.length){
   const key=[bands.join(','),cloudStyle,cloudOpacity].join('/');
   if(rec.coverKey!==key){
    const [west,south,east,north]=regionalArea,w=384,h=324,pixels=new Uint8Array(w*h*4);
    const palette=cloudStyle==='height'?[[180,240,218],[252,215,158],[212,194,248]]:Array(3).fill([240,243,244]);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
     const lon=mix(west,east,(x+.5)/w),lat=mix(north,south,(y+.5)/h);
     const edge=smooth(Math.min(x,y,w-1-x,h-1-y)/12),k=4*(y*w+x);
     for(const i of bands){
      const v=Math.pow(clamp(interpolate(rec.grid.bands[i],lon+180,90-lat)/100,0,1),.86);
      if(!(v>0))continue;
      const a=v*edge*cloudOpacity*224/255;
      for(let c=0;c<3;c++)pixels[k+c]=Math.round(pixels[k+c]*(1-a)+palette[i][c]*(.87+.13*v)*a);
      pixels[k+3]=Math.round(pixels[k+3]*(1-a)+255*a);
     }
    }
    rec.cover={width:w,height:h,pixels};rec.coverKey=key;
   }
   cover=rec.cover;
  }
  if(images.regionalCover!==cover){images.regionalCover=cover;softKey=''}
 }
 function sampleRegionalCover(buf,k,r,lon,lat,strength){
  const [w,s,e,n]=regionalArea;
  if(lon<w||lon>e||lat<s||lat>n)return;
  const x=clamp((lon-w)/(e-w)*r.width-.5,0,r.width-1),y=clamp((n-lat)/(n-s)*r.height-.5,0,r.height-1);
  const i=Math.floor(x),j=Math.floor(y),a=4*(j*r.width+i),b=a+(i<r.width-1?4:0),dy=j<r.height-1?4*r.width:0;
  const f=x-i,g=y-j,raw=r.pixels;
  const sample=c=>mix(mix(raw[a+c],raw[b+c],f),mix(raw[a+dy+c],raw[b+dy+c],f),g);
  const alpha=sample(3)*strength/255;
  for(let c=0;c<3;c++)buf[k+c]=buf[k+c]*(1-alpha)+sample(c)*strength;
 }
 function drawPlanetWind(c){
  const vectors=frameState.globalWind.vectors;
  const region=weatherMode==='terrain'&&state.provinceModel!==false&&t<2.5;
  if(!flags.wind||!vectors||t<(region?1.45:2.48))return;
  const lines=[],heads=[],used=[],gap=c.w<480?31:41;
  for(const {p,q,speed,dense} of vectors){
   if(dense&&!region)continue;
   if(dot(norm(add(p,[0,0,R])),norm(sub(c.eye,p)))<.23)continue;
   const a=c.project(p),b=c.project(q);if(!a||!b||a[0]<8||a[0]>c.w-8||a[1]<55||a[1]>c.h-42)continue;
   if(used.some(v=>Math.hypot(v[0]-a[0],v[1]-a[1])<gap))continue;
   used.push(a);const dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);if(l<.01)continue;
   const ex=dx/l,ey=dy/l,len=clamp(5+speed*.58,6,21),tx=a[0]+ex*len,ty=a[1]+ey*len;
   lines.push(ndc(a[0],a[1],c),ndc(tx,ty,c));heads.push(ndc(tx,ty,c),ndc(tx-ex*4-ey*2.2,ty-ey*4+ex*2.2,c),ndc(tx-ex*4+ey*2.2,ty-ey*4-ex*2.2,c));
  }
  const alpha=.94*(region?smooth((t-1.45)/.28):1);paint(lines,[.22,.90,.98],alpha,'LINES',true);paint(heads,[.22,.90,.98],alpha,'TRIANGLES',true);
 }
 function frameMesh(key){
  if(frameMeshes[key])return frameMeshes[key];
  const merc=(x,y)=>[(x/8192*360-180),Math.atan(Math.sinh(Math.PI*(1-2*y/8192)))/deg];
  const uv=[],points=[],nx=24,ny=26;
  function vertex(u,v){
   const [lo,la]=key==='satellite'?merc(24*256+110+200*u,13*256+244+168*v):[mix(95,108,u),mix(21.5,4.5,v)];
   return geo(lo,la,Math.max(0,elevation(lo,la)||0)/1000+.05);
  }
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const a=[i/nx,j/ny],b=[(i+1)/nx,j/ny],c=[(i+1)/nx,(j+1)/ny],d=[i/nx,(j+1)/ny];
    for(const p of [a,b,c,a,c,d]){uv.push(p);points.push(vertex(...p))}
  }
  return frameMeshes[key]={uv,points};
 }
 function drawImagery(c){
  if(t<.82||t>2.23)return;
  for(const key of ['satellite','radar']){
   if(!flags[key]||!images[key])continue;
   const m=frameMesh(key);paint(m.points,[1,1,1],key==='radar'?.96:.65,'TRIANGLES',false,m.uv,key);
  }
 }
 const tinted=new WeakMap();
 function tintImage(src,col){
  if(!src||!col||col.every(x=>x===1))return src;
  const cache=tinted.get(src)||new Map(),key=col.join('/');if(cache.revision!==src.atlasRevision){cache.clear();cache.revision=src.atlasRevision}if(cache.has(key))return cache.get(key);
  const cv=document.createElement('canvas');cv.width=src.width;cv.height=src.height;
  const ctx=cv.getContext('2d');ctx.drawImage(src,0,0);ctx.globalCompositeOperation='multiply';ctx.fillStyle='rgb('+col.map(v=>Math.round(255*v)).join(',')+')';ctx.fillRect(0,0,cv.width,cv.height);ctx.globalCompositeOperation='destination-in';ctx.drawImage(src,0,0);cache.set(key,cv);tinted.set(src,cache);return cv;
 }
 function clipCloudToTerrain(ctx,p){
  const z=softDepth;if(!z)return true;
  const [a,b,c]=p,dx=b[0]-a[0],dy=b[1]-a[1],ex=c[0]-a[0],ey=c[1]-a[1],det=dx*ey-dy*ex;
  if(Math.abs(det)<.02)return false;
  const l=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),r=Math.min(cam.w,Math.ceil(Math.max(a[0],b[0],c[0]))),
   top=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),bottom=Math.min(cam.h,Math.ceil(Math.max(a[1],b[1],c[1])));
  const step=(r-l)*(bottom-top)>20000?2:1,za=1/a[2],zb=1/b[2]-za,zc=1/c[2]-za;
  let visible=false,hidden=false;const path=new Path2D();
  for(let y=top;y<bottom;y+=step){
   const yy=y+.5*step-a[1],row=clamp(Math.floor((y+.5*step)*z.sy),0,z.h-1)*z.w;
   let run=-1;
   for(let x=l;x<r;x+=step){
    const xx=x+.5*step-a[0],u=(xx*ey-yy*ex)/det,v=(yy*dx-xx*dy)/det,inside=u>=-.012&&v>=-.012&&u+v<=1.012;
    const show=inside&&za+u*zb+v*zc>=z.depth[row+clamp(Math.floor((x+.5*step)*z.sx),0,z.w-1)];
    if(show){visible=true;if(run<0)run=x}else{if(inside)hidden=true;if(run>=0){path.rect(run,y,x-run,step);run=-1}}
   }
   if(run>=0)path.rect(run,y,r-run,step);
  }
  if(visible&&hidden)ctx.clip(path);return visible;
 }
 function softImageMesh(points,uv,key,alpha,col){
  const img=tintImage(images[key],col),ctx=soft;if(!img||!ctx)return;ctx.globalAlpha=alpha;
  for(let i=0;i<points.length;i+=3){
    const p=points.slice(i,i+3).map(v=>cam.project(v));if(p.some(v=>!v)||p.every(v=>v[0]<0)||p.every(v=>v[0]>cam.w)||p.every(v=>v[1]<0)||p.every(v=>v[1]>cam.h))continue;
    const s=uv.slice(i,i+3).map(v=>[v[0]*img.width,v[1]*img.height]);
    const x1=s[1][0]-s[0][0],y1=s[1][1]-s[0][1],x2=s[2][0]-s[0][0],y2=s[2][1]-s[0][1],det=x1*y2-x2*y1;
    const X=p[1][0]-p[0][0],Y=p[1][1]-p[0][1],X2=p[2][0]-p[0][0],Y2=p[2][1]-p[0][1];
    const a=(X*y2-X2*y1)/det,b=(Y*y2-Y2*y1)/det,c=(X2*x1-X*x2)/det,d=(Y2*x1-Y*x2)/det;
    ctx.save();ctx.beginPath();ctx.moveTo(p[0][0],p[0][1]);ctx.lineTo(p[1][0],p[1][1]);ctx.lineTo(p[2][0],p[2][1]);ctx.closePath();ctx.clip();if(key?.startsWith('cloud')&&!clipCloudToTerrain(ctx,p)){ctx.restore();continue}ctx.transform(a,b,c,d,p[0][0]-a*s[0][0]-c*s[0][1],p[0][1]-b*s[0][0]-d*s[0][1]);ctx.drawImage(img,0,0);ctx.restore();
  }
  ctx.globalAlpha=1;
 }

 let lastBase=NaN,weatherKey=null,weatherGeneration=0;
 function collect(){
  weatherGeneration++;
  for(const v of weather)if(v.vertices)gpu?.release(v.vertices);weather=[];wind=[];const seen=new Set();
  // Stable sort prefers a full native column, with local entries first on ties.
  const inputs=[...Object.values(state.columns||{}),...Object.values(state.regionalColumns||{})]
   .sort((a,b)=>(b.layers?.length||0)-(a.layers?.length||0));
  for(const c of inputs){
   let lo=c.lon??c.longitude,la=c.lat??c.latitude;
   if(!finite(lo)||!finite(la)){if(!finite(c.east)||!finite(c.north))continue;[lo,la]=fromLocal(c.east,c.north)}
   const originalId=c.gridId||la+','+lo;
   // Native cell centres, when available, take precedence over a display/summit location.
   const native=String(originalId).split(',').map(Number);if(native.length===2&&finite(native[0])&&finite(native[1])&&Math.abs(native[0]-la)<1&&Math.abs(native[1]-lo)<1){[la,lo]=native}
   const id=la.toFixed(4)+','+lo.toFixed(4);if(seen.has(id))continue;seen.add(id);
   const terrain=Math.max(elevation(lo,la)||0,c.modelGround??0,c.ground??0);
   const levels=(c.layers||[]).filter(v=>finite(v.height)&&v.height>terrain).sort((a,b)=>a.height-b.height);
   const selectLayer=levels.find(l=>Number(l.pressure)===Number(state.level));
   if(selectLayer&&finite(selectLayer.wind)&&selectLayer.wind>=0&&finite(selectLayer.dir))wind.push({lo,la,l:selectLayer,name:c.name});
   levels.forEach((l,i)=>{
    if(!finite(l.rh)||l.rh<70)return;
    const band=l.pressure>=800?'low':l.pressure>=400?'mid':'high';
    const cover=finite(l.cloud)?l.cloud:c.cloud?.[band];
    if(!finite(cover)||cover<5)return;
    const bottom=Math.max(terrain+10,i?(l.height+levels[i-1].height)/2:l.height-150),top=i+1<levels.length?(l.height+levels[i+1].height)/2:l.height+350;
    if(top<=bottom) return;
    weather.push({id:id+'/'+l.pressure,name:c.name||id,lo,la,z:(top+bottom)/2000,rz:(top-bottom)/2000,
      radius:clamp(finite(c.cellKm)?c.cellKm*.42:5.3,2,16),cover,rh:l.rh,p:l.pressure,band,at:l.height,wind:l.wind,dir:l.dir});
   });
  }
  if(!weather.some(v=>v.id===choice))choice='all';
  select.replaceChildren(new Option('Inspect cloud volume','all'),...weather.map(v=>new Option(v.name+' · '+v.p+' hPa',v.id)));select.value=choice;select.hidden=!weather.length;
  describe();
 }
 function rebuildParcel(){
  const val=flags.parcel?state.cloudBase:null;
  if(val===lastBase)return;lastBase=val;gpu?.release(baseLines);baseLines=[];
  if(finite(val)){
   const patch=patches[2],{w,h,z,box}=patch;const base=state.cloudBase;
   for(let j=0;j<h-1;j++)for(let i=0;i<w-1;i++){
    const k=j*w+i,hs=[z[k],z[k+1],z[k+w+1],z[k+w]],ij=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]];
    if(base<Math.min(...hs)||base>=Math.max(...hs))continue;const line=[];
    for(let a=0;a<4;a++){const b=(a+1)%4;if((hs[a]>base)===(hs[b]>base))continue;
     const f=(base-hs[a])/(hs[b]-hs[a]);line.push(geo(mix(box[0],box[2],mix(ij[a][0],ij[b][0],f)/(w-1)),mix(box[1],box[3],mix(ij[a][1],ij[b][1],f)/(h-1)),base/1000+.003))}
    if(line.length%2===0)baseLines.push(...line);
   }
  }
  describe();
 }
 function describe(){
  imageryLabel();const selected=weather.find(c=>c.id===choice);
  const weatherScope=scale==='global'?'Pressure-level volumes and wind cover sampled locations. ':'';
  const at=state.time?Number(state.time):null;
  const stamp=at&&finite(at)?' · '+new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'}).format(at*(at<1e12?1000:1))+' ICT':'';
  status.textContent=(scale==='province'&&flags.cloud&&provinceReport?provinceReport+' ':'')+weatherScope+(selected&&flags.cloud?selected.name+' · '+selected.p+' hPa · '+Math.round(selected.at).toLocaleString()+' m ASL · '+Math.round(selected.rh)+'% RH · '+Math.round(selected.cover)+'% '+selected.band+' cloud cover':(flags.cloud&&weather.length?'Cloud envelopes mark sampled layers with RH ≥70% and matching band cloud cover ≥5%. Their approximate extent describes model cells; individual clouds are unresolved.':flags.cloud?'No cloud envelope supported by the supplied humidity and cloud-cover samples.':'Cloud volumes hidden.'))+stamp+(flags.wind&&scale!=='global'&&wind.length?' · '+state.level+' hPa arrows point downwind.':'');
 }
 function update(v={}){
  state={...state,...v};if(!peaks[state.peak])state.peak='mon-long';
  // A different run can contain different profiles for the very same valid hour.
  const key=JSON.stringify([state.time,state.level,state.columns,state.regionalColumns]);
  if(key!==weatherKey){weatherKey=key;collect()}
  rebuildParcel();syncFrames();queue()
 }
 // Calibrated camera uses the fitted off-axis rectilinear projection, including roll/shear.
 let provincePoint=null,panRotation=[1,0,0,0],gesture='orbit',panRevision=0;
 function quaternionProduct(a,b){
  const x=a.slice(1),y=b.slice(1);
  return [a[0]*b[0]-dot(x,y),...add(add(mul(y,a[0]),mul(x,b[0])),cross(x,y))];
 }
 function rotateVector(q,v){
  const u=q.slice(1),c=cross(u,v);
  return add(v,add(mul(c,2*q[0]),mul(cross(u,c),2)));
 }
 function grabPoint(c,x,y){
  const O=add(c.eye,[0,0,R]),dx=(x-c.cx)/c.focal,dy=(c.cy-y)/c.focal+c.shear*dx;
  const ray=norm(add(c.F,add(mul(c.right,dx),mul(c.up,dy)))),b=dot(O,ray),disc=b*b-dot(O,O)+R*R;
  if(disc>=0&&b<0)return norm(add(O,mul(ray,-b-Math.sqrt(disc))));
  // A ray outside Earth's limb still tracks a continuous point on the virtual trackball.
  return norm(add(O,mul(ray,Math.max(1,-b))));
 }
 function setGesture(mode){if(['pan','orbit'].includes(mode))gesture=mode}
 function resetPan(){provincePoint=null;panRotation=[1,0,0,0];panRevision++}
 function camera(w,h){
  const pk=peaks[state.peak];
  // True vertical is retained in the calibrated camera. Relief stretches radial
  // elevation in the orbit scene, consistently for land, labels, cloud and wind.
  const localMix=smooth((t-.115)/.075),ve=observer||housePoint?1:1+(landmark?0:1.55)*localMix*(1-smooth((t-.58)/.92));
  const stretch=p=>{if(ve===1)return p;const o=add(p,[0,0,R]),l=Math.hypot(...o);return add(p,mul(o,(l-R)*(ve-1)/l))};
  const localAngle=(46+heading)*deg,latitudeTilt=clamp((housePoint?35:landmark?22:14)+tilt,4,78)*deg;
  const localDir=norm([Math.sin(localAngle)*Math.cos(latitudeTilt),-Math.cos(localAngle)*Math.cos(latitudeTilt),Math.sin(latitudeTilt)]);
  const provYaw=(31+heading)*deg,provPitch=clamp(46+tilt,13,82)*deg;
  const provinceDir=[Math.sin(provYaw)*Math.cos(provPitch),-Math.cos(provYaw)*Math.cos(provPitch),Math.sin(provPitch)];
  const peakZ=elevation(...pk.ll)/1000;
  const site=cragSites.get(landmark),cragCenter=site?stretch(geo(site.lon,site.lat,elevation(site.lon,site.lat)/1000+.03)):null;
  const houseCenter=housePoint?stretch(geo(housePoint.lon,housePoint.lat,elevation(housePoint.lon,housePoint.lat)/1000+.005)):null;
  const closeCenter=houseCenter||cragCenter||stretch(geo(...pk.ll,peakZ+.08));
  const basinCenter=houseCenter||cragCenter||stretch(geo(mix(98.985,pk.ll[0],.58),mix(18.79,pk.ll[1],.58),.67));
  const regionLon=100.4+heading*.12,regionLat=16+tilt*.1,worldLon=99+spin+heading,worldLat=clamp(18+tilt,-82,82);
  const earthCenter=[0,0,-R],regionCenter=geo(regionLon,regionLat,0),regionEye=geo(regionLon-1,regionLat-3,2400);
  const northAt=(lo,la)=>norm(sub(geo(lo,la+.01),geo(lo,la)));
  const distLocal=(w/h<1.35?36:33);
  const keys=[
   {t:.18,tar:closeCenter,off:localDir,d:housePoint?2.8:landmark?1.35:5.2,up:[0,0,1]},
   {t:.36,tar:basinCenter,off:localDir,d:distLocal,up:[0,0,1]},
   {t:1,tar:houseCenter||(provincePoint?stretch(geo(...provincePoint,(elevation(...provincePoint)||0)/1000)):geo(98.90,18.77,.5)),off:provinceDir,d:provincePoint?138:405,up:[0,0,1]},
   {t:2,tar:regionCenter,off:norm(sub(regionEye,regionCenter)),d:Math.hypot(...sub(regionEye,regionCenter)),up:northAt(regionLon,regionLat)},
   {t:3,tar:earthCenter,off:norm(sub(geo(worldLon,worldLat,0),earthCenter)),d:16571,up:northAt(worldLon,worldLat)},
   {t:3.35,tar:earthCenter,off:norm(sub(geo(worldLon,worldLat,0),earthCenter)),d:24200,up:northAt(worldLon,worldLat)}
  ];
  let i=0;while(i<keys.length-2&&t>keys[i+1].t)i++;
  const A=keys[i],B=keys[i+1],a=clamp((t-A.t)/(B.t-A.t),0,1),f=smooth(a),tar=lerp(A.tar,B.tar,f),d=Math.exp(mix(Math.log(A.d),Math.log(B.d),a));
  const off=norm(lerp(A.off,B.off,f));let eye=add(tar,mul(off,d)),F=mul(off,-1),Uguess=norm(lerp(A.up,B.up,f));
  eye=sub(rotateVector(panRotation,add(eye,[0,0,R])),[0,0,R]);F=rotateVector(panRotation,F);Uguess=rotateVector(panRotation,Uguess);
  const blendPose=transition||dollyCarry,carry=blendPose?.capture;
  const release=carry?smooth((performance.now()-blendPose.start)/Math.min(260,blendPose.duration||1)):1;
  if(carry&&release<1){eye=lerp(carry.eye,eye,release);F=norm(lerp(carry.F,F,release));Uguess=norm(lerp(carry.up,Uguess,release))}
  const point=observer?.point,localUp=point?norm(add(geo(point.lon,point.lat),[0,0,R])):[0,0,1];
  const east=point?norm(sub(geo(point.lon+.0001,point.lat),geo(point.lon-.0001,point.lat))):[1,0,0],north=norm(cross(localUp,east));
  const directionVec=(az,alt)=>{const a=az*deg,b=alt*deg;return add(mul(east,Math.sin(a)*Math.cos(b)),add(mul(north,Math.cos(a)*Math.cos(b)),mul(localUp,Math.sin(b))))};
  if(observer){
   const {point,az,alt}=observer;
   eye=geo(point.lon,point.lat,((elevation(point.lon,point.lat)||0)+1.7)/1000);
   F=directionVec(az+heading,clamp(alt+tilt,-85,85));Uguess=localUp;
  }
  const right=norm(cross(F,Uguess)),up=norm(cross(right,F));
  const localFocal=Math.max(h*1.13,w*.62),wideFocal=Math.min(w,h)*1.08;

  let focal=mix(localFocal,wideFocal,smooth((t-.45)/.65));
  let cx=w/2,cy=h*.52,shear=0;
  if(carry&&release<1){cx=mix(carry.cx,cx,release);cy=mix(carry.cy,cy,release);shear=mix(carry.shear,shear,release);focal=Math.exp(mix(Math.log(carry.focal),Math.log(focal),release))}
  if(observer){const sunset=observer.mode==='sunset';focal=(observer.mode==='solar'?Math.min(w*.56,h*.65,h*.35/Math.max(.01,Math.tan((observer.framedAlt-observer.alt)*deg)),h*.38/Math.max(.01,Math.tan(observer.alt*deg))):w*.5/Math.tan((sunset?15:29)*deg))*zoom;cx=w/2;cy=h*(sunset?.60:observer.mode==='solar'?.48:.49);shear=0}
  function direction(az,alt){const v=directionVec(az,alt),z=dot(v,F);if(z<=.001)return null;const x=dot(v,right)*focal/z;return [cx+x,cy-dot(v,up)*focal/z+shear*x,z]}
  const near=observer?.002:Math.max(.025,d/9000);
  return {direction,eye,F,right,up,focal,cx,cy,shear,near,far:65000,pk,w,h,ve,stretch,project(p){
   const v=sub(stretch(p),eye),z=dot(v,F);if(z<=near)return null;const x=dot(v,right)*focal/z;return [cx+x,cy-dot(v,up)*focal/z+shear*x,z]}};
 }
 function drawTerrainMeshes(render){
  if(t>.15||!flags.terrain)render(0);
  if(flags.terrain&&(weatherMode!=='systems'||t<.72)&&(mapLayers.terrain||t<1.18||!images.southeastRelief)){
   for(let i=1;i<=patches.length;i++)if(patchVisible(i,t))render(i);
  }
 }
 function initGPU(){
  let gl;try{gl=cv.getContext('webgl',{alpha:false,antialias:true,preserveDrawingBuffer:false,powerPreference:'low-power'})}catch{}
  if(!gl)return null;
  const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s};
  const vs=`attribute vec3 p,c;attribute vec2 uv;uniform vec3 eye,r,u,f;uniform vec2 wh,center;uniform float focal,shear,nearZ,farZ,screen,ve;varying vec3 color;varying vec2 tex;varying float depth;varying vec3 globeNormal;
  void main(){color=c;tex=uv;vec3 n=normalize(p+vec3(0.,0.,6371.0088));globeNormal=vec3(dot(n,r),dot(n,u),-dot(n,f));if(screen>.5){gl_Position=vec4(p.xy,0.,1.);depth=0.;}else{vec3 d=p+n*((length(p+vec3(0.,0.,6371.0088))-6371.0088)*(ve-1.))-eye;float z=dot(d,f);float x=dot(d,r)*focal;float y=dot(d,u)*focal-shear*x;gl_Position=vec4(2.*x/wh.x+(2.*center.x/wh.x-1.)*z,2.*y/wh.y+(1.-2.*center.y/wh.y)*z,(farZ+nearZ)/(farZ-nearZ)*z-2.*farZ*nearZ/(farZ-nearZ),z);depth=z;}}`;
  const fs=`precision highp float;varying vec3 color;varying vec2 tex;varying float depth;varying vec3 globeNormal;uniform sampler2D image,planetWeather,basinImage,highlandsImage,shadowImage,cragImage,regionImage,rainImage;uniform vec4 rainBox;uniform float rainWeight,depthPass;uniform float regionalCoverMode,cragReady;uniform vec4 cragBox,shadowBox;uniform vec3 terrainLight;uniform float reliefSun;uniform float basinReady,highlandsReady,regionReady,tintCloud;uniform vec3 cloudTint;uniform float textured,alpha,fog,planet,planetStrength,optical,sky;uniform vec4 area;void main(){
   if(depthPass>.5){
    float d=clamp(floor(depth*1024.+.5),0.,16777214.);
    gl_FragColor=vec4(floor(d/65536.),mod(floor(d/256.),256.),mod(d,256.),255.)/255.;return;
   }
   if(sky>0.){float y=clamp(tex.y,0.,1.);gl_FragColor=vec4(mix(vec3(.90,.88,.76),vec3(.44,.66,.75),smoothstep(.22,1.,y)),1.);return;}vec3 base=mix(color,texture2D(image,tex).rgb,textured);
   if(tintCloud>.5)base*=cloudTint;if(optical>.5){vec2 ll=vec2(tex.x*360.-180.,90.-tex.y*180.);
    if(regionReady>.001){vec2 uv=(ll-vec2(70.,40.))/vec2(63.,-48.);float edge=min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y));base=mix(base,texture2D(regionImage,uv).rgb,regionReady*smoothstep(0.,.12,edge));}
    if(highlandsReady>.001){vec2 uv=(ll-vec2(97.35,20.45))/vec2(3.20,-3.40);float edge=min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y));base=mix(base,texture2D(highlandsImage,uv).rgb,highlandsReady*smoothstep(0.,.035,edge));}
    if(basinReady>.001){vec2 uv=(ll-vec2(98.53,19.16))/vec2(.74,-.67);float edge=min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y));base=mix(base,texture2D(basinImage,uv).rgb,basinReady*smoothstep(0.,.028,edge));}
    if(cragReady>.0){vec2 cr=(ll-vec2(cragBox.x,cragBox.w))/vec2(cragBox.z-cragBox.x,cragBox.y-cragBox.w);float ed=min(min(cr.x,1.-cr.x),min(cr.y,1.-cr.y));base=mix(base,texture2D(cragImage,cr).rgb,cragReady*smoothstep(0.,.075,ed));}
   }
   if(rainWeight>0.){
    vec2 ll=vec2(tex.x*360.-180.,90.-tex.y*180.);
    vec2 uv=(ll-vec2(rainBox.x,rainBox.w))/vec2(rainBox.z-rainBox.x,rainBox.y-rainBox.w);
    if(all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.)))){
     vec4 wet=texture2D(rainImage,uv);
     float shade=.65+.65*dot(base,vec3(.2126,.7152,.0722));
     base=mix(base,wet.rgb*shade,wet.a*rainWeight);
    }
   }
   base*=terrainLight;if(reliefSun>.5){vec2 ll=vec2(tex.x*360.-180.,90.-tex.y*180.);vec2 suv=(ll-vec2(shadowBox.x,shadowBox.w))/vec2(shadowBox.z-shadowBox.x,shadowBox.y-shadowBox.w);float edge=min(min(suv.x,1.-suv.x),min(suv.y,1.-suv.y));base*=mix(1.,texture2D(shadowImage,suv).r,smoothstep(0.,.025,edge));}if(planetStrength>0.){if(regionalCoverMode>.5){vec2 uv=(vec2(tex.x*360.-180.,90.-tex.y*180.)-vec2(72.,44.))/vec2(64.,-54.);if(all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.)))){vec4 layer=texture2D(planetWeather,uv);base=base*(1.-layer.a*planetStrength)+layer.rgb*planetStrength;}}else{vec4 layer=texture2D(planetWeather,tex);base=mix(base,layer.rgb,layer.a*planetStrength);}}if(planet>0.){vec3 n=normalize(globeNormal);float lit=.50+.63*max(0.,dot(n,normalize(vec3(-.50,.61,.70))));base=mix(base,base*lit+vec3(.08,.16,.22)*pow(1.-clamp(n.z,0.,1.),3.),planet);}base=mix(base,vec3(.75,.80,.74),fog*clamp(1.-exp(-max(0.,depth-3.)/85.),0.,.90));gl_FragColor=vec4(base,alpha*mix(1.,texture2D(image,tex).a,textured));}`;
  const prog=gl.createProgram();gl.attachShader(prog,shader(gl.VERTEX_SHADER,vs));gl.attachShader(prog,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(prog);if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(prog));gl.useProgram(prog);
  const loc={};for(const name of ['p','c','uv'])loc[name]=gl.getAttribLocation(prog,name);
  for(const name of ['rainImage','rainWeight','rainBox','depthPass','regionalCoverMode','terrainLight','shadowBox','cragImage','cragReady','cragBox','regionImage','regionReady','cloudTint','tintCloud','reliefSun','shadowImage','basinImage','highlandsImage','basinReady','highlandsReady','eye','r','u','f','wh','center','focal','shear','nearZ','farZ','screen','image','textured','alpha','fog','planet','planetWeather','planetStrength','ve','optical','area','sky'])loc[name]=gl.getUniformLocation(prog,name);
  const buffers=[];function buffer(target,arr){const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(target,b);gl.bufferData(target,arr,gl.STATIC_DRAW);return b}
  const meshes=[];function makeMesh(i){const o=geography(i);return meshes[i]={p:buffer(gl.ARRAY_BUFFER,o.pos),c:buffer(gl.ARRAY_BUFFER,o.col),uv:buffer(gl.ARRAY_BUFFER,o.uv),idx:buffer(gl.ELEMENT_ARRAY_BUFFER,o.ind),count:o.ind.length}}
  const dyn=buffer(gl.ARRAY_BUFFER,new Float32Array(0)),dynUV=buffer(gl.ARRAY_BUFFER,new Float32Array(0)),textures={},textureSource={},textureStamp={};
  function texture(key){
   const im=images[key];if(textures[key]&&textureSource[key]===im){
    if(im?.atlasRevision!==textureStamp[key]){gl.bindTexture(gl.TEXTURE_2D,textures[key]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im);textureStamp[key]=im.atlasRevision}
    return textures[key];
   }if(textures[key]){gl.deleteTexture(textures[key]);delete textures[key]}textureSource[key]=im;textureStamp[key]=im?.atlasRevision;if(!im&&key!=='none')return texture('none');
   const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
   if(key==='regionalCover'&&im)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,im.width,im.height,0,gl.RGBA,gl.UNSIGNED_BYTE,im.pixels);else if(im)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im);else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([110,148,151,255]));
   return textures[key]=tex;
  }
  const cached=new Map();
  function keep(points){
   if(cached.has(points))return cached.get(points);
   const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points.flat()),gl.STATIC_DRAW);cached.set(points,b);return b;
  }
  function release(points){if(cached.has(points)){gl.deleteBuffer(cached.get(points));cached.delete(points)}}
  const attr=(name,buf,size)=>{gl.enableVertexAttribArray(loc[name]);gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.vertexAttribPointer(loc[name],size,gl.FLOAT,false,0,0)};
  const uf=(k,v)=>gl.uniform1f(loc[k],v);
  function begin(c,dpr){
   gl.viewport(0,0,cv.width,cv.height);const night=smooth((t-1.45)/1.1);
   gl.clearColor(mix(.72,.035,night),mix(.82,.075,night),mix(.85,.104,night),1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);
   for(const [k,v] of [['eye',c.eye],['r',c.right],['u',c.up],['f',c.F]])gl.uniform3fv(loc[k],v);
   gl.uniform2f(loc.wh,c.w,c.h);gl.uniform2f(loc.center,c.cx,c.cy);for(const [k,v] of [['focal',c.focal],['shear',c.shear],['nearZ',c.near],['farZ',c.far],['screen',0],['alpha',1],['ve',c.ve],['sky',0],['optical',0],['fog',1-smooth(t/.95)]])uf(k,v);
   gl.activeTexture(gl.TEXTURE7);gl.uniform1i(loc.rainImage,7);gl.bindTexture(gl.TEXTURE_2D,texture('rainSurface'));gl.uniform4fv(loc.rainBox,rainBox||[0,0,1,1]);
   gl.activeTexture(gl.TEXTURE5);gl.uniform1i(loc.cragImage,5);gl.bindTexture(gl.TEXTURE_2D,texture(images.cragSurface?'cragSurface':'none'));uf('cragReady',images.cragOpt&&mapLayers.terrain?1-smooth((t-.76)/.54):0);gl.uniform4fv(loc.cragBox,cragDetail?.image?.box||[0,0,1,1]);
   gl.uniform4fv(loc.shadowBox,sunScene?.shadowBox||[0,0,1,1]);gl.activeTexture(gl.TEXTURE4);gl.uniform1i(loc.shadowImage,4);gl.bindTexture(gl.TEXTURE_2D,texture(images.sunShadow?'sunShadow':'none'));
   const weights=opticalWeights();
   gl.activeTexture(gl.TEXTURE6);gl.uniform1i(loc.regionImage,6);gl.bindTexture(gl.TEXTURE_2D,texture(regionalBaseTextureKey()));uf('regionReady',weights.region);
   gl.activeTexture(gl.TEXTURE2);gl.uniform1i(loc.basinImage,2);gl.bindTexture(gl.TEXTURE_2D,texture(images.basin?'basin':'none'));uf('basinReady',images.basin?weights.basin:0);
   gl.activeTexture(gl.TEXTURE3);gl.uniform1i(loc.highlandsImage,3);gl.bindTexture(gl.TEXTURE_2D,texture(images.highlands?'highlands':'none'));uf('highlandsReady',images.highlands?weights.highlands:0);
   gl.activeTexture(gl.TEXTURE1);gl.uniform1i(loc.planetWeather,1);gl.bindTexture(gl.TEXTURE_2D,texture(systemsActive()?'systems':images.regionalCover?'regionalCover':images.planet?'planet':'none'));
   gl.activeTexture(gl.TEXTURE0);gl.uniform1i(loc.image,0);gl.bindTexture(gl.TEXTURE_2D,texture('earth'));
   if(t<.8||images.solarSky){uf('sky',images.solarSky?0:1);paint([[-1,-1,0],[1,-1,0],[1,1,0],[-1,-1,0],[1,1,0],[-1,1,0]],[1,1,1],1,'TRIANGLES',true,images.solarSky?[[0,1],[1,1],[1,0],[0,1],[1,0],[0,0]]:[[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]],images.solarSky?'solarSky':null);uf('sky',0)}
  }
  function land(i){uf('rainWeight',rainStrength());uf('tintCloud',0);gl.uniform3fv(loc.terrainLight,solarTint);uf('reliefSun',images.sunShadow?1:0);const m=meshes[i]||makeMesh(i);attr('p',m.p,3);attr('c',m.c,3);attr('uv',m.uv,2);
   gl.bindTexture(gl.TEXTURE_2D,texture('earth'));uf('optical',mapLayers.terrain||images.southeastRelief&&t>.22&&t<2.9?1:0);uf('fog',1-smooth(t/.95));
   uf('textured',!mapLayers.terrain?0:weatherMode==='systems'||i===0||i===1?1:i===2?.2:.04);if(!mapLayers.terrain&&i===0){gl.disableVertexAttribArray(loc.c);gl.vertexAttrib3f(loc.c,.60,.65,.64)}uf('planet',smooth((t-.95)/1.45));uf('regionalCoverMode',images.regionalCover?1:0);uf('planetStrength',systemsActive()?cloudStrength():images.regionalCover?regionalStrength():i===0&&globeCloudVisible()&&images.planet?smooth((t-2.18)/.45):0);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.idx);gl.drawElements(gl.TRIANGLES,m.count,gl.UNSIGNED_SHORT,0)}
  function paint(points,color,alpha,mode,screen=false,uv=null,key=null){
   if(!points.length)return;uf('rainWeight',0);gl.uniform3f(loc.terrainLight,1,1,1);uf('tintCloud',key?.startsWith('cloud')?1:0);gl.uniform3fv(loc.cloudTint,color);uf('reliefSun',0);uf('optical',0);uf('planet',0);uf('planetStrength',0);uf('screen',screen?1:0);uf('fog',0);uf('textured',key?1:0);uf('alpha',alpha);
   if(key)gl.bindTexture(gl.TEXTURE_2D,texture(key));
   const immutable=!screen&&(mode==='TRIANGLES'&&points.cloudGeometry||points===boundary||points===baseLines||key==='radar'||key==='satellite');
   if(immutable)attr('p',keep(points),3);else{attr('p',dyn,3);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points.flat()),gl.DYNAMIC_DRAW)}
   gl.disableVertexAttribArray(loc.c);gl.vertexAttrib3fv(loc.c,color);
   if(uv){if(immutable)attr('uv',keep(uv),2);else{attr('uv',dynUV,2);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(uv.flat()),gl.DYNAMIC_DRAW)}}else{gl.disableVertexAttribArray(loc.uv);gl.vertexAttrib2f(loc.uv,0,0)}
   if(screen||key==='radar'||key==='satellite')gl.disable(gl.DEPTH_TEST);if(alpha<1||key?.startsWith('cloud')){gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false)}
   gl.drawArrays(gl[mode],0,points.length);gl.depthMask(true);gl.disable(gl.BLEND);gl.enable(gl.DEPTH_TEST);uf('screen',0);
  }
  // Canvas air marks can query many positions per pose. Read the visible terrain
  // once, on demand, with the same meshes and camera as the colour pass.
  let depthTarget=null,depthPose='',depthCamera=null;
  function releaseDepth(){
   if(!depthTarget)return;
   gl.deleteFramebuffer(depthTarget.fb);gl.deleteTexture(depthTarget.image);gl.deleteRenderbuffer(depthTarget.z);depthTarget=null;
  }
  function readTerrainDepth(c){
   if(depthCamera===c)return depthTarget;
   depthCamera=c;
   const indices=[];drawTerrainMeshes(i=>indices.push(i));
   const pose=[c.w,c.h,c.focal,c.cx,c.cy,c.shear,c.near,c.ve,...c.eye,...c.F,...c.up,...indices].join('/');
   if(depthPose===pose)return depthTarget;
   depthPose=pose;
   const ratio=Math.min(1,440/Math.max(c.w,c.h)),w=Math.max(1,Math.round(c.w*ratio)),h=Math.max(1,Math.round(c.h*ratio));
   const prev=gl.getParameter(gl.FRAMEBUFFER_BINDING);
   if(!depthTarget||depthTarget.w!==w||depthTarget.h!==h){
    releaseDepth();
    const fb=gl.createFramebuffer(),z=gl.createRenderbuffer(),image=gl.createTexture();
    depthTarget={fb,z,image,w,h,pixels:new Uint8Array(w*h*4)};
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.bindRenderbuffer(gl.RENDERBUFFER,z);
    gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,z);
    gl.activeTexture(gl.TEXTURE0);const old=gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.bindTexture(gl.TEXTURE_2D,image);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,image,0);
    gl.bindTexture(gl.TEXTURE_2D,old);gl.bindRenderbuffer(gl.RENDERBUFFER,null);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){gl.bindFramebuffer(gl.FRAMEBUFFER,prev);releaseDepth();return null}
   }else gl.bindFramebuffer(gl.FRAMEBUFFER,depthTarget.fb);
   const dither=gl.isEnabled(gl.DITHER);
   gl.disable(gl.DITHER);gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.depthMask(true);gl.enable(gl.DEPTH_TEST);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
   uf('depthPass',1);gl.disableVertexAttribArray(loc.c);gl.disableVertexAttribArray(loc.uv);
   for(const i of indices){
    const m=meshes[i]||makeMesh(i);attr('p',m.p,3);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.idx);gl.drawElements(gl.TRIANGLES,m.count,gl.UNSIGNED_SHORT,0);
   }
   gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,depthTarget.pixels);
   uf('depthPass',0);if(dither)gl.enable(gl.DITHER);gl.bindFramebuffer(gl.FRAMEBUFFER,prev);gl.viewport(0,0,cv.width,cv.height);
   return depthTarget;
  }
  function terrainVisible(c,p){
   const map=readTerrainDepth(c);if(!map)return false;
   const x=Math.floor(p[0]*map.w/c.w),y=map.h-1-Math.floor(p[1]*map.h/c.h),k=4*(y*map.w+x),v=map.pixels;
   return !v[k+3]||p[2]<=(v[k]*65536+v[k+1]*256+v[k+2])/1024+.003;
  }
  let cloudGPU;
  function drawClouds(options){
   if(cloudGPU===undefined)cloudGPU=window.AtlasCloudGPU?.create(gl)||null;
   return cloudGPU?.draw(options)||false;
  }
  return {begin,land,paint,release,terrainVisible,drawClouds,suspendClouds(){cloudGPU?.suspend()},get cloudStats(){return cloudGPU?.stats??null},get cloudCount(){return cloudGPU?.visible??null},get cloudTransition(){return cloudGPU?.transitioning},destroy(){releaseDepth();cloudGPU?.destroy();for(const b of cached.values())gl.deleteBuffer(b);cached.clear();buffers.forEach(b=>gl.deleteBuffer(b));Object.values(textures).forEach(v=>gl.deleteTexture(v));gl.deleteProgram(prog)}};
 }
 function getSoft(){try{return cv.getContext('2d',{alpha:false})}catch{return null}}
 let rendererStarted=false;
 function startRenderer(){
  if(rendererStarted)return;rendererStarted=true;
  try{gpu=initGPU()}catch(e){console.warn('Atlas GPU initialization',e.message)}
  if(!gpu){soft=getSoft();if(!soft){const replacement=cv.cloneNode();cv.replaceWith(replacement);cv=replacement;soft=getSoft();bind()}}
 }
 const softTiles={},rasterCache={};
 let softDepth=null,softDepthRevision=0;
 function isTerrainVisible(worldPosition,projectedPoint){
  const p=projectedPoint||cam.project(worldPosition);
  if(!p||p[0]<0||p[1]<0||p[0]>=cam.w||p[1]>=cam.h)return false;
  if(gpu)return gpu.terrainVisible(cam,p);
  if(softDepth){
   const z=softDepth,k=Math.floor(p[1]*z.sy)*z.w+Math.floor(p[0]*z.sx),inv=z.depth[k];
   if(inv>0)return p[2]<=1/inv+.003;
  }
  // Outside the rasterized DEM (or with relief disabled), the rendered land
  // is the sphere. Intersect the same camera ray that softLand uses.
  const ox=cam.eye[0],oy=cam.eye[1],oz=cam.eye[2]+R,dx=(p[0]-cam.cx)/cam.focal,dy=(cam.cy-p[1])/cam.focal+cam.shear*dx;
  const x=cam.F[0]+cam.right[0]*dx+cam.up[0]*dy,y=cam.F[1]+cam.right[1]*dx+cam.up[1]*dy,z=cam.F[2]+cam.right[2]*dx+cam.up[2]*dy;
  const a=x*x+y*y+z*z,b=ox*x+oy*y+oz*z,d=b*b-a*(ox*ox+oy*oy+oz*oz-R*R);
  return d<0||b>=0||p[2]<=(-b-Math.sqrt(d))/a+.003;
 }
 function texturePixels(id){
  const img=images[id];if(!img)return null;if(softTiles[id]?.source===img)return softTiles[id];
  const canvas=document.createElement('canvas');const scale=Math.min(1,1400/img.width);canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);
  const g=canvas.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0,canvas.width,canvas.height);
  return softTiles[id]={source:img,pixels:g.getImageData(0,0,canvas.width,canvas.height).data,w:canvas.width,h:canvas.height};
 }
 function sampleOptical(pixels,k,img,box,mixIn,fade,lon,lat){
  if(!img||mixIn<=.0001||!inside(lon,lat,box))return;
  const u=(lon-box[0])/(box[2]-box[0]),v=(box[3]-lat)/(box[3]-box[1]);
  const alpha=mixIn*smooth(Math.min(u,v,1-u,1-v)/fade);if(alpha<=.0001)return;
  const x=u*(img.w-1),y=v*(img.h-1),i=Math.min(img.w-2,Math.floor(x)),j=Math.min(img.h-2,Math.floor(y));
  const p=x-i,q=y-j,index=(j*img.w+i)*4,dy=img.w*4,data=img.pixels;
  for(let ch=0;ch<3;ch++){
   const a=index+ch;
   const shade=mix(mix(data[a],data[a+4],p),mix(data[a+dy],data[a+dy+4],p),q);
   pixels[k+ch]=mix(pixels[k+ch],shade,alpha);
  }
 }
 function sampleRain(pix,k,tex,strength,lon,lat){
  if(!inside(lon,lat,rainBox))return;
  const x=clamp((lon-rainBox[0])/(rainBox[2]-rainBox[0])*tex.w-.5,0,tex.w-1);
  const y=clamp((rainBox[3]-lat)/(rainBox[3]-rainBox[1])*tex.h-.5,0,tex.h-1);
  const i=Math.floor(x),j=Math.floor(y),a=4*(j*tex.w+i),b=i+1<tex.w?a+4:a,dy=j+1<tex.h?4*tex.w:0;
  const fx=x-i,fy=y-j,data=tex.pixels;
  const channel=c=>mix(mix(data[a+c],data[b+c],fx),mix(data[a+dy+c],data[b+dy+c],fx),fy);
  const alpha=channel(3)*strength/255;if(!alpha)return;
  const shade=.65+.65*(.2126*pix[k]+.7152*pix[k+1]+.0722*pix[k+2])/255;
  for(let c=0;c<3;c++)pix[k+c]=mix(pix[k+c],channel(c)*shade,alpha);
 }
 function softTerrain(c,rain,weight){
  const cap=drag||dolly||transition?485:760,s=Math.min(1,cap/c.w),w=Math.max(1,Math.round(c.w*s)),h=Math.max(1,Math.round(c.h*s));
  const canvas=rasterCache.canvas??=document.createElement('canvas');if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
  const g=canvas.getContext('2d'),weights=opticalWeights();
  const loTex=mapLayers.terrain&&texturePixels('highlands'),hiTex=mapLayers.terrain&&texturePixels('basin'),regionTex=texturePixels(regionalBaseTextureKey()),cragTex=mapLayers.terrain&&texturePixels('cragSurface'),cb=cragDetail?.image?.box;
  const shadeTerrain=!loTex||!hiTex;
  const key=[w,h,c.w,c.h,t,c.ve,c.cx,c.cy,c.focal,c.shear,c.near,...c.eye,...c.F,...c.up,
   Boolean(observer),landmark,systemVersion,systemsActive(),mapLayers.terrain,!!hiTex,!!loTex,!!regionTex,images.cragSurface?.atlasRevision].join('/');
  const cached=rasterCache.terrain;
  function relight(base,out,longitude,latitude){
   const pix=out.data,day=solarTint.every(channel=>channel===1);
   if(day&&!images.sunShadow&&!rain)pix.set(base);
   else {
    for(let k=0;k<w*h;k++){
     const offset=4*k,alpha=base[offset+3];pix[offset+3]=alpha;
     if(!alpha)continue;
     const light=images.sunShadow?sunScene.sample(longitude[k],latitude[k]):1;
     for(let ch=0;ch<3;ch++)pix[offset+ch]=base[offset+ch];
     if(rain)sampleRain(pix,offset,rain,weight,longitude[k],latitude[k]);
     for(let ch=0;ch<3;ch++)pix[offset+ch]*=light*solarTint[ch];
    }
   }
   g.putImageData(out,0,0);soft.drawImage(canvas,0,0,c.w,c.h);
  }
  if(cached?.key===key){
   softDepth=cached.softDepth;
   relight(cached.base,cached.out,cached.longitude,cached.latitude);return;
  }
  const out=g.createImageData(w,h),pix=new Uint8ClampedArray(w*h*4),depth=new Float32Array(w*h);
  const longitude=new Float32Array(w*h),latitude=new Float32Array(w*h);
  softDepth={depth,w,h,sx:w/c.w,sy:h/c.h,revision:++softDepthRevision};
  function triangle(a,b,d){
   if(!a||!b||!d)return;const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],d[0]))),x1=Math.min(w-1,Math.ceil(Math.max(a[0],b[0],d[0]))),
    y0=Math.max(0,Math.floor(Math.min(a[1],b[1],d[1]))),y1=Math.min(h-1,Math.ceil(Math.max(a[1],b[1],d[1])));
   if(x0>x1||y0>y1)return;const dx=b[0]-a[0],dy=b[1]-a[1],ex=d[0]-a[0],ey=d[1]-a[1],det=dx*ey-dy*ex;if(Math.abs(det)<.02)return;
   const ub=ey/det,ud=-dy/det,vb=-ex/det,vd=dx/det;
   for(let y=y0;y<=y1;y++){let B=((x0+.5-a[0])*ey-(y+.5-a[1])*ex)/det,D=(dx*(y+.5-a[1])-dy*(x0+.5-a[0]))/det;
    for(let x=x0;x<=x1;x++,B+=ub,D+=ud){const A=1-B-D;if(B<-.00001||D<-.00001||A<-.00001)continue;
     const iz=A*a[2]+B*b[2]+D*d[2],k=y*w+x;if(iz<=depth[k])continue;depth[k]=iz;const z=1/iz;
     const lon=(A*a[3]+B*b[3]+D*d[3])*z,lat=(A*a[4]+B*b[4]+D*d[4])*z;
     const fog=clamp(1-Math.exp(-Math.max(0,z-3)/85),0,.9)*(1-smooth(t/.95)),pixel=4*k;
     if(shadeTerrain){for(let ch=0;ch<3;ch++)pix[pixel+ch]=(A*a[5+ch]+B*b[5+ch]+D*d[5+ch])*z*255}
     else{pix[pixel]=79;pix[pixel+1]=113;pix[pixel+2]=97}
     sampleOptical(pix,pixel,regionTex,opticalRegion,weights.region,.12,lon,lat);
     sampleOptical(pix,pixel,loTex,opticalHighlands,weights.highlands,.035,lon,lat);
     sampleOptical(pix,pixel,hiTex,opticalBasin,weights.basin,.028,lon,lat);
     if(cragTex&&cb)sampleOptical(pix,pixel,cragTex,cb,1,.075,lon,lat);
     for(let ch=0;ch<3;ch++)pix[pixel+ch]=mix(pix[pixel+ch],[191,204,189][ch],fog);
     if(systemsActive()){const v=synopticAt(lon,lat),a=v[3]/255*cloudStrength();for(let ch=0;ch<3;ch++)pix[4*k+ch]=mix(pix[4*k+ch],v[ch],a)}
     longitude[k]=lon;latitude[k]=lat;
     pix[4*k+3]=255;
    }
   }
  }
  for(let i=shadeTerrain?1:2;i<=patches.length;i++){
   if(!patchVisible(i,t))continue;const g=geography(i);
   const {box,hole,cragHole}=layout[i-1],holes=[hole,cragHole].filter(Boolean),stride=i===4&&landmark?1:2,cols=[],rows=[];for(let u=0;u<g.w-1;u+=stride)cols.push(u);cols.push(g.w-1);for(let v=0;v<g.h-1;v+=stride)rows.push(v);rows.push(g.h-1);
   for(const hole of holes){for(const k of [hole[0],hole[2]])if(!cols.includes(k))cols.push(k);for(const k of [hole[1],hole[3]])if(!rows.includes(k))rows.push(k);cols.sort((a,b)=>a-b);rows.sort((a,b)=>a-b)}
   const vertex=(i,j)=>{
    const n=j*g.w+i,world=[g.pos[3*n],g.pos[3*n+1],g.pos[3*n+2]],v=sub(c.stretch(world),c.eye);
    const point=[dot(v,c.right),dot(v,c.up),dot(v,c.F),g.uv[n*2]*360-180,90-g.uv[n*2+1]*180];
    if(shadeTerrain)point.push(g.col[3*n],g.col[3*n+1],g.col[3*n+2]);
    return point;
   };
   const project=v=>{
    const z=1/v[2],x=v[0]*c.focal*z,screen=[(c.cx+x)*w/c.w,(c.cy-v[1]*c.focal*z+c.shear*x)*h/c.h,z,v[3]*z,v[4]*z];
    if(shadeTerrain)screen.push(v[5]*z,v[6]*z,v[7]*z);
    return screen;
   };
   const vertices=rows.map(j=>cols.map(i=>{const v=vertex(i,j);return {v,p:v[2]>=c.near?project(v):null}}));
   function clipped(a,b,d){
    if(a.p&&b.p&&d.p){triangle(a.p,b.p,d.p);return}
    if(!observer||!a.p&&!b.p&&!d.p)return;
    const verts=[a,b,d],poly=[];
    for(let j=0;j<3;j++){const A=verts[j],B=verts[(j+1)%3];if(A.p)poly.push(A.p);
     if(!!A.p!==!!B.p)poly.push(project(lerp(A.v,B.v,(c.near-A.v[2])/(B.v[2]-A.v[2]))))}
    for(let j=2;j<poly.length;j++)triangle(poly[0],poly[j-1],poly[j]);
   }
   for(let j=0;j<rows.length-1;j++)for(let k=0;k<cols.length-1;k++){if(holes.some(h=>cols[k]>=h[0]&&cols[k+1]<=h[2]&&rows[j]>=h[1]&&rows[j+1]<=h[3]))continue;
    const a=vertices[j][k],b=vertices[j][k+1],d=vertices[j+1][k+1],f=vertices[j+1][k];clipped(a,b,d);clipped(a,d,f)}

  }
  rasterCache.terrain={key,base:pix,out,longitude,latitude,softDepth};
  relight(pix,out,longitude,latitude);
 }

 function softLand(c){
  const ctx=soft;if(!ctx)return;
  softDepth=null;const weight=rainStrength(),rain=weight>0?texturePixels('rainSurface'):null;
  const distant=smooth((t-1.2)/1.25),bg=ctx.createLinearGradient(0,0,0,c.h);
  bg.addColorStop(0,distant>.5?'#101e2a':'#a8c2cf');bg.addColorStop(1,distant>.5?'#081822':'#d1ded9');ctx.fillStyle=bg;ctx.fillRect(0,0,c.w,c.h);if(images.solarSky)ctx.drawImage(images.solarSky,0,0,c.w,c.h);
  if(images.earth && (t>.12||!flags.terrain)){
   const regionalCover=images.regionalCover,regionalAlpha=regionalStrength();
   const cloudImage=regionalCover?null:systemsActive()?images.systems:t>2.18&&globeCloudVisible()?images.planet:null;
   const opacity=systemsActive()?Math.round(cloudStrength()*20)/20:smooth((t-2.18)/.45);
   if(!softwareImage||softwarePlanet!==images.earth){const v=document.createElement('canvas');v.width=512;v.height=256;const x=v.getContext('2d');if(mapLayers.terrain)x.drawImage(images.earth,0,0,512,256);else{x.fillStyle='#99a6a3';x.fillRect(0,0,512,256)}softwarePlanet=images.earth;softwareImage=x.getImageData(0,0,512,256).data}
   const region=texturePixels(regionalBaseTextureKey());
   const highlands=mapLayers.terrain?texturePixels('highlands'):null,basin=mapLayers.terrain?texturePixels('basin'):null;
   const weatherTex=cloudImage?texturePixels(systemsActive()?'systems':'planet'):null,weights=opticalWeights();
   const height=clamp(Math.floor(c.h*(region&&weights.region>.02?.71:.50)),120,440),width=Math.min(900,Math.round(height*c.w/c.h));
   const small=document.createElement('canvas');small.width=width;small.height=height;const off=small.getContext('2d'),img=off.createImageData(width,height),buf=img.data;
   const O=add(c.eye,[0,0,R]),q=dot(O,O)-R*R;
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const dx=(x*c.w/width-c.cx)/c.focal,dy=(c.cy-y*c.h/height)/c.focal+c.shear*dx;
    const v=add(c.F,add(mul(c.right,dx),mul(c.up,dy))),b=dot(O,v),aa=dot(v,v),delta=b*b-aa*q;
    if(delta<0)continue;const z=(-b-Math.sqrt(delta))/aa;if(z<c.near)continue;
    const pp=add(O,mul(v,z)),la=Math.asin(clamp((pp[1]*Math.cos(lat0)+pp[2]*Math.sin(lat0))/R,-1,1));
    const lo=lon0+Math.atan2(pp[0],pp[2]*Math.cos(lat0)-pp[1]*Math.sin(lat0));
    const sx=(Math.floor((lo/(2*Math.PI)+.5)*512)+1024)%512,sy=clamp(Math.floor((.5-la/Math.PI)*256),0,255),k=(sy*512+sx)*4,l=(y*width+x)*4;
    const n=mul(pp,1/R),nx=dot(n,c.right),ny=dot(n,c.up),nz=-dot(n,c.F),intensity=mix(1,.50+.63*Math.max(0,-.474*nx+.578*ny+.663*nz),smooth((t-.95)/1.45));
    buf[l]=softwareImage[k];buf[l+1]=softwareImage[k+1];buf[l+2]=softwareImage[k+2];
    const lon=lo/deg,lat=la/deg;
    sampleOptical(buf,l,region,opticalRegion,weights.region,.12,lon,lat);
    sampleOptical(buf,l,highlands,opticalHighlands,weights.highlands,.035,lon,lat);
    sampleOptical(buf,l,basin,opticalBasin,weights.basin,.028,lon,lat);
    if(rain)sampleRain(buf,l,rain,weight,lon,lat);
    if(regionalCover)sampleRegionalCover(buf,l,regionalCover,lon,lat,regionalAlpha);
    if(weatherTex){
     const u=((lo/(2*Math.PI)+.5)%1+1)%1,vy=clamp(.5-la/Math.PI,0,1);
     const a=4*(Math.round(vy*(weatherTex.h-1))*weatherTex.w+Math.round(u*(weatherTex.w-1))),raw=weatherTex.pixels;
     const blend=raw[a+3]/255*opacity;
     for(let i=0;i<3;i++)buf[l+i]=mix(buf[l+i],raw[a+i],blend);
    }
    const localLight=images.sunShadow?sunScene.sample(lon,lat):1;
    for(let i=0;i<3;i++)buf[l+i]*=intensity*localLight*solarTint[i];
    buf[l+3]=255;
   }
   off.putImageData(img,0,0);ctx.drawImage(small,0,0,c.w,c.h);
  }
  if(!flags.terrain||weatherMode==='systems'&&t>=.72)return;
  const localRelief=t<1.18||t<1.51&&!mapLayers.terrain&&!images.southeastRelief;
  if(localRelief||mapLayers.terrain&&t<1.3&&images.basin&&images.highlands){softTerrain(c,rain,weight);return}
  // At regional altitude the coarse relief has subpixel height. Use the imagery coastline
  // on the sphere rather than replacing it with jagged flat color from regional triangles.
  if(t>=1.18&&(mapLayers.terrain||images.southeastRelief))return;
  for(let ii=1;ii<=patches.length;ii++){
   if(!patchVisible(ii,t))continue;
   const g=geography(ii),step=ii===3?(t<.13?2:3):3,faces=[],p=patches[ii-1];
   for(let j=0;j<g.h-step;j+=step)for(let i=0;i<g.w-step;i+=step){
    const lon=mix(p.box[0],p.box[2],(i+step/2)/(g.w-1)),lat=mix(p.box[1],p.box[3],(j+step/2)/(g.h-1));
    if((ii<3&&inside(lon,lat,layout[ii].box))||(ii===2&&layout[3]&&inside(lon,lat,layout[3].box)))continue;
    const k=j*g.w+i,idx=[k,k+step,k+step+g.w*step,k+g.w*step],pts=idx.map(v=>c.project(Array.from(g.pos.subarray(v*3,v*3+3))));
    if(pts.some(v=>!v)||pts.every(v=>v[0]<0)||pts.every(v=>v[0]>c.w)||pts.every(v=>v[1]<0)||pts.every(v=>v[1]>c.h))continue;
    const col=Array.from(g.col.subarray(k*3,k*3+3));const layer=synopticAt(lon,lat);if(layer)for(let ch=0;ch<3;ch++)col[ch]=mix(col[ch],layer[ch]/255,layer[3]/255);for(let ch=0;ch<3;ch++)col[ch]*=solarTint[ch];
    faces.push({pts,col,z:pts.reduce((s,q)=>s+q[2],0)});
   }
   faces.sort((a,b)=>b.z-a.z);for(const v of faces){ctx.beginPath();v.pts.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=ctx.strokeStyle='rgb('+v.col.map(a=>Math.trunc(a*255)).join(',')+')';ctx.lineWidth=.6;ctx.fill();ctx.stroke()}
  }
 }
 function paint(points,col,alpha,mode,screen=false,uv=null,key=null){
  if(gpu){gpu.paint(points,col,alpha,mode,screen,uv,key);return}
  if(!soft)return;const ctx=soft;
  if(key==='radar'||key==='satellite'||key?.startsWith('cloud')){softImageMesh(points,uv,key,alpha,col);return}

  const p=screen?points.map(v=>[(v[0]+1)*cam.w/2,(1-v[1])*cam.h/2]):points.map(v=>cam.project(v));
  ctx.fillStyle=ctx.strokeStyle='rgba('+col.map(v=>Math.round(v*255)).join(',')+','+alpha+')';ctx.lineWidth=1.4;
  const inc=mode==='TRIANGLES'?3:2;ctx.beginPath();for(let i=0;i<p.length;i+=inc){
   if(!p[i]||!p[i+1]||(inc===3&&!p[i+2]))continue;ctx.moveTo(p[i][0],p[i][1]);ctx.lineTo(p[i+1][0],p[i+1][1]);if(inc===3){ctx.lineTo(p[i+2][0],p[i+2][1]);ctx.closePath()}}
  if(inc===3)ctx.fill();else ctx.stroke();
 }
 function ndc(x,y,c){return [2*x/c.w-1,1-2*y/c.h,0]}
 function cloudTriangles(v){
  if(v.vertices)return v.vertices;
  const points=[],P=(a,b)=>{
   const dx=v.radius*Math.cos(a)*Math.cos(b),dy=v.radius*.82*Math.sin(a)*Math.cos(b);
   const lo=v.lo+dx/(111.2*Math.cos(v.la*deg)),la=v.la+dy/111.2;
   const terrain=elevation(lo,la)||0;return geo(lo,la,Math.max(terrain/1000+.005,v.z+v.rz*Math.sin(b)));
  };
  for(let j=0;j<6;j++)for(let i=0;i<16;i++){
   const a=i/16*Math.PI*2,an=(i+1)/16*Math.PI*2,b=-Math.PI/2+j*Math.PI/6,bn=b+Math.PI/6;
   const p=P(a,b),q=P(an,b),r=P(an,bn),s=P(a,bn);points.push(p,q,r,p,r,s);
  }
  points.cloudGeometry=true;return v.vertices=points;
 }
 function drawWeather(c){
  // Keep real geographic extents: model cells are never enlarged to cover a continent.
  cloudMarks=[];cloudRenderMode='off';flowDrawn=false;
  if(t>2.28)return;
  const localOpacity=weatherMode==='systems'?1-smooth((t-.60)/.30):1;
  if(flags.cloud&&cloudOpacity>0&&localOpacity>.0001){
   let blobs=weather.filter(v=>(choice==='all'||choice===v.id)&&mapLayers[v.band]&&(cloudBand==='all'||cloudBand===v.band));
   // In a downward-looking basin view a full native profile cell already
   // occupies only a few dozen pixels. Use continuous sampled coverage sooner.
   const planWeight=smooth((-c.F[2]-.30)/.52);
   const provinceMix=smooth((t-mix(.42,.35,planWeight))/mix(.49,.50,planWeight));
   const provinceRange=1-smooth((t-1.42)/.24),wideContext=smooth((t-.27)/.18);
   let provinceDrawn=false;
   if(wideContext>0&&provinceRange>0&&!observer&&choice==='all'&&weatherMode==='terrain'&&window.AtlasProvinceClouds){
    provinceClouds??=AtlasProvinceClouds.create(queue);
    const samples=[],seen=new Set();
    for(const col of [...Object.values(state.columns||{}),...Object.values(state.regionalColumns||{})]){
     if(!col.layers?.length)continue;const grid=String(col.gridId||'').split(',').map(Number);
     const la=grid.length===2?grid[0]:col.lat,lo=grid.length===2?grid[1]:col.lon,key=lo+','+la;
     if(!Number.isFinite(la)||!Number.isFinite(lo)||seen.has(key))continue;seen.add(key);samples.push([lo,la]);
    }
    const readingRain=rainStrength()*smooth((t-.46)/.35);
    const alpha=cloudOpacity/.55*provinceRange*(1-readingRain*.78);
    provinceDrawn=provinceClouds.draw({time:state.time,allow:state.provinceModel!==false,geo,elevation,style:cloudStyle,mask:mapLayers,band:cloudBand,samples,opacity:alpha*provinceMix,outerOpacity:alpha*wideContext*(1-provinceMix),drawTexture:(m,opacity,outer)=>{
     const key='cloudProvince'+m.b+(outer?'Outer':'');images[key]=outer?m.outer:m.image;paint(m.points,solarTint,opacity,'TRIANGLES',false,m.uv,key);
    }});
    if(provinceClouds.report!==provinceReport){provinceReport=provinceClouds.report;describe()}
   }
   const detailRange=choice==='all'?1-smooth((t-1.38)/.32):1;
   const profileOpacity=localOpacity*detailRange*(provinceDrawn&&choice==='all'?1-provinceMix*provinceClouds.weight:1);
   if(profileOpacity<.005)blobs=[];
   const ray=blobs.length>0&&!!gpu&&t<1.6&&gpu.drawClouds({camera:c,raw:blobs,selected:choice,geo,time:state.time,sun:solarVector,style:cloudStyle,opacity:profileOpacity*cloudOpacity/.55,edgeHandoff:provinceDrawn?provinceMix*provinceClouds.weight:0,animated:cloudMotion&&!reduced,speed:cloudSpeed,reduced,moving:!!(drag||dolly||transition||performance.now()-solarChangeAt<420),signature:[weatherGeneration,choice,cloudBand,mapLayers.low,mapLayers.mid,mapLayers.high].join('/')});
   cloudRenderMode=provinceDrawn&&provinceMix>.5?'province':ray?'raymarch':'slices';
   blobs=blobs.map(v=>({v,screen:c.project(geo(v.lo,v.la,v.z))})).filter(x=>x.screen).sort((a,b)=>b.screen[2]-a.screen[2]);
   const cloudLight=window.AtlasCloudLight&&(cloudRenderer??=window.AtlasCloudLight.create());
   const slice=images.cloudAtlas?((points,uv,alpha,tint=[1,1,1])=>paint(points,tint,clamp(profileOpacity*alpha*cloudOpacity/.55,0,1),'TRIANGLES',false,uv,'cloudAtlas')):undefined;
   const custom=ray||cloudLight?.draw({volumes:blobs.map(x=>x.v),camera:c,geo,elevation,project:c.project,selected:choice,time:state.time,solarTime:sunScene?.time??state.time,solarPoint,edgeHandoff:provinceDrawn?provinceMix*provinceClouds.weight:0,scale,renderer:gpu?'webgl':'canvas2d',style:cloudStyle,animated:cloudMotion&&!reduced,motionFactor:cloudSpeed,reducedMotion:reduced,elapsed:performance.now()/1000,verticalScale:c.ve,drawSlice:slice,drawPlan:(image,points,uv,alpha,tint=[1,1,1],slot=0)=>{const key='cloudPlan'+slot;images[key]=image;paint(points,tint,clamp(profileOpacity*alpha*cloudOpacity/.55,0,1),'TRIANGLES',false,uv,key)},paint});
   for(const {v,screen} of blobs){
    const radius=c.focal*v.radius/screen[2];if(radius<.7)continue;
    if(screen[0]+radius<0||screen[0]-radius>c.w||screen[1]+radius<0||screen[1]-radius>c.h)continue;
    cloudMarks.push({id:v.id,x:screen[0],y:screen[1],r:clamp(radius*.45,8,50)});
    if(custom||cloudLight)continue;
    const picked=choice===v.id,alpha=picked?.35:clamp(.06+(v.rh-70)/300+v.cover/650,.05,.23);
    paint(cloudTriangles(v),picked?[1,.85,.53]:[.81,.93,.97],alpha,'TRIANGLES');
   }
  }
  const haveFlow=flowEnabled&&t<.76&&(localFlow??=window.AtlasLocalFlow?.create({elevation}));if(haveFlow)localFlow.update({columns:state.columns,regionalColumns:state.regionalColumns,level:state.level,time:state.time});
  const drewFlow=haveFlow&&localFlow.draw3D({geo,paint,camera:c,enabled:true,animated:flowAnimated&&!reduced,elapsed:performance.now()/1000,variable:flowVariable});
  flowDrawn=!!drewFlow;
  const newWind=drewFlow||windMarkOverlay&&t<.76||flags.wind&&(cloudRenderer??=window.AtlasCloudLight?.create())?.drawWind?.({wind,camera:c,geo,elevation,paint,animated:flags.animate&&!reduced,time:state.time,elapsed:performance.now()/1000,renderer:gpu?'webgl':'canvas2d',scale});
  if(flags.wind&&!newWind){
   const lines=[],heads=[],flow=[];
   for(const v of wind){
    const l=v.l,angle=(l.dir+180)*deg,length=clamp(l.wind*.10,.8,5),base=geo(v.lo,v.la,l.height/1000);
    let chosen=0;
    for(let j=1;j<=12;j++){const f=length*j/12,lo=v.lo+f*Math.sin(angle)/(111.2*Math.cos(v.la*deg)),la=v.la+f*Math.cos(angle)/111.2;if((elevation(lo,la)||0)>=l.height)break;chosen=f}
    if(chosen<.1||l.wind<.3)continue;
    const point=(e,n)=>geo(v.lo+e/(111.2*Math.cos(v.la*deg)),v.la+n/111.2,l.height/1000);
    const e=chosen*Math.sin(angle),n=chosen*Math.cos(angle),tip=point(e,n),s=Math.min(chosen*.42,.65);
    if(flags.animate&&!reduced){
      // 120 seconds of modeled travel per wall-clock second, within the sampled arrow's terrain-safe reach.
      const travelled=(performance.now()/1000*120*l.wind/3600)%chosen;
      const nose=point(e*travelled/chosen,n*travelled/chosen);
      const tail=Math.max(0,travelled-Math.min(.36,chosen*.24))/chosen;
      flow.push(point(e*tail,n*tail),nose);
    }
    lines.push(base,tip);heads.push(tip,point(e-s*Math.sin(angle-.52),n-s*Math.cos(angle-.52)),point(e-s*Math.sin(angle+.52),n-s*Math.cos(angle+.52)));
   }
   paint(lines,[.30,.87,.94],1,'LINES');paint(heads,[.30,.87,.94],1,'TRIANGLES');if(flow.length)paint(flow,[1,.98,.69],1,'LINES');
  }
  if(flags.parcel&&baseLines.length&&t<1.25)paint(baseLines,[1,.76,.38],1,'LINES');
 }
 function drawSightline(c){
  if(!mapLayers.summitHeights||landmark||observer||housePoint)return;
  if(t<.18||t>.72)return;
  const home=geo(98.985,18.79,poseGround/1000+.02),ll=peaks[state.peak].ll,crest=geo(...ll,elevation(...ll)/1000+.025);
  const path=[];for(let k=0;k<33;k++){const a=k/33,b=(k+.58)/33;path.push(lerp(home,crest,a),lerp(home,crest,b))}
  paint(path,[1,.83,.43],.93,'LINES');
 }
 function display(c){
  const pk=peaks[state.peak];placeCrag(c);
  const atHome=t>=.18&&t<.72?c.project(geo(98.985,18.79,poseGround/1000+.02)):null;
  const atHouse=housePoint&&t<1.51&&c.project(geo(housePoint.lon,housePoint.lat,elevation(housePoint.lon,housePoint.lat)/1000+.005));
  houseTag.hidden=!atHouse||atHouse[0]<8||atHouse[0]>c.w-8||atHouse[1]<8||atHouse[1]>c.h-24;
  if(!houseTag.hidden){houseTag.style.left=atHouse[0]+'px';houseTag.style.top=atHouse[1]+'px'}
  homeTag.hidden=!!housePoint||!!observer||!!landmark||!mapLayers.markers||!atHome||atHome[0]<10||atHome[0]>c.w-12||atHome[1]<44||atHome[1]>c.h-36;
  if(!homeTag.hidden){homeTag.textContent='Old City';homeTag.style.left=atHome[0]+'px';homeTag.style.top=atHome[1]+'px'}
  osmCredit.hidden=!landmark||!mapLayers.cragPaths||!mapLayers.terrain||t>1.3;
  credit.hidden=!mapLayers.terrain||t<.14||t>1.3&&(!images.southeastAsia||opticalWeights().region<=.025);
  let pt,label;
  if(t<.8){const site=cragSites.get(landmark),ll=site?[site.lon,site.lat]:pk.ll;pt=c.project(geo(...ll,elevation(...ll)/1000));label=site?site.name:pk.name}
  else{
   const p=geo(98.985,18.79,.32);pt=c.project(p);if(dot(norm(add(p,[0,0,R])),sub(c.eye,p))<0)pt=null;
   label='Chiang Mai';
  }
  const used=[];if(pt)used.push([pt[0]+35,pt[1]-9]);
  for(const v of labels){
   const screen=Math.abs(t-v.at)<.26&&(!v.crag||landmark&&landmark!==v.crag&&!stage.classList.contains('scene-air-crag'))?c.project(v.p):null;
   const ok=mapLayers.labels&&screen&&dot(norm(add(v.p,[0,0,R])),sub(c.eye,v.p))>0&&screen[0]>38&&screen[0]<c.w-38&&screen[1]>63&&screen[1]<c.h-56&&!used.some(([x,y])=>Math.abs(x-screen[0])<72&&Math.abs(y-screen[1])<19);
   v.el.hidden=!ok;if(ok){v.el.style.left=screen[0]+'px';v.el.style.top=screen[1]+'px';used.push(screen)}
  }
  tag.hidden=!!atHouse||(!!landmark&&stage.classList.contains('scene-air-crag'))||(stage.dataset.summitHeights==='true'&&!landmark&&t<.72)||(landmark==='crag'&&!cragPin.hidden&&t<.8)||!mapLayers.markers||!pt||pt[0]<0||pt[0]>c.w||pt[1]<0||pt[1]>c.h;
  if(!tag.hidden){tag.textContent=label;tag.style.left=clamp(pt[0],0,c.w-95)+'px';tag.style.top=clamp(pt[1],49,c.h-16)+'px'}
  ruler.textContent=housePoint&&t<.71?(observer?'My house · observer height':'My house · true terrain height'):observer?.mode==='solar'&&scale==='province'?'Province · horizon view':observer?(landmark?'Crazy Horse':'Old City')+' · observer height':t<.8?(landmark?cragSites.get(landmark).name+' · true height':'Basin relief · '+c.ve.toFixed(1)+'× height'):t<1.55?'Chiang Mai Province':t<2.55?'Mainland Southeast Asia':'Earth · '+(reduced?'reduced motion':flags.spin?'rotating':'rotation paused');
 }
 let solarTint=[1,1,1],solarVector=null,solarPoint=null;
 function draw(now){
  raf=0;if(disposed||!visible)return;
  const followScale=dolly||transition?.followScale;
  if(dollyCarry&&now>=dollyCarry.start+dollyCarry.duration)dollyCarry=null;
  if(dolly){
   const dt=clamp(now-(last||now-16),2,64);t=reduced?target:mix(t,target,1-Math.exp(-dt/76));
   if(Math.abs(t-target)<.0004){t=target;dolly=false}
  }
  if(transition){const f=transition.duration?clamp((now-transition.start)/transition.duration,0,1):1;t=mix(transition.from,target,smooth(f));if(f===1){t=target;transition=null}}
  if(followScale){
   const id=t<.71?'window':t<1.51?'province':t<2.51?'region':'global';if(id!==scale)notifyScale(id);
  }
  if(t!==reportedPosition||target!==reportedTarget){
   reportedPosition=t;reportedTarget=target;options.onZoomChange?.(t,target);
  }
  if(scale==='global'&&!transition&&flags.spin&&!drag&&!reduced&&last)spin+=Math.min(64,now-last)*.0015;last=now;
  const w=cv.clientWidth,h=cv.clientHeight;if(!w||!h)return;const dpr=Math.min(1.75,devicePixelRatio||1);
  if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr)}
  if(flags.cloud&&weather.length&&window.AtlasCloudLight&&t<2.3)ensureImage('cloudAtlas');if(t<1.25)ensureImage('basin');if(t>.28&&t<2.92)ensureImage(regionalBaseTextureKey());if(t>.14&&t<2.15)ensureImage('highlands');if(t>.12||!flags.terrain)ensureImage('earth');
  const sunTime=sunScene?.time??state.time;
  solarPoint=observer?.point||housePoint||cragSites.get(landmark)||undefined;
  const light=sunScene?.lighting(sunTime,solarPoint),lightWeight=1-smooth((t-1.34)/.44);
  solarTint=light?light.tint.map(v=>mix(1,v,lightWeight)):[1,1,1];
  // Keep continuous disk/terrain motion. During a scrub, reuse cloud light between nearby solar angles.
  const cloudLightingTime=performance.now()-solarChangeAt<420?Math.round(sunTime/240)*240:sunTime;
  solarVector=finite(cloudLightingTime)?window.AtlasSun?.position(cloudLightingTime,solarPoint)?.vec||[0,0,1]:[0,0,1];
  images.sunShadow=t<1.58?sunScene?.shadow(sunTime,solarPoint,scale==='province')?.canvas:null;
  cam=camera(w,h);
  images.solarSky=t<1.64?sunScene?.sky(cam,sunTime,observer?.point):null;if(cragDetail?.image&&t<1.3){const pt=cam.project(cragWorld);if(landmark||pt&&pt[0]>-w*.4&&pt[0]<w*1.4&&pt[1]>-h*.4&&pt[1]<h*1.4)ensureImage('cragOpt')}cragSurface();prepareRegionalCover();startRenderer();
  if(gpu){
   gpu.begin(cam,dpr);drawTerrainMeshes(gpu.land);
  }else if(soft){
   const key=[cv.width,cv.height,t,heading,tilt,zoom,spin,state.peak,panRevision,t<2.16&&flags.terrain,!!images.earth,!!images.basin,!!images.highlands,!!images.southeastAsia,!!images.southeastRelief,!!images.cragOpt,globeCloudVisible(),frameState.planet.origin,frameState.planet.status,sunTime,weatherMode,systemVersion,rainStrength()].join('/');
   soft.setTransform(dpr,0,0,dpr,0,0);
   if(softSurface&&softKey===key)soft.drawImage(softSurface,0,0,w,h);
   else{
    softLand(cam);softSurface??=document.createElement('canvas');
    if(softSurface.width!==cv.width||softSurface.height!==cv.height){softSurface.width=cv.width;softSurface.height=cv.height}
    softSurface.getContext('2d').drawImage(cv,0,0);softKey=key;
   }
  }
  if(mapLayers.borders&&t>.65&&t<2&&boundary.length)paint(boundary,[.96,.83,.58],.58*smooth((t-.65)/.18)*(1-smooth((t-1.50)/.50)),'LINES');
  sunScene?.draw(cam,t,sunTime,!!observer,observer?.point);drawImagery(cam);countryOutlines(cam);drawFeature(cam);drawSystems(cam);positionFeature(cam);drawSightline(cam);drawWeather(cam);drawPlanetWind(cam);display(cam);
  if(overlays.size){const ctx={camera:cam,geo,elevation,paint,stage,isTerrainVisible,terrainDepthRevision:gpu?'webgl/'+flags.terrain+'/'+mapLayers.terrain+'/'+!!images.southeastRelief:softDepth?.revision??'sphere',rainAnimated:cloudMotion&&!reduced,wind,windEnabled:flags.wind,windAnimated:flags.animate&&!reduced,flowDrawn,weatherMode,time:sunTime,scale,position:t,requestDraw:queue,housePoint,landmark,peak:state.peak,labels:mapLayers.labels,mapLayers,ridgeMarks:mapLayers,state,observer:observer?.point||null,projectDirection:cam.direction};for(const layer of overlays)layer(ctx)}
  if(dolly||dollyCarry||transition||cloudRenderMode==='raymarch'&&gpu?.cloudTransition||cloudRenderer?.isTransitioning())queue();
  else if(!drag){
   const software=!gpu||gpu.cloudStats?.software,delays=[];
   if(!reduced&&scale==='global'&&flags.spin)delays.push(software?150:60);
   if(!reduced&&(t<=2.28&&flags.animate&&flags.wind&&wind.length||t<.90&&flowEnabled&&flowAnimated&&localFlow?.available?.()))delays.push(software?300:65);
   if(!reduced&&cloudRenderMode!=='off'&&cloudMotion&&cloudOpacity>0&&weather.some(v=>v.wind>0&&mapLayers[v.band])&&
      (cloudRenderMode!=='raymarch'||gpu.cloudCount>0)){
    delays.push(cloudSpeed===1?(software?2400:1250):cloudSpeed===30?(software?650:250):(software?360:110));
   }
   if(cloudRenderMode==='raymarch'&&performance.now()-solarChangeAt<420)delays.push(435);
   if(delays.length)wakeAfter(Math.min(...delays));
  }
 }
 function reset(){if(housePoint){focusHousePoint(housePoint);return}heading=0;tilt=0;spin=0;zoom=1;setScale(scale)}
 function adjustZoom(k){zoomBy(k)}

 q('[data-cmd=in]').onclick=()=>zoomBy(1.65);q('[data-cmd=out]').onclick=()=>zoomBy(1/1.65);
 q('[data-cmd=reset]').onclick=reset;
 function bind(){
   cv.onkeydown=e=>{let done=true;switch(e.key){case 'ArrowLeft':case 'ArrowRight':case 'ArrowUp':case 'ArrowDown':
    if(scale==='window'&&!orbit)orbitLocal();if(e.key==='ArrowLeft')heading-=8;if(e.key==='ArrowRight')heading+=8;if(e.key==='ArrowUp')tilt=clamp(tilt+5,-22,44);if(e.key==='ArrowDown')tilt=clamp(tilt-5,-22,44);queue();break;
    case '+':case '=':adjustZoom(1.25);break;case '-':adjustZoom(.8);break;case 'Home':reset();break;default:done=false}
    if(done)e.preventDefault()};
   const distance=()=>{const [a,b]=[...touches.values()];return Math.hypot(a[0]-b[0],a[1]-b[1])};
   let span=0;
   cv.onpointerdown=e=>{touches.set(e.pointerId,[e.clientX,e.clientY]);cv.setPointerCapture(e.pointerId);
    if(touches.size===2){span=distance();pinching=true;drag=null;return}
    const rect=cv.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,h:heading,p:tilt,moved:false,orbit:gesture==='orbit'||e.shiftKey||e.button===2,cam,rotation:panRotation,rect};
    if(observer?.mode==='solar')drag.solarStart={...observer.point};
    if(cam)drag.anchor=grabPoint(cam,e.clientX-rect.left,e.clientY-rect.top)};
   cv.onpointermove=e=>{if(!touches.has(e.pointerId))return;touches.set(e.pointerId,[e.clientX,e.clientY]);
    if(touches.size>=2){const s=distance();if(span>4&&s>4)zoomBy(s/span);span=s;return}
    if(!drag||pinching)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!drag.moved&&Math.hypot(dx,dy)<4)return;if(!drag.moved&&photoMode)orbitLocal();
    drag.moved=true;if(!drag.orbit&&observer?.mode==='solar'&&drag.solarStart){
     const km=(scale==='province'?12:3)/Math.max(120,drag.rect.width)/zoom,a=(observer.az+heading)*deg;
     const east=(-dx*Math.cos(a)+dy*Math.sin(a))*km,north=(dx*Math.sin(a)+dy*Math.cos(a))*km;
     observer.point={lon:drag.solarStart.lon+east/(111.2*Math.cos(drag.solarStart.lat*deg)),lat:drag.solarStart.lat+north/111.2};
     panRevision++;
    }else if(drag.orbit||observer){heading=drag.h-dx*.25;tilt=clamp(drag.p+dy*.16,-14,64)}
    else if(drag.anchor){const p=grabPoint(drag.cam,e.clientX-drag.rect.left,e.clientY-drag.rect.top),v=[1+dot(p,drag.anchor),...cross(p,drag.anchor)];
     panRotation=norm(quaternionProduct(norm(v),drag.rotation));panRevision++}queue()};
   const finish=e=>{touches.delete(e.pointerId);
    if(!pinching&&drag&&!drag.moved&&flags.cloud&&cloudMarks.length){const r=cv.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
     const hit=cloudMarks.map(v=>({...v,d:Math.hypot(v.x-x,v.y-y)})).filter(v=>v.d<v.r).sort((a,b)=>a.d-b.d)[0];if(hit){choice=hit.id;select.value=choice;describe();queue()}}
    drag=null;if(!touches.size){pinching=false;span=0}queue()};
   cv.oncontextmenu=e=>e.preventDefault();cv.onpointerup=finish;cv.onpointercancel=finish;
   cv.ondblclick=e=>{e.preventDefault();zoomBy(e.shiftKey?1/2:2)};
   cv.addEventListener('wheel',e=>{e.preventDefault();const px=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?cv.clientHeight:1);
    zoomBy(Math.exp(-clamp(px,-380,380)*(e.ctrlKey?.009:.0027)))},{passive:false});
   cv.addEventListener('webglcontextlost',e=>{e.preventDefault();gpu=null;const next=cv.cloneNode();cv.replaceWith(next);cv=next;soft=getSoft();bind();queue()},{once:true});
 }
 bind();const ro=new ResizeObserver(queue);ro.observe(stage);
 const io=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;syncVisibility()});io.observe(stage);document.addEventListener('visibilitychange',syncVisibility);
 scaleControls();collect();queue();
 return {update,focusHousePoint,clearHousePoint,terrainElevation:elevation,setRainSurface,setWindMarkOverlay(value){windMarkOverlay=!!value;queue()},addOverlay,keepSunInView,leaveSolarHorizon,focusSolarHorizon,focusProvincePoint,faceWindow,faceSunset,faceBearing,setSkyPath(value){sunScene?.setTrack(value);queue()},setHiddenPatches,setCloudOpacity,setCloudStyle,setCloudMotion,setFlowLayer,setSolarLayers,recenter:reset,setGesture,setMapLayers,setLandmark,retrySystems,setWeatherMode,setSystemLayer,setSystemFeature,setCloudBand,setScale,setPeak,zoomBy,setZoomPosition,focusRidge,destroy(){disposed=true;document.removeEventListener('visibilitychange',syncVisibility);if(idleTimer)clearTimeout(idleTimer);systemRecord.abort?.abort();if(raf)cancelAnimationFrame(raf);ro.disconnect();io.disconnect();Object.values(frameState).forEach(v=>{v.abort?.abort();v.bitmap?.close?.()});gpu?.destroy();cloudRenderer?.destroy();root.remove()},
   getView(){return {housePoint:housePoint&&{...housePoint},localRainSurface:rainStrength()>0,regionalAtmosphere:regionInformation(),provinceCloudTime:provinceClouds?.valid??null,provinceCloudBands:provinceClouds?.bands??[],provinceCloudReport:provinceReport,provincePoint:provincePoint?.slice()||null,solarHorizon:observer?.mode==='solar',solarSite:observer?.point??null,observerMode:observer?.mode==='solar'?null:observer?.mode??null,scale,cloudRenderMode,cloudStats:gpu?.cloudStats??null,cloudGPU:cloudRenderMode==='raymarch'?gpu?.cloudCount:null,cragDetail:!!cragDetail,cragImage:!!images.cragOpt,cloudStyle,cloudMotion,flowEnabled,flowAnimated,flowVariable,cloudOpacity,featureCells:systemFeature?.mesh?.points.length||0,featureEdges:systemFeature?.mesh?.edges.length||0,panRotation:[...panRotation],gesture,landmark,mapLayers:{...mapLayers,wind:flags.wind,cloud:flags.cloud},weatherMode,cloudBand,systemLayer,systemStatus:systemRecord.status,position:t,target,photoMode,renderer:!rendererStarted?'pending':gpu?'webgl':'canvas2d',cloudVolumes:weather.length,windSamples:wind.length,selectedVolume:choice,imagery:Object.fromEntries(Object.entries(frameState).map(([k,v])=>[k,v.status]))}}};
}
return {mount,regionalRainStops};
})();
