// The picker uses two georeferenced atlas images. Pin coordinates stay on this origin.
window.AtlasHouse = (() => {
  'use strict';
  const assets = new URL('.', document.currentScript.src);
  const storageKey = 'chiang-mai-atlas.house-pin.v1';
  const province = [97.35, 17.05, 100.55, 20.45];
  const basin = [98.53, 18.49, 99.27, 19.16];
  const city = {lat:18.79, lon:98.99};
  const landmarks = [
    ['Old City', 98.987, 18.788], ['Airport', 98.963, 18.767],
    ['Doi Suthep', 98.89236, 18.816608], ['Doi Saket', 99.14, 18.87],
    ['Samoeng', 98.73, 18.85], ['Crazy Horse', 99.23691, 18.78223],
    ['Fang', 99.21, 19.92], ['Lamphun', 99.01, 18.58],
  ];
  const stamp = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Bangkok',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
  const contains = (p, b) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon)
    && p.lon>=b[0] && p.lon<=b[2] && p.lat>=b[1] && p.lat<=b[3];
  const pair = p => p.lat.toFixed(5)+', '+p.lon.toFixed(5);
  function parse(text) {
    const m = text.trim().match(/^([+-]?\d{1,3}(?:\.\d+)?)\s*(?:,\s*|\s+)([+-]?\d{1,3}(?:\.\d+)?)$/);
    return m ? {lat:Number(m[1]),lon:Number(m[2])} : null;
  }
  function readPin() {
    try {
      const p = JSON.parse(localStorage.getItem(storageKey));
      return contains(p,province) ? {lat:p.lat,lon:p.lon} : null;
    } catch {return null}
  }
  function nearestSample(grid,p,time) {
    const {lons,lats} = grid;
    if (!contains(p,[lons[0],lats[0],lons.at(-1),lats.at(-1)])) return null;
    const hour = (time-grid.start)/grid.step;
    if (!Number.isInteger(hour) || hour<0 || hour>=grid.hours) return null;
    const nearest = (axis,n) => axis.reduce((best,v,i)=>Math.abs(v-n)<Math.abs(axis[best]-n)?i:best,0);
    const x = nearest(lons,p.lon), y = nearest(lats,p.lat), lon = lons[x], lat = lats[y];
    const id = (hour*lats.length+y)*lons.length+x;
    const rad = Math.PI/180;
    const km = 12742*Math.asin(Math.sqrt(Math.sin((lat-p.lat)*rad/2)**2+
      Math.cos(lat*rad)*Math.cos(p.lat*rad)*Math.sin((lon-p.lon)*rad/2)**2));
    const read = (key,missing,factor=1) => {
      const raw = grid.fields[key]?.[id];
      return Number.isFinite(raw) && raw!==missing ? raw/factor : null;
    };
    return {lon,lat,km,low:read('cloud_cover_low',255),mid:read('cloud_cover_mid',255),
      high:read('cloud_cover_high',255),rain:read('precipitation',65535,100)};
  }

  function mount({world,panel,onFocus,onLeave}) {
    let point=readPin(),active=false,archived=false,time=null,grid=null,request=null,lastRequest=0,loadError=false;
    let candidate=null,center={...city},span=.32,drag=null,focusReturn=null,storageNote='',stored=!!point;
    let locationRequest=null;
    panel.classList.add('house-readout');
    panel.hidden=true;
    panel.innerHTML=`<h2>My location</h2><p data-location></p><div class="house-actions">
      <button type="button" data-return>Return to pin</button><button type="button" data-edit>Change pin</button>
      <button type="button" data-forget>Forget pin</button></div>
      <p data-storage role="status" hidden></p><h3>Nearby weather</h3><p data-source></p>
      <dl class="house-metrics" hidden></dl>`;
    const dialog=document.createElement('dialog');
    dialog.className='house-editor';
    dialog.setAttribute('aria-labelledby','house-picker-title');
    dialog.innerHTML=`<div class="house-heading"><div><h2 id="house-picker-title">Your map pin</h2><p>Your pin stays in this browser.</p></div>
      <button type="button" data-close aria-label="Close pin editor" autofocus>×</button></div>
      <div class="house-choices">
      <button type="button" data-geolocate><span class="house-target" aria-hidden="true"></span><span>Use my location</span></button>
      <div class="house-map-group"><p>Tap to place a pin. Drag to move the map.</p>
      <div class="house-map" role="group" aria-label="Satellite map around Chiang Mai">
        <img data-province alt="" draggable="false"><img data-basin alt="" draggable="false"><div data-labels aria-hidden="true"></div>
        <i class="house-marker" hidden></i><span class="house-north" aria-hidden="true">↑ N</span>
        <div class="house-zoom"><button type="button" data-in aria-label="Zoom in on map">+</button><button type="button" data-out aria-label="Zoom out on map">−</button></div>
        <small>Sentinel-2 cloudless 2024 · EOX / Copernicus</small></div></div>
      <label>Latitude, longitude<input type="text" data-coords autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" aria-describedby="house-picker-message" placeholder="18.79000, 98.99000"></label>
      </div><div class="house-footer"><p id="house-picker-message" data-message role="status" aria-atomic="true"></p><button type="button" data-save>Save pin</button></div>`;
    const find=(root,selector)=>root.querySelector(selector);
    const d=s=>find(dialog,s), q=s=>find(panel,s);
    const map=d('.house-map'),input=d('[data-coords]'),save=d('[data-save]'),pin=d('.house-marker');
    const locate=d('[data-geolocate]'),message=d('[data-message]');
    const labelNodes=landmarks.map(([label,lon,lat])=>{
      const node=document.createElement('span');node.textContent=label;d('[data-labels]').append(node);
      return {node,lon,lat};
    });
    function bounds(){
      const w=map.clientWidth||380,h=map.clientHeight||260;
      const rise=span*h/w*Math.cos(center.lat*Math.PI/180);
      const fit=(value,min,max,half)=>max-min<half*2?(max+min)/2:clamp(value,min+half,max-half);
      center.lon=fit(center.lon,province[0],province[2],span/2);
      center.lat=fit(center.lat,province[1],province[3],rise/2);
      return [center.lon-span/2,center.lat-rise/2,center.lon+span/2,center.lat+rise/2];
    }
    function renderMap() {
      if(!dialog.open)return;
      const b=bounds(),width=b[2]-b[0],height=b[3]-b[1];
      const pos=(el,lon,lat)=>{el.style.left=(100*(lon-b[0])/width)+'%';el.style.top=(100*(b[3]-lat)/height)+'%'};
      for(const [selector,box] of [['[data-province]',province],['[data-basin]',basin]]){
        const img=d(selector);pos(img,box[0],box[3]);
        img.style.width=(100*(box[2]-box[0])/width)+'%';img.style.height=(100*(box[3]-box[1])/height)+'%';
      }
      const shown=[];
      for(const v of labelNodes){
        const x=(v.lon-b[0])/width*map.clientWidth, y=(b[3]-v.lat)/height*map.clientHeight;
        v.node.hidden=!contains(v,b)||shown.some(([px,py])=>Math.abs(px-x)<69&&Math.abs(py-y)<20);
        if(!v.node.hidden){pos(v.node,v.lon,v.lat);shown.push([x,y])}
      }
      pin.hidden=!contains(candidate,b);
      if(!pin.hidden)pos(pin,candidate.lon,candidate.lat);
      d('[data-in]').disabled=span<=.025;d('[data-out]').disabled=span>=province[2]-province[0];
    }
    function endLocationRequest() {
      if(!locationRequest)return;
      clearTimeout(locationRequest.timer);
      locationRequest=null;
      locate.removeAttribute('aria-busy');
      locate.removeAttribute('aria-disabled');
      locate.lastElementChild.textContent='Use my location';
      save.disabled=!candidate;
    }
    function setCandidate(p,writeInput) {
      endLocationRequest();
      candidate=contains(p,province)?p:null;save.disabled=!candidate;
      if(writeInput&&candidate)input.value=pair(candidate);
      input.setAttribute('aria-invalid',String(!!input.value&&!candidate));
      message.textContent=candidate?'Pin selected. Save when ready.':!input.value?'Choose a location or paste coordinates.':
        p?'Choose a point inside the Chiang Mai atlas area.':'Enter latitude first, then longitude, as two decimal numbers.';
      if(candidate&&!writeInput&&!contains(candidate,bounds()))center={...candidate};
      renderMap();
    }
    locate.onclick=()=>{
      if(locationRequest||!dialog.open)return;
      const manual='Tap the map or paste coordinates.';
      if(!window.isSecureContext){message.textContent='Device location needs a secure page. '+manual;return}
      if(!navigator.geolocation){message.textContent='Device location is unavailable. '+manual;return}
      const lookup={};
      locationRequest=lookup;
      locate.setAttribute('aria-busy','true');
      locate.setAttribute('aria-disabled','true');
      locate.lastElementChild.textContent='Locating…';
      save.disabled=true;
      message.textContent='Waiting for your device. You can still place a pin manually.';
      function fail(code) {
        if(locationRequest!==lookup||!dialog.open)return;
        endLocationRequest();
        const reason=code===1?'Location access was denied.':code===3?'Location request timed out.':'Your device could not find a location.';
        message.textContent=reason+' '+manual;
      }
      // The native timeout may exclude time spent waiting for permission.
      lookup.timer=setTimeout(()=>fail(3),18000);
      try{
        navigator.geolocation.getCurrentPosition(({coords})=>{
          if(locationRequest!==lookup||!dialog.open)return;
          endLocationRequest();
          const p={lat:coords.latitude,lon:coords.longitude};
          if(!contains(p,province)){message.textContent='Your device is outside the Chiang Mai map. '+manual;return}
          center={...p};span=.15;
          setCandidate({lat:Number(p.lat.toFixed(5)),lon:Number(p.lon.toFixed(5))},true);
          const meters=coords.accuracy;
          const accuracy=Number.isFinite(meters)&&meters>0 ? ' (±'+(meters<1000?Math.ceil(meters)+' m':(meters/1000).toFixed(1)+' km')+')' : '';
          message.textContent='Location found'+accuracy+'. Check the pin, then save.';
        },error=>fail(error.code),{enableHighAccuracy:true,maximumAge:30000,timeout:12000});
      }catch{fail(2)}
    };
    function zoom(factor) {
      span=clamp(span*factor,.025,province[2]-province[0]);renderMap();
    }
    d('[data-in]').onclick=()=>zoom(.55);d('[data-out]').onclick=()=>zoom(1/.55);
    map.onpointerdown=e=>{
      if(e.button!==0||e.target.closest('button')||drag)return;
      if(locationRequest)setCandidate(parse(input.value),false);
      drag={id:e.pointerId,x:e.clientX,y:e.clientY,center:{...center},bounds:bounds(),moved:false};
      map.setPointerCapture(e.pointerId);
    };
    map.onpointermove=e=>{
      if(!drag||e.pointerId!==drag.id)return;
      const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
      if(!drag.moved&&Math.hypot(dx,dy)<5)return;
      drag.moved=true;center.lon=drag.center.lon-dx/map.clientWidth*span;
      center.lat=drag.center.lat+dy/map.clientHeight*(drag.bounds[3]-drag.bounds[1]);renderMap();
    };
    map.onpointerup=e=>{
      if(!drag||e.pointerId!==drag.id)return;
      const click=!drag.moved;drag=null;if(!click)return;
      const r=map.getBoundingClientRect(),b=bounds();
      const lon=b[0]+(e.clientX-r.left)/r.width*(b[2]-b[0]),lat=b[3]-(e.clientY-r.top)/r.height*(b[3]-b[1]);
      setCandidate({lat:Number(lat.toFixed(5)),lon:Number(lon.toFixed(5))},true);
    };
    map.onpointercancel=()=>{drag=null};map.onlostpointercapture=()=>{drag=null};
    input.oninput=()=>setCandidate(parse(input.value),false);
    input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();if(save.disabled)input.blur();else save.focus()}};
    const mapResize=new ResizeObserver(renderMap);mapResize.observe(map);
    const viewport=window.visualViewport;
    function fitViewport() {
      if(!dialog.open||!viewport)return;
      dialog.style.setProperty('--house-height',viewport.height+'px');
      dialog.style.setProperty('--house-top',viewport.offsetTop+'px');
    }
    viewport?.addEventListener('resize',fitViewport);
    viewport?.addEventListener('scroll',fitViewport);
    function edit() {
      if(dialog.open)return;
      focusReturn=document.activeElement;
      (document.fullscreenElement||document.body).append(dialog);
      if(!d('[data-basin]').hasAttribute('src')){
        d('[data-province]').src=new URL('world-highlands.jpg',assets).href;
        d('[data-basin]').src=new URL('world-basin.jpg',assets).href;
      }
      center={...(point||city)};span=point ? .15 : .32;
      drag=null;input.value=point?pair(point):'';
      dialog.showModal();fitViewport();d('.house-choices').scrollTop=0;
      setCandidate(point,false);
      if(point)message.textContent='Your saved pin. Choose a new spot to move it.';
    }
    d('[data-close]').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{
      if(dialog.open)return;
      endLocationRequest();drag=null;input.value='';candidate=null;focusReturn?.focus({preventScroll:true});
    });
    function weather() {
      const status=q('[data-source]'),metrics=q('.house-metrics');
      metrics.hidden=true;
      if(archived||!Number.isFinite(time)){status.textContent='No provincial sample for this hour.';return}
      if(!grid){status.textContent=loadError?'Provincial weather unavailable.':'Loading provincial weather…';return}
      const sample=nearestSample(grid,point,time);
      if(!sample){status.textContent='The provincial weather grid does not cover this point and hour.';return}
      status.textContent='Nearest ICON sample · '+sample.km.toFixed(1)+' km away · '+stamp.format(time*1000)+' ICT. Grid points are spaced 0.25° apart.';
      metrics.replaceChildren();metrics.hidden=false;
      for(const [label,amount,unit] of [['Low cloud',sample.low,'%'],['Middle cloud',sample.mid,'%'],['High cloud',sample.high,'%'],['Rain · previous hour',sample.rain,' mm']]){
        const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;
        dd.textContent=amount===null?'Unavailable':amount+unit;metrics.append(dt,dd);
      }
    }
    function update(epoch,{archived:oldRun=false}={}) {
      time=epoch;archived=oldRun;if(!active)return;
      weather();
      if(!archived&&Number.isFinite(time)&&!request&&Date.now()-lastRequest>(loadError?60000:900000)){
        lastRequest=Date.now();
        if(!window.AtlasProvinceClouds?.load){loadError=true;weather();return}
        request=AtlasProvinceClouds.load().then(g=>{grid=g;loadError=false}).catch(()=>{loadError=true})
          .finally(()=>{request=null;if(active)weather()});
      }
    }
    function visit() {
      if(!point){edit();return}
      active=true;panel.hidden=false;onFocus?.({...point});world.focusHousePoint(point);
      const z=world.terrainElevation(point.lon,point.lat);
      q('[data-location]').textContent=pair(point)+(Number.isFinite(z)?' · '+Math.round(z).toLocaleString()+' m above sea level (terrain estimate)':'');
      q('[data-storage]').hidden=!storageNote;q('[data-storage]').textContent=storageNote;
      update(time,{archived});
    }
    function deactivate(){
      if(!active)return;active=false;panel.hidden=true;world.clearHousePoint();
    }
    save.onclick=()=>{
      if(!candidate)return;
      point={...candidate};storageNote='';
      try{localStorage.setItem(storageKey,JSON.stringify(point));stored=true}
      catch{storageNote='Browser storage is unavailable. This pin lasts until you close or reload the page.'}
      dialog.close();visit();
    };
    q('[data-return]').onclick=visit;q('[data-edit]').onclick=edit;
    q('[data-forget]').onclick=()=>{
      try{if(stored)localStorage.removeItem(storageKey)}
      catch{q('[data-storage]').hidden=false;q('[data-storage]').textContent='Browser storage could not remove the pin. Check your storage settings and try again.';return}
      point=null;stored=false;storageNote='';deactivate();q('[data-location]').textContent='';q('[data-source]').textContent='';
      q('.house-metrics').replaceChildren();onLeave?.();
    };
    return {visit,edit,deactivate,update,get active(){return active},get point(){return point&&{...point}}};
  }
  return {mount};
})();
