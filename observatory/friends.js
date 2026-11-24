(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const timeFormat = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const dayFormat = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',day:'numeric',month:'short'});
  const clockFormat = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const stamp = t => timeFormat.format(t*1000);
  const city = {lon:98.985,lat:18.79};
  const crag = AtlasCragTerrain.landmarks.find(x => x.key === 'crag');
  const liveSites=[
    {name:'Chiang Mai Old City',lat:18.79,lon:98.985},
    {name:'Doi Suthep',lat:18.81661,lon:98.89236},
    {name:'Crazy Horse Buttress',lat:18.78223,lon:99.23691}
  ];
  const liveLevels=[925,850,700,500,300];
  const liveFields=['temperature_2m','wind_speed_10m','precipitation','surface_pressure','cloud_cover_low','cloud_cover_mid','cloud_cover_high',
    ...liveLevels.flatMap(p=>['geopotential_height','relative_humidity','wind_speed','wind_direction','temperature'].map(f=>f+'_'+p+'hPa'))];
  const query=new URLSearchParams(location.search);
  const packets={live:null,replay:null};
  let wanted=query.get('weather')==='replay'?'replay':'live', mode=null, request=null, providerMessage='', replayFailed=false;
  let place='window', packet, times, index=0, solarMinute=null, timer=null, house;
  function attachment(){
    try{return window.parent!==window&&Boolean(window.parent.atlasAttachment)}catch{return false}
  }
  const portable=attachment();
  const world=AtlasWorld.mount(el('orbit'),{initialView:'terrain',onPlace:pickPlace,onScaleChange:scale=>{
    if(scale!=='window'&&house?.active)house.deactivate();
    if(scale!=='window'||!['crag','house'].includes(place))place=scale;
    if(scale==='window')el('systems').value='terrain';
    markPlaces();applyLayers();
  }});
  house=AtlasHouse.mount({world,panel:el('house-panel'),onFocus(){
    place='house';el('systems').value='terrain';markPlaces();applyLayers();readHouse();
  },onLeave(){pickPlace('window')}});
  const houseSample=document.createElement('section');
  houseSample.className='live-house';
  const houseTitle=document.createElement('h3'),houseReport=document.createElement('p');
  houseTitle.textContent='Nearest published forecast cell';
  houseSample.append(houseTitle,houseReport);el('house-panel').append(houseSample);
  function readHouse(){
    if(mode!=='live'||!house?.active||!packet)return;
    const point=house.point,rad=Math.PI/180;
    const distances=packet.rows.map(r=>{
      const dy=(r.latitude-point.lat)*rad,dx=(r.longitude-point.lon)*rad;
      return 12742*Math.asin(Math.sqrt(Math.sin(dy/2)**2+Math.cos(r.latitude*rad)*Math.cos(point.lat*rad)*Math.sin(dx/2)**2));
    });
    const i=distances.indexOf(Math.min(...distances)),row=packet.rows[i],h=row.hourly;
    const show=(v,unit)=>Number.isFinite(v)?v+unit:'unavailable';
    houseReport.textContent=liveSites[i].name+' reference · '+distances[i].toFixed(1)+' km from your pin · '+stamp(times[index])+' ICT. Model cell: low cloud '+show(h.cloud_cover_low[index],'%')+', wind '+show(h.wind_speed_10m[index],' km/h')+', previous hour '+show(h.precipitation[index],' mm rain')+'.';
  }
  function markPlaces(){
    document.querySelectorAll('[data-place]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.place===place)));
    el('my-house').setAttribute('aria-pressed',String(place==='house'));
  }
  function pickPlace(id){
    if(id==='house'){house.visit();return}
    house?.deactivate();world.setLandmark(null);place=id;
    if(id==='crag')world.setLandmark('crag');else world.setScale(id);
    if(id==='window'||id==='crag')el('systems').value='terrain';
    markPlaces();applyLayers();
  }
  document.querySelectorAll('[data-place]').forEach(b=>b.onclick=()=>pickPlace(b.dataset.place));
  el('my-house').onclick=()=>house.visit();
  function focus(){return place==='house'&&house.point?house.point:place==='crag'?crag:city}
  function solarTime(){
    if(!times)return null;
    const t=times[index], day=Math.floor((t+7*3600)/86400)*86400-7*3600;
    return solarMinute===null?t:day+solarMinute*60;
  }
  function applySun(){
    const t=solarTime();if(t===null)return;
    const point=focus();
    world.setSolarLayers({sun:true,sky:true,sunPath:el('sunPath').checked,shadows:el('shadows').checked,roads:el('roads').checked,rivers:el('rivers').checked},t,point);
    el('minute').value=(Math.floor(t/60)+420)%1440;
    el('solar-at').textContent=clockFormat.format(t*1000)+' ICT';
    el('solar-site').textContent='Solar position from '+(place==='house'?'your pin':place==='crag'?'Crazy Horse Buttress':'Chiang Mai Old City')+'.';
  }
  function applyLayers(){
    const layers={};
    for(const k of ['cloud','wind','localRain','labels','sunPath'])layers[k]=el(k).checked;
    if(mode==='live')layers.localRain=false;
    world.setMapLayers({...layers,precip:el('systems').value==='precip',eyewitness:false});
    world.setCloudBand(el('band').value);
    world.setWeatherMode(el('systems').value==='terrain'?'terrain':'systems');
    if(el('systems').value!=='terrain')world.setSystemLayer(el('systems').value);
    world.setGesture(el('gesture').value);applySun();
  }
  for(const id of ['cloud','wind','localRain','sunPath','shadows','roads','rivers','labels','band','gesture'])el(id).onchange=applyLayers;
  el('systems').onchange=()=>{
    if(el('systems').value!=='terrain'&&['window','crag','house'].includes(place))pickPlace('region');
    applyLayers();
  };
  el('minute').oninput=()=>{stop();solarMinute=+el('minute').value;applySun();world.keepSunInView(solarTime())};
  el('solar-reset').onclick=()=>{solarMinute=null;applySun();world.keepSunInView(solarTime())};
  el('sunset').onclick=()=>{
    if(!times)return;
    const point=focus(),previousPlace=place;
    const event=world.faceSunset(point,solarTime());
    if(previousPlace==='house')place='house';
    const t=event.time;solarMinute=(Math.floor(t/60)+420)%1440;el('sunPath').checked=true;applyLayers();markPlaces();
  };
  el('recenter').onclick=()=>{if(place==='house')house.visit();else pickPlace(place)};
  const levels=[1000,975,950,925,900,850,800,700,600,500,400,300,250,200];
  function column(row,i){
    const h=row.hourly,g=(key)=>h[key]?.[i]??null, layers=[];
    for(const p of levels){
      const get=field=>g(field+'_'+p+'hPa');
      const l={pressure:p,height:get('geopotential_height'),rh:get('relative_humidity'),wind:get('wind_speed'),dir:get('wind_direction'),temp:get('temperature')};
      if(l.height>row.elevation&&p<g('surface_pressure')&&[l.rh,l.wind,l.dir].every(Number.isFinite))layers.push(l);
    }
    const id=row.latitude+','+row.longitude;
    return {name:'ICON cell '+id,lat:row.latitude,lon:row.longitude,ground:row.elevation,modelGround:row.elevation,gridId:id,layers,
      cloud:{low:g('cloud_cover_low'),mid:g('cloud_cover_mid'),high:g('cloud_cover_high')}};
  }
  function stationReport(t){
    if(mode==='live'){el('airport').textContent='Airport observations are available in Saved replay.';return}
    const report=packet.station.findLast(s=>s.time<=t&&t-s.time<3600);
    el('airport').textContent=report?'VTCC · '+clockFormat.format(report.time*1000)+' ICT · '+report.raw:'VTCC · No archived airport report within the preceding hour.';
  }
  function readCell(){
    if(!packet)return;
    const r=packet.rows[+el('cell').value], h=r.hourly;
    const show=(v,s)=>Number.isFinite(v)?v+s:'unavailable';
    el('cell-report').textContent='Model ground '+r.elevation+' m · '+show(h.temperature_2m[index],' °C')+' · wind '+show(h.wind_speed_10m[index],' km/h')+' · previous hour '+show(h.precipitation?.[index],' mm rain')+'.';
  }
  function render(){
    const t=times[index], rows=packet.rows.map(r=>column(r,index));
    const regional=packet.frames?.reduce((a,b)=>!a||Math.abs(a.time-t)>Math.abs(b.time-t)?b:a,null);
    const frame=regional&&Math.abs(regional.time-t)<=10800?regional:null;
    world.update({time:t,columns:rows,level:+el('level').value,provinceModel:mode==='replay',imagery:{planet:frame}});
    house.update(t,{archived:mode!=='replay'});readHouse();el('weather-hour').value=index;
    el('valid').textContent=stamp(t);
    el('regional-time').textContent=frame?'GFS frame '+stamp(frame.time)+' ICT · run '+stamp(frame.run)+' ICT.':mode==='live'?'Regional charts and province-wide rain are available in Saved replay. Current weather covers three public ICON reference points.':'Regional frame unavailable at this hour.';
    el('previous').disabled=index===0;el('next').disabled=index===times.length-1;
    applySun();stationReport(t);readCell();
  }
  function stop(){clearInterval(timer);timer=null;el('play').textContent='Play';el('play').setAttribute('aria-pressed','false')}
  function seek(i){if(!times)return;index=Math.min(times.length-1,Math.max(0,i));solarMinute=null;render()}
  el('level').onchange=()=>{if(times)render()};el('cell').onchange=readCell;
  el('previous').onclick=()=>{stop();seek(index-1)};el('next').onclick=()=>{stop();seek(index+1)};
  el('weather-hour').oninput=()=>{stop();seek(+el('weather-hour').value)};
  el('play').onclick=()=>{
    if(timer||!times){stop();return}
    if(index===times.length-1)seek(0);
    el('play').textContent='Pause';el('play').setAttribute('aria-pressed','true');
    timer=setInterval(()=>{if(index===times.length-1)stop();else seek(index+1)},1200);
  };
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});
  AtlasRainMarks.mount(world,{onFind:sample=>{
    if(!times)return;
    const i=times.indexOf(sample.time);if(i<0)return;
    stop();seek(i);if(!sample.local){pickPlace('province');world.focusProvincePoint(sample.lon,sample.lat)}
  }});
  function activate(next){
    const data=packets[next];if(!data)return;
    stop();mode=next;document.body.dataset.weatherMode=next;packet=data;times=data.rows[0].hourly.time;
    el('cell').replaceChildren(...data.rows.map((r,i)=>new Option((next==='live'?liveSites[i].name+' · ':'')+r.latitude.toFixed(3)+'° N · '+r.longitude.toFixed(3)+'° E',String(i))));
    el('weather-hour').max=times.length-1;el('weather-hour').disabled=false;
    el('from').textContent=dayFormat.format(times[0]*1000);el('to').textContent=dayFormat.format(times.at(-1)*1000);
    el('archive-info').textContent=(next==='live'?'Current DWD ICON forecast through ':'Saved ICON weather through ')+stamp(times.at(-1))+' ICT. Retrieved '+stamp(data.retrieved)+' ICT.';
    el('weather-source').value=next;
    el('systems').disabled=el('localRain').disabled=next==='live';
    if(next==='live'){el('systems').value='terrain';el('localRain').checked=false}
    const target=next==='live'?Math.floor(Date.now()/3600000)*3600:data.cutoff;
    seek(Math.max(0,times.indexOf(target)));applyLayers();
  }
  function report(){
    const showing=mode==='replay'?' Showing saved replay.':mode==='live'?' Showing the previously retrieved forecast.':'';
    let message;
    if(wanted==='replay')message=mode==='replay'?'Saved replay · November 2026':replayFailed?'Saved replay unavailable.':'Loading saved replay…';
    else if(request)message='Checking the current forecast…'+showing;
    else if(providerMessage)message=providerMessage+showing;
    else if(mode==='live')message='Current forecast · DWD ICON Global via Open-Meteo';
    else message=replayFailed?'Weather unavailable.':'Loading weather…';
    el('weather-status').textContent=message;
    el('weather-source').value=request&&wanted==='live'?'live':mode||wanted;
    if(!packet&&!request&&replayFailed)el('valid').textContent='Weather unavailable.';
    el('refresh-weather').disabled=Boolean(request)||portable;
  }
  function verifyRows(rows,now){
    if(!Array.isArray(rows)||rows.length!==liveSites.length)throw Error('Invalid forecast.');
    const timeline=rows[0]?.hourly?.time,current=Math.floor(now/3600)*3600;
    if(!Array.isArray(timeline)||timeline.length<12||timeline.length>100||
       !timeline.includes(current)||timeline.at(-1)<current+6*3600||
       timeline.some((t,i)=>!Number.isSafeInteger(t)||(i>0&&t-timeline[i-1]!==3600)))throw Error('Forecast does not cover the current hour.');
    for(const [i,r] of rows.entries()){
      if(![r?.latitude,r?.longitude,r?.elevation].every(Number.isFinite)||
         Math.abs(r.latitude-liveSites[i].lat)>.35||Math.abs(r.longitude-liveSites[i].lon)>.35||
         !Array.isArray(r.hourly?.time)||r.hourly.time.length!==timeline.length||r.hourly.time.some((t,j)=>t!==timeline[j]))throw Error('Invalid model cell.');
      for(const key of liveFields){
        const values=r.hourly[key];
        if(!Array.isArray(values)||values.length!==timeline.length||values.some(v=>v!==null&&!Number.isFinite(v)))throw Error('Incomplete forecast.');
      }
      if(!Number.isFinite(r.hourly.temperature_2m[timeline.indexOf(current)]))throw Error('Current forecast unavailable.');
    }
    return {rows,retrieved:now};
  }
  async function refresh(){
    wanted='live';
    if(request){report();return}
    if(portable||!navigator.onLine){
      providerMessage=portable?'Offline attachment.':'Network offline.';
      if(packets.replay)activate('replay');report();return;
    }
    const p=new URLSearchParams({latitude:liveSites.map(s=>s.lat).join(','),longitude:liveSites.map(s=>s.lon).join(','),
      models:'icon_global',cell_selection:'nearest',elevation:'nan,nan,nan',past_hours:'6',forecast_hours:'48',
      timeformat:'unixtime',timezone:'GMT',hourly:liveFields.join(',')});
    request=new AbortController();providerMessage='';report();
    const timeout=setTimeout(()=>request?.abort(),9000);
    try{
      const response=await fetch('https://api.open-meteo.com/v1/forecast?'+p,{
        signal:request.signal,mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store'});
      if(response.status===429){providerMessage='Open-Meteo request limit reached.';return}
      if(!response.ok)throw Error('Forecast unavailable.');
      const raw=await response.text();
      if(raw.length>950000)throw Error('Invalid response.');
      packets.live=verifyRows(JSON.parse(raw),Math.floor(Date.now()/1000));
      if(wanted==='live')activate('live');
    }catch(e){
      providerMessage=e.name==='AbortError'?'Forecast request timed out.':'Current forecast unavailable.';
    }finally{
      clearTimeout(timeout);request=null;
      if(wanted==='live'&&!packets.live&&packets.replay&&mode!=='replay')activate('replay');
      report();
    }
  }
  el('refresh-weather').onclick=refresh;
  el('weather-source').onchange=()=>{
    wanted=el('weather-source').value;providerMessage='';
    if(wanted==='replay'){if(packets.replay)activate('replay');report()}
    else if(packets.live){activate('live');report()}else refresh();
  };
  const route=query.get('view');
  if(['crag','province','region','global'].includes(route))pickPlace(route);
  markPlaces();applyLayers();
  fetch('observatory/weather.json').then(r=>{if(!r.ok)throw Error();return r.json()}).then(data=>{
    packets.replay=data;if(wanted==='replay'||!packets.live){
      activate('replay');
      if(wanted==='replay'&&query.get('chart')==='composite'&&place==='region'){el('systems').value='composite';applyLayers()}
    }
    report();
  }).catch(()=>{replayFailed=true;report()});
  if(wanted==='live')refresh();else report();
})();
