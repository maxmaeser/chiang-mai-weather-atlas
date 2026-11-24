/* Solar position at the chart time, expressed east/north/up, and relief shadows. */
window.AtlasSun=(()=>{
  'use strict';
  const home={lat:18.79,lon:98.985},deg=Math.PI/180,day=86400;
  const limit=(x,a,b)=>Math.max(a,Math.min(b,x));
  const basinBox=[98.60,18.52,99.37,19.12],width=224,height=184;
  const localDay=t=>Math.floor((t+7*3600)/day)*day-7*3600;
  const clock=t=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(Math.round(t/60)*60000);
  function position(t,site=home){
    const d=new Date(t*1000),year=d.getUTCFullYear(),start=Date.UTC(year,0,1)/1000;
    const y=2*Math.PI*((t-start)/day-.5)/((Date.UTC(year+1,0,1)/1000-start)/day);
    const eq=229.18*(.000075+.001868*Math.cos(y)-.032077*Math.sin(y)-.014615*Math.cos(2*y)-.040849*Math.sin(2*y));
    const dec=.006918-.399912*Math.cos(y)+.070257*Math.sin(y)-.006758*Math.cos(2*y)+.000907*Math.sin(2*y)-.002697*Math.cos(3*y)+.00148*Math.sin(3*y);
    const hour=((t%day)/240+eq/4+site.lon-180)*deg,lat=site.lat*deg;
    const east=-Math.cos(dec)*Math.sin(hour),north=Math.cos(lat)*Math.sin(dec)-Math.sin(lat)*Math.cos(dec)*Math.cos(hour);
    const up=Math.sin(lat)*Math.sin(dec)+Math.cos(lat)*Math.cos(dec)*Math.cos(hour);
    return {az:(Math.atan2(east,north)/deg+360)%360,alt:Math.asin(limit(up,-1,1))/deg,vec:[east,north,up]};
  }
  function events(t,site=home){
    const start=localDay(t);
    function cross(a,b,rising){
      for(let i=0;i<21;i++){const m=(a+b)/2;if((position(m,site).alt<-.833)===rising)a=m;else b=m}
      const time=Math.round((a+b)/2);
      return {time,...position(time,site)};
    }
    return {rise:cross(start,start+12*3600,true),set:cross(start+12*3600,start+day,false)};
  }
  function card(box,change){
    box.innerHTML='<summary>Sun &amp; shadows <span class="sun-glance"></span></summary><div class="sun-body"><svg viewBox="0 0 224 143" role="img" aria-label="Daily solar path along compass bearings"></svg><strong class="sun-selected"></strong><div class="sun-events"><button data-event="rise"></button><button data-event="set"></button></div><button class="sun-reset">Use weather hour</button><p class="sun-caption"></p><a href="https://gml.noaa.gov/grad/solcalc/solareqns.PDF">NOAA solar equations ↗</a></div>';
    const q=s=>box.querySelector(s),svg=q('svg');
    let weatherTime=null,time=null,site=home,place='Old City',dayKey='',crossings=null;
    const xy=(az,alt)=>{const r=54*(1-limit(alt,0,90)/90);return [111+r*Math.sin(az*deg),70-r*Math.cos(az*deg)]};
    function update(t,notify=true){
      if(!Number.isFinite(t))return;time=t;
      const key=localDay(t)+'/'+site.lat+'/'+site.lon;
      if(dayKey!==key){crossings=events(t,site);dayKey=key}
      const p=position(t,site),a=crossings.rise,b=crossings.set;
      const draw=(tag,attrs,txt)=>AtlasUI.mark(svg,tag,attrs,txt);
      svg.replaceChildren();
      for(const r of [18,36,54])draw('circle',{cx:111,cy:70,r,fill:'none',stroke:'#506963','stroke-width':1});
      for(const [text,x,y] of [['N',111,10],['S',111,140],['E',178,75],['W',44,75]])draw('text',{x,y,'text-anchor':'middle',fill:'#cee0d4','font-size':11},text);
      const trail=[];
      for(let t=a.time;t<b.time;t+=900){const v=position(t,site);trail.push(xy(v.az,v.alt))}
      trail.push(xy(b.az,b.alt));draw('polyline',{points:trail.map(v=>v.join(',')).join(' '),fill:'none',stroke:'#edc778','stroke-width':1.8});
      for(const v of [a,b]){const [cx,cy]=xy(v.az,v.alt);draw('circle',{cx,cy,r:3,fill:'#e3ad59'})}
      const [x,y]=xy(p.az,p.alt);
      draw('line',{x1:111,y1:70,x2:x,y2:y,stroke:'#f4da9c','stroke-dasharray':'4 3'});
      draw('circle',{cx:x,cy:y,r:5,fill:p.alt>0?'#ffdb82':'#53645d',stroke:'#f5db9e'});
      q('.sun-glance').textContent=clock(t)+' · '+Math.round(p.alt)+'°';
      q('.sun-selected').textContent=place+' · '+Math.round(p.az)+'° bearing · '+Math.round(p.alt)+'° elevation';
      for(const [k,title,v] of [['rise','Rise',a],['set','Set',b]]){q('[data-event='+k+']').textContent=title+' '+clock(v.time)+' · '+Math.round(v.az)+'°'}

      q('.sun-caption').textContent=(p.alt>0?'Shadows point toward '+(Math.round(p.az+180)%360)+'°. ':'Sun below the horizon. ')+'Rise and set use a level horizon. The relief shadow uses terrain heights and excludes buildings and trees.';
      q('.sun-reset').disabled=time===weatherTime;
      if(notify)change(t);
    }

    q('[data-event=rise]').onclick=()=>update(crossings.rise.time);
    q('[data-event=set]').onclick=()=>update(crossings.set.time);
    q('.sun-reset').onclick=()=>update(weatherTime);
    return {setTime(t,weather){weatherTime=weather;if(time!==t)update(t,false);return time},
      setPlace(v,name){site=v||home;place=name||'Old City';if(time)update(time,false)}};
  }
  function scene({stage,geo,elevation,paint}){
    let time=null,site=home,flags={sun:true,sunPath:false,shadows:false,roads:false,rivers:false};
    let track=null;
    let bx=basinBox,grid=null,mask=null,maskKey='',lines=null,loading=false;
    const pins=Array.from({length:3},()=>{const e=document.createElement('span');e.className='sun-map-tag';e.hidden=true;stage.append(e);return e});
    const surface=(lon,lat)=>geo(lon,lat,Math.max(0,elevation(lon,lat)||0)/1000+.03);
    // Bennett apparent refraction at standard pressure and temperature, degrees.
    function apparent(alt){return alt+ (alt> -1.3 ? 1.02/Math.tan((alt+10.3/(alt+5.11))*deg)/60:0)}
    function horizon(point,az){
      const z=(elevation(point.lon,point.lat)||0)+1.7,a=az*deg;
      let best=-90;
      for(let m=18;m<=90000;m+=Math.max(18,m*.016)){
        const lon=point.lon+Math.sin(a)*m/(111320*Math.cos(point.lat*deg)),lat=point.lat+Math.cos(a)*m/111320,h=elevation(lon,lat);
        if(h!=null)best=Math.max(best,Math.atan2(h-z-m*m/(2*6371009),m)/deg);
      }
      return best;
    }
    function terrainSet(t,point=site){
      const ev=events(t,point);let a=ev.set.time-5*3600,b=ev.set.time+900;
      for(let i=0;i<20;i++){const m=(a+b)/2,v=position(m,point);if(apparent(v.alt)+.2666>horizon(point,v.az))a=m;else b=m}
      const stamp=Math.round((a+b)/2),p=position(stamp,point);return {time:stamp,az:p.az,alt:p.alt,horizon:horizon(point,p.az)};
    }
    const skyCanvas=document.createElement('canvas');
    let skyKey='';
    const skyRadius=.2666;
    const easing=x=>{const k=limit(x,0,1);return k*k*(3-2*k);};
    function lighting(t,point=site){
      if(!Number.isFinite(t)||!flags.sun&&!flags.sky&&!flags.sunPath&&!flags.shadows)return null;
      const p=position(t,point);
      const twilight=easing((p.alt+15)/14);
      const daylight=easing((p.alt+1)/23);
      const brightness=.27+.35*twilight+.38*daylight;
      const warm=twilight*(1-daylight);
      return {p,tint:[brightness*(.82+.18*daylight+.23*warm),brightness*(.90+.10*daylight),brightness*(1-.27*warm)]};
    }
    function sky(c,t,point){
      const light=lighting(t,point||site);
      if(!light)return null;
      const {p}=light,alt=apparent(p.alt);
      const key=[t,c.w,c.h,...c.F,...c.right,c.focal,c.cx,c.cy,c.shear,point?.lon,point?.lat,flags.sun,flags.sky,flags.sunPath].join('/');
      if(skyKey===key)return skyCanvas;
      skyKey=key;
      const w=Math.min(780,Math.round(c.w)),h=Math.max(1,Math.round(w*c.h/c.w)),k=w/c.w;
      if(skyCanvas.width!==w||skyCanvas.height!==h){skyCanvas.width=w;skyCanvas.height=h;}
      const g=skyCanvas.getContext('2d',{alpha:false});
      const twilight=easing((p.alt+17)/17),daylight=easing((p.alt+1)/20);
      const rgb=(a,b,d)=>'rgb('+a.map((v,i)=>Math.round((v+(b[i]-v)*twilight)*(1-daylight)+d[i]*daylight)).join(',')+')';
      const hy=limit(c.cy+c.F[2]/Math.max(.05,c.up[2])*c.focal,-c.h,2*c.h)*k;
      const grad=g.createLinearGradient(0,hy-.90*c.focal*k,0,hy+.07*c.focal*k);
      const facing=(1+Math.sin(p.az*deg)*c.F[0]+Math.cos(p.az*deg)*c.F[1])/2;
      grad.addColorStop(0,rgb([6,12,28],[52,77,118],[77,140,188]));
      grad.addColorStop(.64,rgb([15,23,46],[120,133,164],[143,190,215]));
      grad.addColorStop(1,rgb([24,32,53],[177+64*facing,140+29*facing,159-59*facing],[217,229,227]));
      g.fillStyle=grad;g.fillRect(0,0,w,h);
      const pos=c.direction(p.az,alt);
      if(pos&&p.alt> -17){
        const x=pos[0]*k,y=pos[1]*k,r=Math.max(.85,k*c.focal*Math.tan(skyRadius*deg)/pos[2]);
        const reach=Math.min(w*1.25,Math.max(r*25,w*(.15+(1-daylight)*.20)));
        const aureole=easing((p.alt+17)/17)*(.64-.3*daylight);
        if(x+reach>0&&x-reach<w&&y+reach>0&&y-reach<h){
          const glow=g.createRadialGradient(x,y,0,x,y,reach);
          glow.addColorStop(0,'rgba(255,215,149,'+aureole.toFixed(3)+')');
          glow.addColorStop(.33,'rgba(255,173,107,'+(aureole*.48).toFixed(3)+')');
          glow.addColorStop(1,'rgba(255,156,109,0)');
          g.fillStyle=glow;g.fillRect(x-reach,y-reach,reach*2,reach*2);
        }
        if(alt+skyRadius>-.055&&x+r>0&&x-r<w&&y+r>0&&y-r<h){
          g.save();
          if(point){
            const clip=c.direction(p.az,horizon(point,p.az));
            if(clip){g.beginPath();g.rect(0,0,w,Math.max(0,clip[1]*k));g.clip();}
          }
          g.fillStyle=p.alt<5?'#ffe7a3':'#fff9dc';
          g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();g.restore();
        }
      }
      skyCanvas.atlasRevision=(skyCanvas.atlasRevision||0)+1;
      return skyCanvas;
    }
    function landGrid(){
      if(grid)return;
      grid=new Float32Array(width*height);
      for(let j=0;j<height;j++)for(let i=0;i<width;i++)grid[j*width+i]=elevation(bx[0]+(bx[2]-bx[0])*i/(width-1),bx[3]-(bx[3]-bx[1])*j/(height-1))||0;
    }
    function shadow(t,point,province=false){
      const box=province?window.AtlasWorldData?.province?.box:point&&point.lon>99.2?window.AtlasCragTerrain?.patch.box:basinBox;
      if((box||basinBox)!==bx){bx=box||basinBox;grid=null;maskKey=''}
      if((!flags.sun&&!flags.shadows)||!Number.isFinite(t))return null;
      const bucket=flags.shadows?240:60;
      const key=Math.round(t/bucket)+String(flags.shadows);if(key===maskKey)return mask;
      maskKey=key;landGrid();
      const {alt,vec}=position(Math.round(t/bucket)*bucket,point||site),ca=Math.hypot(vec[0],vec[1])||1;
      const dx=(bx[2]-bx[0])/(width-1)*111320*Math.cos(home.lat*deg),dy=(bx[3]-bx[1])/(height-1)*111320;
      const samples=[];
      if(flags.shadows&&alt>0&&alt<65)for(let m=Math.min(dx,dy);m<28500;m+=Math.max(Math.min(dx,dy),m*.09)){
        samples.push([Math.round(vec[0]/ca*m/dx),Math.round(-vec[1]/ca*m/dy),m*Math.tan(alt*deg)]);
      }
      const cv=mask?.canvas||document.createElement('canvas');
      if(cv.width!==width||cv.height!==height){cv.width=width;cv.height=height;}
      const ctx=cv.getContext('2d'),im=ctx.createImageData(width,height),pix=im.data;
      for(let j=0;j<height;j++)for(let i=0;i<width;i++){
        const k=j*width+i,z=grid[k],sx=(grid[j*width+Math.min(width-1,i+1)]-grid[j*width+Math.max(0,i-1)])/(2*dx);
        const sy=(grid[Math.max(0,j-1)*width+i]-grid[Math.min(height-1,j+1)*width+i])/(2*dy);
        const direct=limit((vec[2]-sx*vec[0]-sy*vec[1])/Math.hypot(1,sx,sy),0,1);
        let blocked=alt<=0;
        if(!blocked)for(const [u,v,rise] of samples){
          const x=i+u,y=j+v;if(x<0||x>=width||y<0||y>=height)break;
          if(grid[y*width+x]>z+rise+3){blocked=true;break}
        }
        const shade=blocked?.50+.28*(1-easing(alt/12)):.73+.27*direct+.17*(1-easing(alt/12));
        const light=1+(shade-1)*easing(alt/5);
        pix[k*4]=pix[k*4+1]=pix[k*4+2]=Math.min(255,255*light);pix[k*4+3]=255;
      }
      ctx.putImageData(im,0,0);cv.atlasRevision=(cv.atlasRevision||0)+1;mask={canvas:cv,data:pix};return mask;
    }
    function sample(lon,lat){
      if(!mask||lon<bx[0]||lon>bx[2]||lat<bx[1]||lat>bx[3])return 1;
      const x=Math.round((lon-bx[0])/(bx[2]-bx[0])*(width-1)),y=Math.round((bx[3]-lat)/(bx[3]-bx[1])*(height-1));
      return mask.data[4*(y*width+x)]/255;
    }
    function linework(c,t){
      if(!lines||t>=2.6)return;
      for(const key of ['roads','rivers']){
        if(!flags[key]||key==='roads'&&t>1.6)continue;
        const pts=[];
        for(const line of lines[key])for(let i=1;i<line.length;i++){
          const a=line[i-1],b=line[i],u=c.project(a),v=c.project(b);
          if(!u||!v||Math.max(u[0],v[0])<0||Math.min(u[0],v[0])>c.w||Math.max(u[1],v[1])<0||Math.min(u[1],v[1])>c.h)continue;
          pts.push(a,b);
        }
        paint(pts,key==='rivers'?[.23,.68,.95]:[.98,.71,.44],key==='rivers'?.92:.82,'LINES');
      }
    }
    const ns='http://www.w3.org/2000/svg',arc=document.createElementNS(ns,'svg');
    arc.setAttribute('aria-label','Daily solar arc and terrain sunset');arc.setAttribute('role','img');
    arc.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;display:none';
    stage.append(arc);
    function element(tag,attrs){const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);arc.append(n);return n}
    const pathStyle={fill:'none','stroke-linecap':'round','stroke-linejoin':'round'};
    const back=element('path',{...pathStyle,stroke:'#473b30','stroke-width':2.7,opacity:.5});
    const front=element('path',{...pathStyle,stroke:'#ffcc70','stroke-width':1.5});
    const hiddenPath=element('path',{...pathStyle,stroke:'#ffdb9b','stroke-width':1.5,'stroke-dasharray':'4 5',opacity:.85});
    const contact=element('circle',{r:3.5,fill:'none',stroke:'#ffdb88','stroke-width':1.4});
    // Let the rendered solar disk and its aureole show through the path at the current minute.
    const arcMask=element('mask',{id:'solar-disk-gap',maskUnits:'userSpaceOnUse',x:0,y:0,width:'100%',height:'100%'});
    const maskBase=element('rect',{width:'100%',height:'100%',fill:'white'});
    const gap=element('circle',{r:6,fill:'black'});arcMask.append(maskBase,gap);
    for(const line of [back,front,hiddenPath,contact])line.setAttribute('mask','url(#solar-disk-gap)');
    const sunNow=element('circle',{r:5.5,fill:'none',stroke:'#fff4c7','stroke-width':1,'stroke-dasharray':'3 2'});
    const skyStatus=element('text',{'text-anchor':'end',fill:'#ffe2a2',stroke:'#202c30','stroke-width':3,'paint-order':'stroke','font-family':'system-ui','font-size':12});
    let arcDay='',arcData=null,arcView='';
    function dailyArc(t,point){
      const stamp=localDay(t),key=[stamp,point.lon,point.lat].join('/');
      if(key===arcDay)return arcData;arcDay=key;arcView='';
      const ev=events(t,point),end=terrainSet(t,point),samples=[];
      for(let time=ev.rise.time-600;time<=ev.set.time+720;time+=120){
        const p=position(time,point),alt=apparent(p.alt);
        samples.push({az:p.az,alt,visible:alt>=horizon(point,p.az)});
      }
      return arcData={samples,end:{az:end.az,alt:end.horizon}};
    }
    function drawArc(c,t,selected,point){
      arc.style.display=flags.sunPath&&t<1.52&&Number.isFinite(selected)?'block':'none';
      if(arc.style.display==='none')return;
      const data=dailyArc(selected,point),key=[...c.F,...c.right,c.focal,c.cx,c.cy,c.shear,c.w,c.h].join('/');
      const project=p=>c.direction(p.az,p.alt);
      const sun=position(selected,point),pos=project({az:sun.az,alt:apparent(sun.alt)});
      const inFrame=pos&&pos[0]>0&&pos[0]<c.w&&pos[1]>0&&pos[1]<c.h;
      const behind=sun.alt<15&&apparent(sun.alt)+.2666<=horizon(point,sun.az);
      sunNow.style.display=inFrame&&!behind?'':'none';
      gap.style.display=sunNow.style.display;
      if(inFrame&&!behind)for(const marker of [sunNow,gap]){marker.setAttribute('cx',pos[0]);marker.setAttribute('cy',pos[1])}
      skyStatus.textContent=inFrame&&!behind?'':(sun.alt<0?'Sun below horizon':behind?'Sun behind terrain':'Sun outside view')+' · '+Math.round(sun.az)+'° true';
      skyStatus.setAttribute('x',c.w-12);skyStatus.setAttribute('y',c.h-93);
      if(key===arcView)return;arcView=key;
      const path=['',''];let last=null,mode=null;
      const xy=p=>p[0].toFixed(1)+' '+p[1].toFixed(1);
      for(const sample of data.samples){
        const pt=project(sample);
        if(!pt||pt[0]<-c.w||pt[0]>c.w*2||pt[1]<-c.h||pt[1]>c.h*2){last=null;mode=null;continue}
        const visible=sample.visible?1:0;
        if(last){if(mode!==visible)path[visible]+='M'+xy(last);path[visible]+='L'+xy(pt);mode=visible}
        last=pt;
      }
      back.setAttribute('d',path[1]);front.setAttribute('d',path[1]);hiddenPath.setAttribute('d',path[0]);
      const pt=project(data.end);contact.style.display=pt?'':'none';
      if(pt){contact.setAttribute('cx',pt[0]);contact.setAttribute('cy',pt[1])}
    }
    function draw(c,t,selected,observer=false,point=site){
      linework(c,t);for(const el of pins)el.hidden=true;
      if((!flags.sun&&!flags.sky&&!flags.sunPath)||t>=1.52||!Number.isFinite(selected)){arc.style.display='none';return}
      const p=position(selected,site),ev=events(selected,site);
      const local=(east,north,z)=>{const lon=site.lon+east/(111.32*Math.cos(site.lat*deg)),lat=site.lat+north/111.32;return geo(lon,lat,z??Math.max(0,elevation(lon,lat)||0)/1000+.05)};
      const originZ=Math.max(0,elevation(site.lon,site.lat)||0)/1000+.06,start=local(0,0,originZ);
      drawArc(c,t,selected,point||site);
      if(flags.sky&&track&&!(flags.sunPath&&track.body==='Sun')){
        const points=[],span=t<.57?9:30;
        const point=v=>local(span*Math.cos(v.alt*deg)*Math.sin(v.az*deg),span*Math.cos(v.alt*deg)*Math.cos(v.az*deg),originZ+span*Math.sin(v.alt*deg)/c.ve);
        const color=track.kind==='star'?[.79,.82,1]:track.kind==='planet'?[.55,.94,.82]:[1,.81,.45];
        for(let i=1;i<track.points.length;i++){let a=track.points[i-1],b=track.points[i];if(a.alt<0&&b.alt<0)continue;
          if(a.alt*b.alt<0){const f=-a.alt/(b.alt-a.alt),cross={alt:0,az:a.az+(((b.az-a.az+540)%360)-180)*f};if(a.alt<0)a=cross;else b=cross}
          points.push(point(a),point(b));
        }
        paint(points,color,.95,'LINES');
        if(track.now.alt>=0){
          const spot=point(track.now),pos=c.project(spot);
          if(pos){const radius=Math.max(.045,pos[2]*.006),arm=(i,sign)=>spot.map((v,k)=>v+c[i][k]*radius*sign);paint([arm('up',1),arm('up',-1),arm('right',1),arm('right',-1)],color,1,'LINES')}
        }
      }
      if(!flags.sun||flags.sunPath||observer||t>=.78)return;
      const fan=Array.from({length:65},(_,i)=>local(3*Math.sin(i*Math.PI/32),3*Math.cos(i*Math.PI/32)));
      paint(fan.slice(1).flatMap((v,i)=>[fan[i],v]),[.99,.85,.56],.68,'LINES');
      const span=t>.54?15:5;
      const routes=[[ev.rise,'Rise',[1,.75,.39]],[ev.set,'Set',[1,.55,.33]],[p,'Sun',[1,.91,.54]]];
      routes.forEach(([v,label,color],i)=>{
        if(i===2&&v.alt<=0)return;
        const a=v.az*deg,end= i===2?local(v.vec[0]*span,v.vec[1]*span,originZ+v.vec[2]*span):local(Math.sin(a)*span,Math.cos(a)*span);
        const pts=[start,end];
        if(i<2){pts.length=0;for(let n=0;n<16;n++){for(const f of [n/16,(n+.7)/16])pts.push(local(Math.sin(a)*span*f,Math.cos(a)*span*f))}}
        paint(pts,color,.94,'LINES');const s=c.project(end);
        if(s&&s[0]>35&&s[0]<c.w-35&&s[1]>55&&s[1]<c.h-65){const el=pins[i];el.hidden=false;el.style.left=s[0]+'px';el.style.top=s[1]+'px';el.textContent=label+' '+Math.round(i===2?v.alt:v.az)+'°'}
      });
    }
    return {setSunPath(value){flags.sunPath=value},get shadowBox(){return bx},draw,shadow,sample,sky,lighting,terrainSet,horizon,setTrack(value){track=value},get flags(){return flags},get time(){return time},
      set(next,stamp,point,invalidate){flags={...flags,...next};time=stamp;site=point||home;
        if((flags.roads||flags.rivers)&&!lines&&!loading){loading=true;
          fetch('observatory/map-lines.json').then(r=>{if(!r.ok)throw Error();return r.json()}).then(raw=>{
            lines=Object.fromEntries(Object.entries(raw).map(([k,ls])=>[k,ls.map(line=>line.map(p=>surface(...p)))]));invalidate();
          }).catch(()=>{}).finally(()=>{loading=false});
        }
      }};
  }
  return {position,events,card,scene,home};
})();
