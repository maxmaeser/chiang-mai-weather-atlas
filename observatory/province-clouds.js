/* Regional ICON band fractions, drawn on height-varying geographic surfaces. */
window.AtlasProvinceClouds=(()=>{
  'use strict';
  const url=new URL('context/province-clouds.json',document.currentScript.src);
  const bands=['low','mid','high'],pressures=[850,600,300],clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),mix=(a,b,t)=>a+(b-a)*t;
  const finite=Number.isFinite,format=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  let record=null,last=0,pending=null;
  function load(){
    if(record&&Date.now()-last<900000)return Promise.resolve(record);
    if(!pending)pending=fetch(url,{cache:'no-cache',signal:AbortSignal.timeout(12000)}).then(async r=>{
      if(!r.ok)throw Error('Province weather unavailable');
      const p=await r.json(),nodes=p.lons.length*p.lats.length;
      if(p.schema!==2||p.step!==3600||p.hours!==241||nodes!==168)throw Error('Unexpected provincial grid');
      const fields={};
      for(const [name,data] of Object.entries(p.fields)){
        const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)),rain=name==='precipitation';
        if(bytes.length!==nodes*p.hours*(rain?2:1))throw Error('Incomplete provincial weather grid');
        if(rain){const dv=new DataView(bytes.buffer);fields[name]=Uint16Array.from({length:nodes*p.hours},(_,i)=>dv.getUint16(i*2,true));}
        else fields[name]=bytes;
      }
      for(const key of ['precipitation','geopotential_height_800hPa','geopotential_height_400hPa',...bands.map(b=>'cloud_cover_'+b),...pressures.flatMap(p=>['geopotential_height_','relative_humidity_'].map(k=>k+p+'hPa'))])if(!fields[key])throw Error('Missing '+key);
      const rainHours=new Map();
      for(let hour=0;hour<p.hours;hour++){
        let best=-1,maximum=-1,wet=0,valid=0;
        for(let id=0;id<nodes;id++){
          const value=fields.precipitation[hour*nodes+id];
          if(value===65535)continue;
          valid++;if(value>=5)wet++;
          if(value>maximum){maximum=value;best=id}
        }
        if(best>=0){
          const time=p.start+hour*p.step;
          rainHours.set(time,{time,mm:maximum/100,wet,valid,lon:p.lons[best%p.lons.length],lat:p.lats[Math.floor(best/p.lons.length)]});
        }
      }
      record={...p,fields,rainHours};last=Date.now();return record;
    }).finally(()=>pending=null);
    return pending;
  }
  // Match the rain surface at a specific geographic point. A missing contributing
  // corner leaves the hour unavailable rather than borrowing a nearby storm.
  function wetHourNear(packet,lon,lat,{start=-Infinity,end=Infinity,around=Date.now()/1000}={}){
    const field=packet?.fields?.precipitation;
    if(!field||!finite(lon)||!finite(lat))return null;
    const {lons,lats}=packet,nx=lons.length,ny=lats.length;
    if(lon<lons[0]||lon>lons[nx-1]||lat<lats[0]||lat>lats[ny-1])return null;
    const i=Math.max(0,lons.findIndex(x=>x>=lon)-1),j=Math.max(0,lats.findIndex(y=>y>=lat)-1);
    const x=(lon-lons[i])/(lons[i+1]-lons[i]),y=(lat-lats[j])/(lats[j+1]-lats[j]),p=j*nx+i;
    const corners=[[p,(1-x)*(1-y)],[p+1,x*(1-y)],[p+nx,(1-x)*y],[p+nx+1,x*y]].filter(([,weight])=>weight>0);
    let best=null;
    for(let hour=0;hour<packet.hours;hour++){
      const time=packet.start+hour*packet.step;
      if(time<start||time>end)continue;
      let sum=0;
      for(const [id,weight] of corners){
        const raw=field[hour*nx*ny+id];
        if(!finite(raw)||raw===65535){sum=NaN;break}
        sum+=raw*weight;
      }
      const mm=sum/100;
      if(mm>=.05&&(!best||mm>best.mm||mm===best.mm&&Math.abs(time-around)<Math.abs(best.time-around)))best={time,mm,lon,lat,local:true};
    }
    return best;
  }
  function hash(x,y){let h=Math.imul(x,1597334677)^Math.imul(y,3812015801);h=Math.imul(h^(h>>>16),2246822507);return ((h^(h>>>13))>>>0)/4294967295;}
  function noise(x,y){
    const i=Math.floor(x),j=Math.floor(y),a=x-i,b=y-j,u=a*a*(3-2*a),v=b*b*(3-2*b);
    return mix(mix(hash(i,j),hash(i+1,j),u),mix(hash(i,j+1),hash(i+1,j+1),u),v);
  }
  function create(queue){
    let data=null,requestAt=0,fetching=false,key='',meshes=[],available=0,report='',lastTime=null,gap=false,active=false,readyAt=null,weight=0;
    function refresh(){
      if(fetching||Date.now()-requestAt< (data?900000:60000))return;
      requestAt=Date.now();fetching=true;
      load().then(f=>{if(data!==f){data=f;key='';queue()}}).catch(()=>{gap=true;queue()}).finally(()=>fetching=false);
    }
    function frame(time,geo,elevation,style,samples){
      meshes=[];available=0;lastTime=time;
      const n=data?.lons.length||0,m=data?.lats.length||0,idx=data?(time-data.start)/3600:-1;
      if(!Number.isInteger(idx)||idx<0||idx>=data.hours){report='No provincial grid for this hour. Only available profile samples are shown.';return}
      const off=idx*n*m;
      // Nearest detailed *sample*, including dry cells: regional data never
      // fills a locally-supported clear area simply because it has no volume.
      const support=new Float32Array(192*192);
      for(let y=0;y<192;y++)for(let x=0;x<192;x++){
        const lon=mix(data.lons[0],data.lons[n-1],x/191),lat=mix(data.lats[m-1],data.lats[0],y/191);
        let d2=Infinity;for(const [lo,la] of samples){const dx=(lon-lo)*105.2,dy=(lat-la)*111.2;d2=Math.min(d2,dx*dx+dy*dy)}
        const u=clamp((Math.sqrt(d2)-6)/17,0,1);support[y*192+x]=u*u*(3-2*u);
      }
      function node(key,i,j){const v=data.fields[key][off+j*n+i];return v===255?NaN:v}
      for(const [bi,b] of bands.entries()){
        const field='cloud_cover_'+b,p=pressures[bi],w=192,h=192;
        const alt=[],amount=[],rh=[],lower=bi===0?null:'geopotential_height_'+(bi===1?800:400)+'hPa';
        let valid=0,cloudy=0;
        for(let j=0;j<m;j++)for(let i=0;i<n;i++){
          const cover=node(field,i,j),v=node('relative_humidity_'+p+'hPa',i,j),z=node('geopotential_height_'+p+'hPa',i,j)*100;
          const ground=elevation(data.lons[i],data.lats[j])||0;
          const base=lower?node(lower,i,j)*100:ground;
          // Without a moist sample, place the coverage symbol on its band's lower boundary.
          const supported=finite(v)&&v>=70&&finite(z)&&z>ground;
          alt.push(supported?z:Math.max(ground+45,base));amount.push(cover);rh.push(v);
          if(finite(cover)){valid++;if(cover>0)cloudy++}
        }
        available+=valid;
        if(!valid||!cloudy)continue;
        const image=document.createElement('canvas');image.width=w;image.height=h;
        const ctx=image.getContext('2d'),pixels=ctx.createImageData(w,h);
        function interp(arr,x,y){
          const i=Math.min(n-2,Math.floor(x)),j=Math.min(m-2,Math.floor(y)),u=x-i,v=y-j,k=j*n+i;
          return mix(mix(arr[k],arr[k+1],u),mix(arr[k+n],arr[k+n+1],u),v);
        }
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){
          const sx=x/(w-1)*(n-1),sy=(1-y/(h-1))*(m-1),cover=interp(amount,sx,sy)/100;
          if(!(cover>.005))continue;
          const u=sx+(bi+1)*21,v=sy+(bi+2)*17;
          // Broad middle decks, small low-level patches and elongated high-level texture.
          const gx=bi===2?u*.56:bi===0?u*1.2:u,gy=bi===2?v*2.3:bi===1?v*.78:v;
          const grain=.47*noise(gx*1.5,gy*1.6)+.29*noise(gx*4.8,gy*4.1)+.16*noise(gx*10,gy*8.8)+.08*noise(gx*24,gy*23);
          const density=clamp((grain-.69+.78*cover)*3.4,0,1),edgeDistance=Math.min(sx,sy,n-1-sx,m-1-sy),edgeRamp=clamp((edgeDistance-.12+.30*(noise(u*.82,v*.90)-.5))/1.15,0,1),edge=edgeRamp*edgeRamp*(3-2*edgeRamp);
          const alpha=edge*(.10*cover+density*(.29+.55*cover));
          const k=(y*w+x)*4,shade=clamp(.81+grain*.25,0,1);
          let tint=style==='height'?[[188,233,218],[250,222,176],[212,206,246]][bi]:[239,244,247];
          if(style==='humidity'){
            const humidity=interp(rh,sx,sy);
            if(finite(humidity)){const f=clamp((humidity-70)/30,0,1);tint=[mix(232,124,f),mix(243,187,f),mix(247,235,f)]}
          }
          for(let c=0;c<3;c++)pixels.data[k+c]=shade*tint[c];pixels.data[k+3]=Math.round(255*alpha);
        }
        ctx.putImageData(pixels,0,0);
        const points=[],uv=[];
        // Reuse every second native node for geometry, while texture uses every sample.
        const xs=[0,2,4,6,8,10,n-1],ys=[0,2,4,6,8,10,12,m-1];
        const vertex=(i,j)=>[geo(data.lons[i],data.lats[j],alt[j*n+i]/1000),[i/(n-1),1-j/(m-1)]];
        for(let j=0;j<ys.length-1;j++)for(let i=0;i<xs.length-1;i++){
          const coords=[[xs[i],ys[j]],[xs[i+1],ys[j]],[xs[i+1],ys[j+1]],[xs[i],ys[j+1]]];
          if(coords.some(([x,y])=>!finite(alt[y*n+x])))continue;
          const quad=coords.map(c=>vertex(...c));for(const k of [0,1,2,0,2,3]){points.push(quad[k][0]);uv.push(quad[k][1]);}
        }
        const outer=document.createElement('canvas');outer.width=w;outer.height=h;
        for(let i=0;i<w*h;i++)pixels.data[4*i+3]*=support[i];
        outer.getContext('2d').putImageData(pixels,0,0);
        meshes.push({b,image,outer,points,uv});
      }
      report=available?'ICON provincial cloud cover · '+format.format(time*1000)+' ICT. Interpolated between 0.25° samples. Moist pressure samples locate height; other coverage is drawn at its band boundary.':'Province grid has no valid cloud samples for this hour.';
    }
    function draw({time,allow,geo,elevation,style,mask,band,opacity,outerOpacity=0,samples=[],drawTexture}){
      active=false;
      if(!allow){readyAt=null;weight=0;report='Showing current reference cells. The provincial grid is available in Saved replay.';return false}
      refresh();
      if(!data){readyAt=null;weight=0;report=gap?'Provincial grid unavailable; showing available local samples.':'Loading provincial cloud grid.';return false}
      const signature=[data.retrieved,time,style,samples.join(';')].join('/');
      if(signature!==key){key=signature;frame(time,geo,elevation,style,samples)}
      if(!available){readyAt=null;weight=0;return false}
      const now=performance.now();readyAt??=now;
      const f=clamp((now-readyAt)/380,0,1);weight=f*f*(3-2*f);
      if(f<1)queue();
      active=true;
      for(const m of meshes)if(mask[m.b]&&(band==='all'||band===m.b)){
        if(outerOpacity>.002)drawTexture(m,clamp(outerOpacity*weight*.74,0,1),true);
        if(opacity>.002)drawTexture(m,clamp(opacity*weight*.74,0,1),false);
      }
      return true;
    }
    return {draw,get weight(){return weight},get report(){return report},get valid(){return active?lastTime:null},get bands(){return active?meshes.map(m=>m.b):[]}};
  }
  return {create,load,wetHourNear};
})();
