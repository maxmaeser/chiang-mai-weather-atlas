/* ICON precipitation accumulated over the selected hour. Airborne structure is illustrative. */
window.AtlasRainMarks=(()=>{
  'use strict';
  const minimum=.05,missing=65535;
  const stops=[
    {mm:.05,rgb:[116,214,214],a:.016,label:'0.05'},
    {mm:.5,rgb:[67,195,222],a:.29,label:'0.5'},
    {mm:2,rgb:[65,146,227],a:.46,label:'2'},
    {mm:5,rgb:[120,123,225],a:.59,label:'5'},
    {mm:15,rgb:[220,155,215],a:.70,label:'15+'}
  ];
  const finite=Number.isFinite,clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),mix=(a,b,t)=>a+(b-a)*t;
  const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
  const elem=(tag,cls='')=>Object.assign(document.createElement(tag),{className:cls});
  const timeFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const dateFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',day:'numeric',month:'short'});
  const number=new Intl.NumberFormat('en-GB',{maximumFractionDigits:2});
  const period=t=>dateFormat.format(t*1000)+' · '+timeFormat.format((t-3600)*1000)+'–'+timeFormat.format(t*1000)+' ICT';
  const css=`
    .rain-layer{position:absolute;inset:0;overflow:hidden;z-index:1;pointer-events:none}
    .rain-layer [hidden],.rain-key[hidden],.rain-key [hidden]{display:none!important}
    .rain-layer canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
    .rain-key{position:absolute;right:10px;top:106px;max-width:calc(100% - 20px);padding:7px 9px;background:#102431ed;border:1px solid #839fa89c;border-radius:5px;color:#eff8fb;font:600 11px/1.25 system-ui;pointer-events:none}
    .rain-key strong,.rain-key span{display:block}
    .rain-key span{font-weight:500;color:#cddde4;margin-top:3px}
    .rain-find{pointer-events:auto;cursor:pointer;touch-action:manipulation;color:#e1f9ff;background:#253d50;border:1px solid #628ca4;border-radius:4px;min-height:34px;margin-top:5px;padding:3px 8px;font:inherit}
    .rain-ramp{display:flex;justify-content:space-between;max-width:155px;margin-top:5px;padding-top:4px;background:linear-gradient(to right,#74d6d6,#43c3de,#4192e3,#787be1,#dc9bd7) top/100% 2px no-repeat}
    .rain-ramp b{font:500 10px/1 system-ui}
    #scene-bench .rain-key{position:static;display:flex;align-items:center;flex-wrap:wrap;gap:2px 8px;max-width:none;box-sizing:border-box;width:100%;padding:5px 2px;border:0;border-top:1px solid #475b50;border-radius:0;background:transparent;font-size:10px}
    #scene-bench .rain-key span{margin:0}
    #scene-bench .rain-ramp{width:108px;margin:2px 0}
    #scene-bench .rain-find{min-height:32px;padding:2px 6px;color:#b8edf1;text-decoration:underline}
  `;
  function hash(x,y,s=0){
    let h=Math.imul(x,1597334677)^Math.imul(y,3812015801)^Math.imul(s+1,2246822507);
    h=Math.imul(h^(h>>>15),3266489917);
    return ((h^(h>>>16))>>>0)/4294967296;
  }
  function axisIndex(axis,value){
    if(value<axis[0]||value>axis.at(-1))return -1;
    let i=0;while(i+2<axis.length&&axis[i+1]<value)i++;
    return i;
  }
  function rainAt(c,u,v){return mix(mix(c.a,c.b,u),mix(c.d,c.e,u),v)}
  function atPosition(field,lon,lat){
    const i=axisIndex(field.lons,lon),j=axisIndex(field.lats,lat);
    if(i<0||j<0)return null;
    const c=field.cells[j*field.stride+i];
    return c?rainAt(c,(lon-c.w)/(c.east-c.w),(lat-c.s)/(c.north-c.s)):null;
  }
  function paintSurface(field){
    if(field.max<minimum)return null;
    const out=elem('canvas'),w=out.width=field.stride*20+1,h=out.height=(field.lats.length-1)*20+1;
    const ink=out.getContext('2d'),im=ink.createImageData(w,h),p=im.data;
    const [west,south,east,north]=field.bounds;
    for(let y=0;y<h;y++){
      const lat=mix(north,south,(y+.5)/h),j=axisIndex(field.lats,lat);
      for(let x=0;x<w;x++){
        const lon=mix(west,east,(x+.5)/w),i=axisIndex(field.lons,lon),c=field.cells[j*field.stride+i];
        if(!c)continue;
        const mm=rainAt(c,(lon-c.w)/(c.east-c.w),(lat-c.s)/(c.north-c.s));
        if(mm<minimum)continue;
        let k=0;while(k<stops.length-2&&mm>stops[k+1].mm)k++;
        const lo=stops[k],hi=stops[k+1],f=clamp(Math.log(mm/lo.mm)/Math.log(hi.mm/lo.mm),0,1),o=(y*w+x)*4;
        for(let ch=0;ch<3;ch++)p[o+ch]=mix(lo.rgb[ch],hi.rgb[ch],f);
        p[o+3]=255*mix(lo.a,hi.a,f);
      }
    }
    ink.putImageData(im,0,0);return out;
  }
  function hourField(packet,time,ctx){
    const data=packet?.fields?.precipitation;
    if(!data||!finite(time))return null;
    const {lons,lats}=packet,nx=lons.length,ny=lats.length,step=nx*ny,hour=(time-packet.start)/3600;
    if(nx<2||ny<2||!Number.isInteger(hour)||hour<0||(hour+1)*step>data.length)return null;
    const field={lons,lats,stride:nx-1,bounds:[lons[0],lats[0],lons.at(-1),lats.at(-1)],cells:[],max:-1};
    function vertex(i,j){
      const z=ctx.elevation(lons[i],lats[j]);
      return ctx.geo(lons[i],lats[j],(finite(z)?z:0)/1000);
    }
    const verts=Array.from({length:step},(_,ix)=>vertex(ix%nx,Math.floor(ix/nx)));
    for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
      const ix=j*nx+i,ids=[ix,ix+1,ix+nx,ix+nx+1],raw=ids.map(k=>data[hour*step+k]);
      if(raw.some(v=>!finite(v)||v===missing)){field.cells.push(null);continue}
      const [a,b,d,e]=raw.map(v=>v/100);
      const c={i,j,w:lons[i],s:lats[j],east:lons[i+1],north:lats[j+1],a,b,d,e,peak:Math.max(a,b,d,e),verts:ids.map(k=>verts[k])};
      field.max=Math.max(field.max,c.peak);field.cells.push(c);
      if(c.peak>=minimum)c.banks=seeds(c,3,0,ctx);
    }
    if(field.max<0)return null;
    field.image=paintSurface(field);return field;
  }
  // Positions and widths live in geographic space. A small texture supplies the unresolved
  // filaments inside each volume. Its descending fluctuations never translate the footprint.
  function shaft(lon,lat,mm,width,height,id,detail,ctx){
    const z=ctx.elevation(lon,lat);
    if(!finite(z)||mm<minimum)return null;
    const floor=(z+1)/1000;
    return {lon,lat,floor,mm,width,height,id,detail,
      foot:ctx.geo(lon,lat,floor),head:ctx.geo(lon,lat,floor+height)};
  }
  function seeds(c,steps,detail,ctx){
    const list=[];
    for(let y=0;y<steps;y++)for(let x=0;x<steps;x++){
      const i=c.i*steps+x,j=c.j*steps+y;
      const u=(x+.12+.76*hash(i,j,1))/steps,v=(y+.12+.76*hash(i,j,2))/steps;
      const mm=rainAt(c,u,v);
      if(mm<minimum)continue;
      const width=detail?1.4+2.2*hash(i,j,5):6.4+5.6*hash(i,j,5);
      const height=(detail?.72:1.18)+hash(i,j,6)*.85+smooth(.08,4,mm)*.8;
      const p=shaft(mix(c.w,c.east,u),mix(c.s,c.north,v),mm,width,height,hash(i,j,7),detail,ctx);
      if(p)list.push(p);
    }
    return list;
  }
  function nearbyDrops(field,ctx){
    const site=ctx.observer,cam=ctx.camera;
    if(!site)return [];
    const mm=atPosition(field,site.lon,site.lat);
    if(!(mm>=minimum))return [];
    const key=site.lon+'/'+site.lat;
    if(field.lookout?.key!==key){
      // Narrow drop tracks in the first 30 m have independent physical positions,
      // heights, phases and downward speeds. They share the accumulation of their cell.
      const spacing=.0014,lonStep=spacing/(111.2*Math.cos(site.lat*Math.PI/180)),latStep=spacing/111.2;
      const ix=Math.floor(site.lon/lonStep),iy=Math.floor(site.lat/latStep),tracks=[];
      const density=.07+.39*Math.min(1,Math.log1p(mm)/Math.log(5));
      for(let y=iy-21;y<=iy+21;y++)for(let x=ix-21;x<=ix+21;x++){
        if(hash(x,y,1)>density)continue;
        const lon=(x+hash(x,y,2))*lonStep,lat=(y+hash(x,y,3))*latStep;
        if(!(atPosition(field,lon,lat)>=minimum))continue;
        const z=ctx.elevation(lon,lat);
        if(!finite(z))continue;
        const height=.008+.008*hash(x,y,4),base=z/1000+.0001;
        const foot=ctx.geo(lon,lat,base),head=ctx.geo(lon,lat,base+height);
        tracks.push({foot,head,height,phase:hash(x,y,5),speed:.002+.0024*hash(x,y,6),length:.000057+.000090*hash(x,y,7),light:hash(x,y,8)});
      }
      field.lookout={key,tracks};
    }
    const drops=[];
    for(const d of field.lookout.tracks){
      const a=cam.project(d.head),b=cam.project(d.foot);
      if(!a||!b||Math.min(a[0],b[0])>cam.w||Math.max(a[0],b[0])<0||Math.min(a[1],b[1])>cam.h||Math.max(a[1],b[1])<0)continue;
      function visible(f){
        const pos=d.head.map((v,i)=>mix(v,d.foot[i],f)),pt=cam.project(pos);
        if(!pt||pt[0]<0||pt[0]>=cam.w)return false;
        if(pt[1]<0)return true;
        if(pt[1]>=cam.h)return false;
        return ctx.isTerrainVisible(pos,pt);
      }
      let limit=1;
      if(!visible(1)){
        if(!visible(0))continue;
        let lo=0,hi=1;
        for(let i=0;i<8;i++){const mid=(lo+hi)/2;if(visible(mid))lo=mid;else hi=mid}
        limit=lo;
      }
      if(limit>.015)drops.push({...d,a,b,limit});
    }
    return drops;
  }
  function paintDrops(ink,drops,t){
    ink.lineCap='round';
    for(const d of drops){
      const f=(d.phase+t*.001*d.speed/d.height)%1;
      if(f>d.limit)continue;
      const end=Math.min(d.limit,f+d.length/d.height);
      // Perspective-correct interpolation between the ends of a 3D fall trajectory.
      const k=f*d.b[2]/mix(d.a[2],d.b[2],f),l=end*d.b[2]/mix(d.a[2],d.b[2],end);
      const dx=d.b[0]-d.a[0],dy=d.b[1]-d.a[1],z=mix(d.a[2],d.b[2],f);
      ink.globalAlpha=(.22+.27*d.light)*smooth(0,.035,f)*(1-smooth(d.limit-.05,d.limit,f))*(1-smooth(.014,.037,z));
      ink.strokeStyle=d.light>.32?'rgb(213,223,224)':'rgb(109,124,130)';
      ink.lineWidth=clamp(.63+.004/z,.65,1.32);
      ink.beginPath();ink.moveTo(d.a[0]+dx*k,d.a[1]+dy*k);ink.lineTo(d.a[0]+dx*l,d.a[1]+dy*l);ink.stroke();
    }
  }
  const spriteW=58,spriteH=88,phases=32,variants=4;
  function curtainTextures(){
    // One filmstrip for all shafts. The envelope is fixed while fine density ripples
    // descend through it; both ends feather out, including in a still frame.
    const out=elem('canvas');out.width=spriteW*phases;out.height=spriteH*variants;
    const ink=out.getContext('2d'),im=ink.createImageData(out.width,out.height),px=im.data,tau=2*Math.PI;
    const wave=t=>.5+.5*Math.sin(t);
    for(let v=0;v<variants;v++)for(let y=0;y<spriteH;y++)for(let x=0;x<spriteW;x++){
      const u=(x+.5)/spriteW,z=(y+.5)/spriteH;
      const s=u+(z-.52)*(.032+.025*v)+.021*Math.sin(z*4+u*4+v);
      const wisps=(.65+.35*wave(s*21+v*3.4+Math.sin(s*11)*1.8))*(.86+.14*wave(s*65+v*7+Math.sin(s*13)*2.2));
      const crown=.04+.09*wave(u*9+v),toe=.68+.19*wave(u*14+v*1.2);
      const envelope=Math.pow(Math.max(0,Math.sin(Math.PI*u)),1.65)*smooth(0,crown+.17,z)*(1-smooth(toe,1,z));
      const g=wave(s*19+v*2),tint=.55*wisps+.30*z+.15*g;
      const r=94+67*tint,b=113+64*tint,green=103+67*tint;
      for(let p=0;p<phases;p++){
        const phase=p/phases*tau;
        const flow=wave(z*10.2+s*6+v-phase+.8*Math.sin(s*21+v));
        const strands=wave(z*14+s*29+v*1.7-2*phase);
        const a=envelope*(.23+.77*wisps)*(.59+.29*flow+.12*strands);
        const o=4*((v*spriteH+y)*out.width+p*spriteW+x);
        px[o]=r;px[o+1]=green;px[o+2]=b;px[o+3]=255*a;
      }
    }
    ink.putImageData(im,0,0);return out;
  }
  function inFrame(p,c){
    return p&&p[0]>=0&&p[0]<=c.w&&p[1]>=0&&p[1]<=c.h;
  }
  function viewReading(field,ctx){
    const cam=ctx.camera,site=ctx.observer||ctx.housePoint;
    if(site){const value=atPosition(field,site.lon,site.lat);return {peak:value,where:ctx.housePoint?'at pin (interpolated grid)':'at lookout (grid)'}}
    let peak=null;
    // Clip the ground grid against the view frustum before interpolating visible maxima.
    // This also covers a camera looking at a small part of a single large model cell.
    function clip(poly,dist){
      const result=[];let a=poly.at(-1),da=dist(a);
      for(const b of poly){const db=dist(b);if((da<0)!==(db<0))result.push(a.map((v,k)=>mix(v,b[k],da/(da-db))));if(db>=0)result.push(b);a=b;da=db}
      return result;
    }
    const planes=[p=>p[2]-cam.near,p=>p[0],p=>cam.w*p[2]-p[0],p=>p[1],p=>cam.h*p[2]-p[1]];
    for(const c of field.cells){
      if(!c)continue;
      const v=c.verts.map((pos,i)=>{
        const q=cam.stretch(pos).map((n,k)=>n-cam.eye[k]),dot=b=>q[0]*b[0]+q[1]*b[1]+q[2]*b[2],depth=dot(cam.F),x=dot(cam.right)*cam.focal;
        return [cam.cx*depth+x,cam.cy*depth-cam.focal*dot(cam.up)+cam.shear*x,depth,i%2,i>>1];
      });
      let poly=[v[0],v[1],v[3],v[2]];
      for(const plane of planes){if(!poly.length)break;poly=clip(poly,plane)}
      for(const p of poly)peak=Math.max(peak??0,rainAt(c,clamp(p[3],0,1),clamp(p[4],0,1)));
    }
    return {peak,where:'in view'};
  }
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  function projectAir(field,ctx){
    const c=ctx.camera,position=ctx.position??(ctx.scale==='province'?1:.36);
    const overview=smooth(.66,.98,position),candidates=[];
    function add(p){
      const b=c.project(p.foot),a=c.project(p.head);
      if(!a||!b)return;
      const z=.5*(b[2]+a[2]),width=p.width*c.focal/z,length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(length<1.55||width<2||width>c.w*2.8||Math.max(a[0],b[0])+width/2<0||
        Math.min(a[0],b[0])-width/2>c.w||Math.max(a[1],b[1])+width*.05<0||Math.min(a[1],b[1])-width*.05>c.h)return;
      let strength=.16+.55*Math.min(1,Math.log1p(3*p.mm)/Math.log(13));
      if(p.detail===1)strength*=.63*(1-smooth(17,38,z));
      else strength*=mix(.68,.29,overview)*mix(1-smooth(50,135,z),1,overview);
      // At eye level, reserve the first metres for actual thin falling tracks.
      // Distant overlapping veils have low optical density at the skyline.
      if(ctx.observer)strength*=.57*smooth(2.2,6,z)*(1-smooth(c.w*.36,c.w*.94,width));
      if(strength<.016)return;
      candidates.push({p,a,b,z,width,length,strength});
    }
    for(const cell of field.cells){
      if(!cell?.banks)continue;
      for(const p of cell.banks)add(p);
      if(overview<.55&&distance(cell.verts[0],c.eye)<64){
        cell.inner??=seeds(cell,10,1,ctx);
        for(const p of cell.inner)add(p);
      }
    }
    // Limit overlap and expensive ridge queries in widespread rain. Keep the selected
    // volumes stable for a fixed camera; their geographic seeds do not depend on time.
    candidates.sort((a,b)=>b.strength-a.strength||a.p.id-b.p.id);
    const result=[];
    for(const item of candidates.slice(0,ctx.observer?42:overview>.8?140:92)){
      const {p,a,b,width,length}=item;
      const columns=clamp(Math.ceil(width/22),2,10),edges=[];
      let any=false,cut=false;
      // Each probe column has its own world position and ground elevation. A ridge
      // clips the lower part of a broad curtain, even with its centre above the ridge.
      for(let i=0;i<=columns;i++){
        const offset=(i/columns-.5)*p.width;
        const lon=p.lon+offset*c.right[0]/(111.2*Math.cos(p.lat*Math.PI/180)),lat=p.lat+offset*c.right[1]/111.2;
        const ground=ctx.elevation(lon,lat);
        if(!(atPosition(field,lon,lat)>=minimum)||!finite(ground)){edges.push(0);cut=true;continue}
        const lo=clamp((ground/1000-p.floor)/p.height,0,1);
        function visible(h){
          const at=ctx.geo(lon,lat,p.floor+p.height*h),pt=c.project(at);
          if(!pt)return false;
          // A shaft reaching past the viewport still crosses the near landscape.
          if(!inFrame(pt,c))return pt[1]<0||pt[0]<0||pt[0]>c.w;
          return ctx.isTerrainVisible?.(at,pt)??false;
        }
        let start=lo;
        if(!visible(start)){
          if(!visible(1)){edges.push(0);cut=true;continue}
          let low=start,high=1;
          for(let j=0;j<6;j++){const mid=(low+high)*.5;if(visible(mid))high=mid;else low=mid}
          start=high;
        }
        const depth=1-start;edges.push(depth);cut||=depth<.995;any||=depth>.025;
      }
      if(!any)continue;
      const dx=(b[0]-a[0])/length,dy=(b[1]-a[1])/length;
      const path=cut?new Path2D():null;
      if(path){
        path.moveTo(0,0);path.lineTo(1,0);
        for(let i=columns;i>=0;i--)path.lineTo(i/columns,edges[i]);
        path.closePath();
      }
      result.push({...item,path,dx,dy});
    }
    return result.sort((a,b)=>b.z-a.z);
  }
  function mount(world,{onFind}={}){
    let stage,layer,canvas,ink,legend,title,summary,ramp,findRain,io,ctx=null;
    let packet=null,pending=null,attemptedAt=0,loadedAt=0,cache=new Map(),field=null,target=null,surface=null;
    let disposed=false,viewKey='',targetKey='',siteAmount=null,air=[],drops=[],reading=null,clock=0,frame=0,delay=0,intersecting=true,atlas=null,dpr=1;
    const motion=matchMedia('(prefers-reduced-motion: reduce)'),narrow=matchMedia('(max-width:760px)');
    function setSurface(next){
      const im=next?.image??null;
      if(im===surface)return;
      surface=im;world.setRainSurface(im,im?next.bounds:null);
    }
    function stop(){cancelAnimationFrame(frame);clearTimeout(delay);frame=delay=0}
    function active(){return ctx&&!disposed&&!layer.hidden&&!document.hidden&&intersecting}
    function moving(){return ctx?.rainAnimated!==false&&!motion.matches}
    function schedule(){
      if(!frame&&!delay&&active()&&(air.length||drops.length)&&moving()){
        delay=setTimeout(()=>{delay=0;frame=requestAnimationFrame(t=>{frame=0;if(active())paint(t)})},drops.length?26:74);
      }
    }
    function paint(t){
      if(!ctx||!ink)return;
      if(!moving())clock=0;else clock=t;
      const {w,h}=ctx.camera;
      ink.setTransform(dpr,0,0,dpr,0,0);ink.clearRect(0,0,w,h);
      if(air.length)atlas??=curtainTextures();
      for(const {p,a,width,length,strength,path,dx,dy} of air){
        const variant=Math.min(variants-1,Math.floor(p.id*variants)),phase=(p.id+clock*.00017)%1;
        ink.setTransform(dpr*width*dy,-dpr*width*dx,dpr*length*dx,dpr*length*dy,dpr*(a[0]-dy*width*.5),dpr*(a[1]+dx*width*.5));
        ink.globalAlpha=strength;
        if(path){ink.save();ink.clip(path)}
        ink.drawImage(atlas,Math.floor(phase*phases)*spriteW,variant*spriteH,spriteW,spriteH,0,0,1,1);
        if(path)ink.restore();
      }
      ink.setTransform(dpr,0,0,dpr,0,0);paintDrops(ink,drops,clock);ink.globalAlpha=1;schedule();
    }
    function wake(){stop();if(active())paint(performance.now())}
    function placeLegend(){
      if(!legend)return;
      const shelf=narrow.matches&&stage.closest('.stage-frame')?.querySelector('#scene-bench .scene-tools-row');
      const parent=shelf||layer;if(legend.parentNode!==parent)parent.append(legend);
    }
    function prepare(host){
      if(host===stage)return;
      stop();io?.disconnect();legend?.remove();layer?.remove();viewKey='';
      stage=host;layer=elem('div','rain-layer');
      const style=elem('style');style.textContent=css;
      canvas=elem('canvas');canvas.setAttribute('aria-hidden','true');ink=canvas.getContext('2d');
      legend=elem('div','rain-key');title=elem('strong');summary=elem('span');ramp=elem('div','rain-ramp');
      for(const b of stops){const mark=elem('b');mark.textContent=b.label;ramp.append(mark)}
      ramp.setAttribute('aria-label','Accumulation scale in millimetres from 0.05 to 15 or higher');
      legend.title='ICON rain accumulated in the preceding hour, interpolated between valid 0.25° samples. Shaft heights, shapes and falling motion are illustrative.';
      findRain=elem('button','rain-find');findRain.type='button';findRain.textContent='Find rain on the map';
      findRain.addEventListener('pointerdown',e=>e.stopPropagation());
      findRain.onclick=e=>{e.stopPropagation();if(target)onFind?.(target)};
      legend.append(title,summary,ramp,findRain);layer.append(style,canvas);stage.append(layer);placeLegend();
      io=new IntersectionObserver(entries=>{intersecting=entries[0].isIntersecting;wake()});io.observe(host);
    }
    function load(){
      const now=Date.now();if(pending||now-loadedAt<900000||now-attemptedAt<60000)return;
      attemptedAt=now;
      pending=AtlasProvinceClouds.load().then(p=>{
        if(disposed)return;
        if(p!==packet){packet=p;cache.clear();viewKey=''}
        loadedAt=Date.now();
      }).catch(()=>{}).finally(()=>{pending=null;if(!disposed)ctx?.requestDraw?.()});
    }
    function findWet(time){
      let last=null;
      for(const sample of packet?.rainHours?.values()||[]){
        if(sample.mm<minimum)continue;
        if(sample.time>=time)return sample;
        last=sample;
      }
      return last;
    }
    function findTarget(time){
      const local=ctx.scale!=='province',isCrag=!!ctx.landmark;
      const site=ctx.observer||ctx.housePoint||(isCrag?window.AtlasCragTerrain?.landmarks?.find(p=>p.key===ctx.landmark):window.AtlasSun?.home);
      const key=[time,local,site?.lon,site?.lat].join('/');
      if(key===targetKey)return;
      targetKey=key;siteAmount=local&&site?atPosition(field,site.lon,site.lat):null;
      target=local&&site&&onFind?AtlasProvinceClouds.wetHourNear?.(packet,site.lon,site.lat,{around:time}):null;
      findRain.textContent=target?'Find rain at '+(ctx.housePoint?'pin':isCrag?'Crazy Horse':'Old City'):'Find rain on the map';
      if(!target&&onFind)target=findWet(time);
    }
    function clear(){
      stop();setSurface(null);field=null;viewKey=targetKey='';air=[];drops=[];target=null;
      ink.setTransform(1,0,0,1,0,0);ink.clearRect(0,0,canvas.width,canvas.height);
    }
    function draw(next){
      if(disposed||!next.stage)return;
      prepare(next.stage);ctx=next;
      const enabled=ctx.mapLayers?.localRain&&['window','local','province'].includes(ctx.scale)&&ctx.weatherMode!=='systems'&&ctx.camera&&ctx.elevation&&ctx.geo;
      legend.hidden=layer.hidden=!enabled;
      if(!enabled){if(field||surface||frame||delay)clear();return}
      const time=ctx.state?.time,saved=ctx.state?.provinceModel===false;
      if(!saved)load();
      if(!saved&&packet&&!cache.has(time)){
        cache.set(time,hourField(packet,time,ctx));if(cache.size>4)cache.delete(cache.keys().next().value);
      }
      const nextField=saved?null:cache.get(time);
      if(!nextField){
        clear();title.textContent='Hourly rain';
        summary.textContent=saved?'Provincial rain grid unavailable for this saved run.':(finite(time)?period(time)+' · ':'')+(pending?'loading':'coverage unavailable');
        ramp.hidden=findRain.hidden=true;return;
      }
      if(field!==nextField){field=nextField;viewKey=targetKey=''}
      findTarget(time);setSurface(field);
      const c=ctx.camera;dpr=Math.min(window.devicePixelRatio||1,1.5);
      const bw=Math.round(c.w*dpr),bh=Math.round(c.h*dpr);
      if(canvas.width!==bw||canvas.height!==bh){canvas.width=bw;canvas.height=bh;viewKey=''}
      const pose=[...c.eye,...c.F,...c.up,c.focal,c.cx,c.cy,c.shear,c.ve,c.near,bw,bh,ctx.position,ctx.landmark,ctx.mapLayers.relief,ctx.terrainDepthRevision,ctx.observer?.lon,ctx.observer?.lat].join('/');
      const changed=pose!==viewKey;
      if(changed){
        viewKey=pose;reading=viewReading(field,ctx);air=field.image?projectAir(field,ctx):[];drops=field.image?nearbyDrops(field,ctx):[];
      }
      const forecast=(finite(packet.cutoff)&&time>packet.cutoff)||time>Date.now()/1000;
      title.textContent='ICON '+(forecast?'forecast rain':'modeled rain')+' · mm in preceding hour';
      const max=reading.peak;
      summary.textContent=period(time)+' · '+(max===null?'no grid coverage '+reading.where:max>=minimum?number.format(max)+' mm '+(ctx.observer||ctx.housePoint?'':'max ')+reading.where:'under 0.05 mm '+reading.where);
      ramp.hidden=false;findRain.hidden=!target||(target.local?siteAmount:max)>=minimum;
      if(changed||!moving()){stop();if(active())paint(performance.now())}else schedule();
    }
    const unsubscribe=world.addOverlay(draw);
    document.addEventListener('visibilitychange',wake);motion.addEventListener('change',wake);narrow.addEventListener('change',placeLegend);
    return {destroy(){
      disposed=true;stop();unsubscribe();setSurface(null);io?.disconnect();legend?.remove();layer?.remove();cache.clear();air=[];drops=[];atlas=null;ctx=null;
      document.removeEventListener('visibilitychange',wake);motion.removeEventListener('change',wake);narrow.removeEventListener('change',placeLegend);
    }};
  }
  return {mount};
})();
