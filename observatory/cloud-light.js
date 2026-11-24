/* Draw illustrative, depth-ordered slices of a humidity-supported model envelope.
 * The atlas carries dimensionless density and lighting, never observed cloud shapes. */
window.AtlasCloudLight=(()=>{
  'use strict';
  const finite=Number.isFinite, rad=Math.PI/180;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const mix=(a,b,f)=>a+(b-a)*f;
  const smooth=t=>t*t*(3-2*t);
  const uvCache=new Map();
  // The same model envelope supports different render textures, with no inferred cloud type.
  const morphology={
    low:{family:0,length:1,side:.91,depth:.96,warp:.10,opacity:1},
    mid:{family:1,length:1.035,side:.76,depth:.83,warp:.13,opacity:.92},
    high:{family:1,length:1.08,side:.50,depth:.62,warp:.17,opacity:.81}
  };
  function uv(family,grade,axis,slice){
    const tile=((family*3+grade)*3+axis)*8+slice;
    if(uvCache.has(tile))return uvCache.get(tile);
    const x=(tile%12)*52+2,y=Math.floor(tile/12)*52+2;
    const l=(x+.5)/624,r=(x+47.5)/624,t=(y+.5)/624,b=(y+47.5)/624;
    const coords=[[l,t],[r,t],[r,b],[l,t],[r,b],[l,b]];uvCache.set(tile,coords);return coords;
  }
  function envelopes(volumes,selected){
    const cells=new Map();
    for(const v of volumes||[]){
      if(selected&&selected!=='all'&&v.id!==selected)continue;
      if(![v.lo,v.la,v.z,v.rz,v.radius,v.cover,v.rh].every(finite)||v.cover<5||v.rh<70||v.rz<=0)continue;
      const key=v.lo+'/'+v.la+'/'+v.band;
      if(!cells.has(key))cells.set(key,[]);
      cells.get(key).push(v);
    }
    const groups=[];
    for(const [key,levels] of cells){
      levels.sort((a,b)=>a.z-b.z);
      let g=null,count=0;
      for(const v of levels){
        const bottom=v.z-v.rz,top=v.z+v.rz,w=2*v.rz;
        if(!g||bottom>g.top+.012){
          g={key:key+'/'+count++,lo:v.lo,la:v.la,bottom,top,radius:v.radius,band:v.band,cover:0,rh:0,weight:0,east:0,north:0,opacity:1};groups.push(g);
        }
        g.top=Math.max(g.top,top);g.weight+=w;g.cover+=v.cover*w;g.rh+=v.rh*w;
        if(finite(v.wind)&&finite(v.dir)){
          g.east-=v.wind*Math.sin(v.dir*rad)*w;g.north-=v.wind*Math.cos(v.dir*rad)*w;
        }
      }
    }
    for(const g of groups)for(const prop of ['cover','rh','east','north'])g[prop]/=g.weight;
    // Give an exposed cell less weight in the band-field handoff, while a
    // cluster with moist neighbours retains its measured vertical structure.
    for(const g of groups){
      const neighbours=new Set(),kmLon=111.2*Math.cos(g.la*rad);
      for(const peer of groups){
        if(peer===g||peer.band!==g.band||peer.bottom>=g.top||g.bottom>=peer.top)continue;
        const dx=(peer.lo-g.lo)*kmLon,dy=(peer.la-g.la)*111.2;
        if(Math.hypot(dx,dy)<(g.radius+peer.radius)*2)neighbours.add(peer.lo+'/'+peer.la);
      }
      g.interior=smooth(clamp(neighbours.size/8,0,1));
    }
    return groups;
  }
  function interpolate(prev,next,f){
    const old=new Map(prev.map(g=>[g.key,g])),out=[];
    for(const g of next){
      const a=old.get(g.key);
      if(!a){out.push({...g,opacity:f});continue;}
      old.delete(g.key);
      const item={...g};for(const prop of ['bottom','top','cover','rh','east','north'])item[prop]=mix(a[prop],g[prop],f);
      out.push(item);
    }
    for(const g of old.values())out.push({...g,opacity:1-f});
    return out;
  }
  function flowPaths(samples,elevation,geo){
    const fields=samples.filter(s=>[s.lo,s.la,s.l?.height,s.l?.wind,s.l?.dir].every(finite)&&s.l.wind>=0)
      .map(s=>({...s,u:-s.l.wind*Math.sin(s.l.dir*rad),v:-s.l.wind*Math.cos(s.l.dir*rad)}));
    const paths=[];
    for(const patch of fields){
      if(patch.l.wind<.6)continue;
      const kmLon=111.2*Math.cos(patch.la*rad),speed=patch.l.wind;
      const nearby=fields.map(s=>({x:(s.lo-patch.lo)*kmLon,y:(s.la-patch.la)*111.2,s}))
        .filter(p=>Math.hypot(p.x,p.y)<18);
      const length=Math.min(8,speed*.5),ux=patch.u/speed,uy=patch.v/speed;
      function flow(x,y){
        let n=0,h=0,u=0,v=0;
        for(const p of nearby){
          const d2=(p.x-x)**2+(p.y-y)**2,w=1/Math.max(.025,d2);
          n+=w;h+=p.s.l.height*w;u+=p.s.u*w;v+=p.s.v*w;
        }
        return {u:u/n,v:v/n,h:h/n};
      }
      {
        const reach=length,offset=0;
        let x=-ux*reach*.5-uy*offset,y=-uy*reach*.5+ux*offset;
        let segment=[],elapsed=0;
        function flush(){
          if(segment.length>2)paths.push({points:segment,primary:true,phase:(patch.lo*103+patch.la*11)%1});
          segment=[];
        }
        for(let i=0;i<=10;i++){
          const f=flow(x,y),s=Math.hypot(f.u,f.v);if(s<.3)break;
          const lon=patch.lo+x/kmLon,lat=patch.la+y/111.2,ground=elevation(lon,lat);
          if(finite(ground)&&f.h<=ground+8){flush();}
          else segment.push({p:geo(lon,lat,f.h/1000),t:elapsed});
          const ds=reach/10;
          x+=ds*f.u/s;y+=ds*f.v/s;elapsed+=3600*ds/s;
        }
        flush();
      }
    }
    return paths;
  }
  function offsetPoint(p,c,dir,width,z){
    const k=width*z/c.focal;
    const delta=p.map((_,i)=>k*(c.right[i]*dir[0]-c.up[i]*dir[1]));
    // Camera direction is in the displayed (vertically exaggerated) space.
    // Undo its radial stretch for a consistently thin stroke in screen pixels.
    if(c.ve>1){
      const normal=[p[0],p[1],6371.0088+p[2]],length=Math.hypot(...normal);
      const radial=delta.reduce((sum,v,i)=>sum+v*normal[i]/length,0)*(1-1/c.ve);
      for(let i=0;i<3;i++)delta[i]-=radial*normal[i]/length;
    }
    return p.map((v,i)=>v+delta[i]);
  }
  const planSeed=new Uint8Array(128*128);
  let rng=59043;for(let i=0;i<planSeed.length;i++){rng=(Math.imul(rng,1664525)+1013904223)>>>0;planSeed[i]=rng>>>24}
  function noise(x,y){
    const i=Math.floor(x),j=Math.floor(y),u=smooth(x-i),v=smooth(y-j),a=(j&127)*128,b=((j+1)&127)*128,l=i&127,r=(i+1)&127;
    return mix(mix(planSeed[a+l],planSeed[a+r],u),mix(planSeed[b+l],planSeed[b+r],u),v)/255;
  }
  function densityNoise(east,north,up,band){
    if(band==='high')return .55*noise(east*.12+up*.55,north*.44-up*.36)+.45*noise(east*.32-up*.30,north*.87+up*.72);
    if(band==='mid')return .62*noise(east*.29+up*.64,north*.34-up*.46)+.38*noise(east*.81-up*.72,north*.75+up*.84);
    return .49*noise(east*.39+up*.77,north*.43-up*.51)+.34*noise(east*.89-up*.54,north*.94+up*.83)+.17*noise(east*1.66-up*.96,north*1.79-up*1.26);
  }

  function material(east,north,up,r2,g,scale,shiftEast,shiftNorth){
    const height=(up-g.bottom)/(g.top-g.bottom);
    const coarse=densityNoise(east*.62,north*.62,up,g.band);
    const detail=densityNoise(east-shiftEast,north-shiftNorth,up,g.band);
    const outline=1-r2;
    if(g.band==='high'){
      const along=east*scale[0]+north*scale[1];
      const across=north*scale[0]-east*scale[1];
      const strands=noise(along*.19+up*.42,across*1.72+up*1.12+coarse*1.15);
      return smooth(clamp((outline+(coarse-.65)*.62)*1.5,0,1))
        *Math.pow(clamp((strands-.31)*1.44+.25*detail,0,1),2);
    }
    if(g.band==='mid'){
      const shelf=noise(east*.35+up*2.8,north*.53-up*2.4);
      return smooth(clamp((outline+(coarse-.61)*.86)*1.75,0,1))
        *smooth(clamp((.54*coarse+.28*shelf+.18*detail-.26)*2.1,0,1));
    }
    const cells=noise(east*.59+up*1.03,north*.64-up*.82);
    const bulge=.43*coarse+.36*cells+.21*detail;
    const scallops=outline+(bulge-.63)*1.65;
    const base=smooth(clamp((height-.04)*9,0,1));
    return base*smooth(clamp(scallops*2.35,0,1))
      *smooth(clamp((bulge-.35)*2.9,0,1));
  }

  function canvasAtlas(layers,time,canvas,sun) {
    const daylight=smooth(clamp((sun[2]+.12)/.37,0,1));
    const dusk=smooth(clamp((sun[2]+.20)/.28,0,1))*(1-daylight);
    const tile=28,columns=Math.ceil(Math.sqrt(layers.length)),rows=Math.ceil(layers.length/columns);
    const width=columns*tile,height=rows*tile;
    canvas??=document.createElement('canvas');
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
    const ctx=canvas.getContext('2d'),im=ctx.createImageData(width,height),rgba=im.data;
    for(const [i,layer] of layers.entries()){
      const {g,cover,local,heading}=layer;
      const probe=g.band==='low'?.55:g.band==='mid'?.72:.46;
      const extinction=g.band==='low'?3.8:g.band==='mid'?2.6:2.45;
      const tileX=i%columns*tile,tileY=Math.floor(i/columns)*tile;
      const shiftEast=g.east*time/3600,shiftNorth=g.north*time/3600;
      for(let y=0;y<tile;y++)for(let x=0;x<tile;x++){
        const u=2*x/(tile-1)-1,v=1-2*y/(tile-1);
        let mass=0,litMass=0,baseMass=0;
        for(const offset of [-.31,.31]){
          const [east,north,up,r2]=local(u,v,offset);
          if(r2>=1)continue;
          const density=material(east,north,up,r2,g,heading,shiftEast,shiftNorth);
          if(density<.002)continue;
          // A sunward depth probe weights the lit surface of each irregular lobe.
          const towardSun=material(east+sun[0]*probe,north+sun[1]*probe,up+sun[2]*probe,
            r2,g,heading,shiftEast,shiftNorth);
          const height=(up-g.bottom)/(g.top-g.bottom);
          const sunlit=clamp(.44+.76*(density-towardSun)+.50*height-.35*towardSun,.10,1);
          mass+=density;
          litMass+=density*sunlit;
          baseMass+=density*(1-height);
        }
        if(mass<.005)continue;
        const light=litMass/mass,base=baseMass/mass;
        const alpha=1-Math.exp(-extinction*mass/2*(.65+.35*cover));
        const offset=4*((tileY+y)*width+tileX+x);
        rgba[offset]=mix(51+48*light+38*dusk,113+142*light-13*base,daylight);
        rgba[offset+1]=mix(66+44*light+14*dusk,138+115*light-9*base,daylight);
        rgba[offset+2]=mix(91+47*light,162+91*light-4*base,daylight);
        rgba[offset+3]=Math.round(255*alpha);
      }
      const l=(tileX+.5)/width,r=(tileX+tile-.5)/width,t=(tileY+.5)/height,b=(tileY+tile-.5)/height;
      layer.uv=[[l,t],[r,t],[r,b],[l,t],[r,b],[l,b]];
    }
    ctx.putImageData(im,0,0);
    canvas.atlasRevision=(canvas.atlasRevision||0)+1;
    return canvas;
  }

  function create(){
    let previous=[],target=[],lastTime=null,lastSelection=null,lastSignature=null,transition=0,clock=0,started=null;
    let lastWind=null,routes=[],densityCanvas=null,densityKey='',densityUV=[],renderedTick=0;
    function drawWind({wind,camera:c,geo,elevation,paint,animated,elapsed}){
      if(!c||!geo||!elevation||!paint)return false;
      if(wind!==lastWind){routes=flowPaths(wind||[],elevation,geo);lastWind=wind;}
      const halos=[],trails=[],heads=[],particles=[],occupied=[];
      for(const path of routes){
        const nodes=path.points,first=c.project(nodes[0].p),last=c.project(nodes.at(-1).p);
        if(!first||!last)continue;
        const pixels=Math.hypot(last[0]-first[0],last[1]-first[1]);
        if(pixels<(path.primary?4:12)||Math.max(first[0],last[0])<0||Math.min(first[0],last[0])>c.w||Math.max(first[1],last[1])<0||Math.min(first[1],last[1])>c.h)continue;
        const cx=(first[0]+last[0])/2,cy=(first[1]+last[1])/2;
        if(occupied.some(a=>Math.hypot(a[0]-cx,a[1]-cy)<(c.w<520?48:58)))continue;occupied.push([cx,cy]);
        const age=(finite(elapsed)?elapsed:performance.now()/1000)*120;
        const duration=nodes.at(-1).t-nodes[0].t;
        const pulse=nodes[0].t+((age/duration+path.phase)%1+1)%1*duration;
        const width=(path.primary?1.05:.66)*clamp(pixels/15,.55,1.05);
        for(let i=1;i<nodes.length;i++){
          const a=nodes[i-1],b=nodes[i],pa=c.project(a.p),pb=c.project(b.p);
          if(!pa||!pb)continue;
          const dx=pb[0]-pa[0],dy=pb[1]-pa[1],s=Math.hypot(dx,dy);if(s<.18)continue;
          const norm=[-dy/s,dx/s];
          function strip(arr,w){
            const wa=w*(.30+.70*Math.min(i/3,1)),wb=w*(.30+.70*Math.min((i+1)/3,1));
            const l=offsetPoint(a.p,c,norm,wa,pa[2]),r=offsetPoint(a.p,c,norm,-wa,pa[2]);
            const ll=offsetPoint(b.p,c,norm,wb,pb[2]),rr=offsetPoint(b.p,c,norm,-wb,pb[2]);
            arr.push(l,r,rr,l,rr,ll);
          }
          strip(halos,width+.40);strip(trails,width*.58);
          if(i===nodes.length-1){
            const size=clamp(pixels*.16,2.8,path.primary?7:5);
            const tail=offsetPoint(b.p,c,[-dx/s,-dy/s],size,pb[2]);
            heads.push(b.p,offsetPoint(tail,c,norm,size*.4,pb[2]),offsetPoint(tail,c,norm,-size*.4,pb[2]));
          }
          if(animated&&a.t<=pulse&&pulse<b.t){
            const f=(pulse-a.t)/(b.t-a.t);
            const nose=a.p.map((v,k)=>mix(v,b.p[k],f));
            const tail=offsetPoint(nose,c,[-dx/s,-dy/s],clamp(pixels*.15,3,7),pb[2]);
            particles.push(nose,offsetPoint(tail,c,norm,width*1.27,pb[2]),offsetPoint(tail,c,norm,-width*1.27,pb[2]));
          }
        }
      }
      if(halos.length)paint(halos,[.10,.29,.31],.48,'TRIANGLES');
      if(trails.length)paint(trails,[.65,.91,.88],.74,'TRIANGLES');
      if(heads.length)paint(heads,[.75,.96,.91],.81,'TRIANGLES');
      if(particles.length)paint(particles,[1,.96,.73],.99,'TRIANGLES');
      return true;
    }
    function current(now){
      if(!transition)return target;
      const f=clamp((now-transition)/360,0,1);
      if(f===1){transition=0;previous=[];return target;}
      return interpolate(previous,target,smooth(f));
    }
    function draw(opts){
      const {camera:c,geo,drawSlice}=opts;
      if(!c||!geo||typeof drawSlice!=='function')return false;
      const raw=opts.volumes||[],selected=opts.selected||'all',time=Number(opts.time),now=performance.now();
      const reduced=opts.reducedMotion??window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const signature=raw.map(v=>[v.id,v.z,v.rz,v.rh,v.cover,v.dir,v.wind].join(',')).join(';');
      if(time!==lastTime||selected!==lastSelection||signature!==lastSignature){
        const adjacent=finite(time)&&finite(lastTime)&&Math.abs(time-lastTime)===3600&&selected===lastSelection&&!reduced;
        previous=adjacent?current(now):[];
        target=envelopes(raw,selected);
        transition=adjacent?now:0;
        if(lastTime!==time){
          if(!adjacent){clock=0;renderedTick=0;}
          started=null;
        }
        lastTime=time;lastSelection=selected;lastSignature=signature;
      }
      const factor=finite(opts.motionFactor)?clamp(opts.motionFactor,0,120):1;
      const moving=Boolean(opts.animated)&&!reduced&&factor>0;
      const wall=finite(opts.elapsed)?opts.elapsed:now/1000;
      if(moving){
        if(started!==null)clock+=Math.max(0,wall-started)*factor;
        started=wall;
      }else started=null;
      const textureStep=factor<=1?1:factor<=30?3:8;
      const densityTime=renderedTick=Math.max(renderedTick,Math.floor(clock/textureStep)*textureStep);
      const projected=[];
      for(const g of current(now)){
        if(g.opacity<=.003)continue;
        const cover=clamp(g.cover/100,0,1),rh=clamp((g.rh-70)/30,0,1);
        const speed=Math.hypot(g.east,g.north);
        const index=Math.round(g.lo*80)+31*Math.round(g.la*80);
        const mirror=Math.sin(index*17.71)>0?1:-1;
        const angle=speed>.6?Math.atan2(g.north,g.east):index%8*Math.PI/4;
        const ca=Math.cos(angle),sa=Math.sin(angle),kmLon=111.2*Math.cos(g.la*rad);
        const shape=morphology[g.band]||morphology.mid;
        const z=(g.top+g.bottom)/2,rz=(g.top-g.bottom)/2;
        const base=g.radius*(.53+.56*Math.sqrt(cover));
        const rx=base*shape.length,ry=base*shape.side*mirror;
        const phase=index*1.37;
        function coords(x,y,h){
          const east=x*rx*ca-y*ry*sa,north=x*rx*sa+y*ry*ca;
          const bend=Math.sin(1.5*x+.64*y+phase)*shape.warp*(1-Math.abs(h));
          return [east,north,z+(h*shape.depth+bend)*rz];
        }
        function point(x,y,h){
          const [east,north,up]=coords(x,y,h);
          return geo(g.lo+east/kmLon,g.la+north/111.2,up);
        }
        function earth(x,y,h){
          const [east,north,up]=coords(x,y,h);
          return [(g.lo-98.985)*105.25+east,(g.la-18.79)*111.2+north,up,x*x+y*y+h*h];
        }
        const center=c.project(point(0,0,0));if(!center)continue;
        const edge=[c.project(point(.25,0,0)),c.project(point(0,.25,0)),c.project(point(0,0,.25))];
        if(edge.some(a=>!a))continue;
        const vec=edge.map(v=>[(v[0]-center[0])*4,(v[1]-center[1])*4]);
        const width=vec.reduce((n,v)=>n+Math.abs(v[0]),0),height=vec.reduce((n,v)=>n+Math.abs(v[1]),0);
        if(width<1||height<.7||center[0]+width<0||center[0]-width>c.w||center[1]+height<0||center[1]-height>c.h)continue;
        const det=(a,b)=>Math.abs(vec[a][0]*vec[b][1]-vec[a][1]*vec[b][0]);
        const faces=[det(1,2),det(0,2),det(0,1)],axis=faces.indexOf(Math.max(...faces));
        projected.push({g,shape,cover,rh,pageArea:width*height,point,earth,axis,center,heading:[ca,sa]});
      }
      projected.sort((a,b)=>b.pageArea-a.pageArea);
      const software=opts.renderer==='canvas2d',budget=software?42:90;
      const onscreen=projected.slice(0,software?7:12);
      const layers=[],procedural=typeof opts.drawPlan==='function';
      for(const {g,shape,cover,rh,pageArea,point,earth,axis,center,heading} of onscreen){
        const tint=opts.style==='height'?({low:[.59,.94,.78],mid:[1,.79,.48],high:[.80,.70,1]}[g.band]||[1,1,1]):opts.style==='humidity'?[mix(.80,.28,Math.round(rh*4)/4),mix(.89,.62,Math.round(rh*4)/4),.98]:[1,1,1];
        const cap=Math.max(2,Math.min(8,Math.floor(budget/Math.max(1,onscreen.length))));
        const count=Math.max(2,Math.min(cap,pageArea<80?3:pageArea<350?5:8));
        const alpha=1-(1-clamp((.52+.40*cover+.08*rh)*shape.opacity*g.opacity*(1-(opts.edgeHandoff||0)*.82*(1-g.interior)),0,.99))**(3.2/count);
        const grade=cover<.28?0:cover<.72?1:2;
        for(let i=0;i<count;i++){
          const slice=Math.min(7,Math.floor((i+.5)*8/count)),n=(i+.5)*2/count-1;
          const indices=(u,v,d=n)=>axis===0?[d,u,v]:axis===1?[u,d,v]:[u,v,d];
          const coord=(u,v)=>point(...indices(u,v));
          const tl=coord(-1,1),tr=coord(1,1),br=coord(1,-1),bl=coord(-1,-1);
          const depth=c.project(coord(0,0))?.[2]??center[2];
          layers.push({g,cover,p:[tl,tr,br,tl,br,bl],uv:uv(shape.family,grade,axis,slice),alpha,z:depth,tint,
            heading,local:(u,v,offset)=>earth(...indices(u,v,n+2*offset/count)),key:[g.key,axis,n,g.top,g.bottom,g.east,g.north,g.cover].join('/')});
        }
      }
      layers.sort((a,b)=>b.z-a.z);
      if(procedural&&layers.length){
        const anyWind=layers.some(({g})=>Math.hypot(g.east,g.north)>.001);
        const tick=anyWind?densityTime:0;
        const solarTime=opts.solarTime??time,lightTime=Math.round(solarTime/240)*240;
        const key=time+';'+tick+';'+lightTime+';'+[opts.solarPoint?.lon,opts.solarPoint?.lat].join(',')+';'+layers.map(layer=>layer.key).join('|');
        if(key!==densityKey){
          const light=finite(lightTime)?window.AtlasSun?.position(lightTime,opts.solarPoint)?.vec||[-.4,.35,.84]:[-.4,.35,.84];
          densityCanvas=canvasAtlas(layers,tick,densityCanvas,light);
          densityKey=key;densityUV=layers.map(layer=>layer.uv);
        }
        for(const [i,layer] of layers.entries())opts.drawPlan(densityCanvas,layer.p,densityUV[i],layer.alpha,layer.tint,0);
      }else for(const layer of layers)drawSlice(layer.p,layer.uv,layer.alpha,layer.tint);
      return true;
    }
    return {draw,drawWind,suspend(){started=null;},isTransitioning:()=>!!transition&&performance.now()-transition<360,destroy(){target=[];previous=[];transition=0;densityCanvas=null;densityKey='';densityUV=[];}};
  }
  const shared=create();
  return {envelopes,create,draw:shared.draw,drawWind:shared.drawWind,isTransitioning:shared.isTransitioning};
})();
