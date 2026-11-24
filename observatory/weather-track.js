/* Hourly weather for the public reference cell or the visitor's local pin. */
window.AtlasWeatherTrack = (() => {
  'use strict';
  const width = 1000;
  const finite = Number.isFinite;
  const dateOptions = {timeZone: 'Asia/Bangkok'};
  const dateTick = new Intl.DateTimeFormat('en-GB', {...dateOptions, day:'numeric', month:'short'});
  const clockTick = new Intl.DateTimeFormat('en-GB', {...dateOptions,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const hourStamp = new Intl.DateTimeFormat('en-GB', {...dateOptions, weekday:'short', day:'numeric', month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const rainNumber = new Intl.NumberFormat('en-GB', {maximumFractionDigits:2});
  const cloudNames = {all:'Cloud', low:'Low cloud', mid:'Mid cloud', high:'High cloud'};
  const xAt = (i,n) => n < 2 ? 0 : i * width / (n - 1);
  const hourICT = t => ((t / 3600 + 7) % 24 + 24) % 24;

  function distanceKm(lat, lon, point) {
    const rad = Math.PI / 180;
    const a = Math.sin((lat - point.lat)*rad/2)**2 + Math.cos(lat*rad)*Math.cos(point.lat*rad)*Math.sin((lon - point.lon)*rad/2)**2;
    return 12742 * Math.asin(Math.sqrt(Math.min(1, a)));
  }
  function nearestRow(rows, point) {
    let index = 0, km = Infinity;
    rows.forEach((row,i) => {
      const distance = distanceKm(row.latitude, row.longitude, point);
      if (distance < km) {index = i; km = distance}
    });
    return {index, km};
  }
  function gridCell(grid, point) {
    if (!grid || !point) return null;
    const {lons,lats} = grid;
    if (point.lon < lons[0] || point.lat < lats[0] || point.lon > lons.at(-1) || point.lat > lats.at(-1)) return null;
    const nearest = (axis,value) => axis.reduce((best,n,i) => Math.abs(n-value) < Math.abs(axis[best]-value) ? i : best, 0);
    const x = nearest(lons,point.lon), y = nearest(lats,point.lat);
    return {id:y*lons.length+x, km:distanceKm(lats[y],lons[x],point)};
  }
  function gridSeries(grid, cell, times, field) {
    const nodes = grid.lons.length * grid.lats.length, rain = field === 'precipitation';
    return times.map(t => {
      const hour = (t - grid.start)/grid.step;
      if (!Number.isInteger(hour) || hour < 0 || hour >= grid.hours) return null;
      const v = grid.fields[field]?.[hour*nodes+cell.id];
      return finite(v) && v !== (rain ? 65535 : 255) ? v / (rain ? 100 : 1) : null;
    });
  }
  function sourceFor(state, grid) {
    const {packet,mode,place,point,cellIndex,sites} = state;
    const times = packet.rows[0].hourly.time;
    const cell = mode === 'replay' && place === 'house' ? gridCell(grid,point) : null;
    let band = Object.hasOwn(cloudNames,state.band) ? state.band : 'all';
    let name, rain, clouds;
    if (cell) {
      // The province grid publishes distinct bands. It has no total sky-cover field.
      if (band === 'all') band = 'low';
      name = 'My location · provincial cell '+cell.km.toFixed(1)+' km away';
      rain = gridSeries(grid,cell,times,'precipitation');
      clouds = gridSeries(grid,cell,times,'cloud_cover_'+band);
    } else {
      const byPoint = ['house','window','crag'].includes(place) && point && finite(point.lat) && finite(point.lon);
      const match = byPoint ? nearestRow(packet.rows,point) : {index:cellIndex};
      const i = packet.rows[match.index] ? match.index : 0, row = packet.rows[i];
      const cellName = sites?.[i]?.name || row.latitude.toFixed(2)+'°N '+row.longitude.toFixed(2)+'°E';
      name = place === 'house' && byPoint ? 'My location · '+cellName+' cell, '+match.km.toFixed(1)+' km away' : cellName+' · ICON cell';
      rain = row.hourly.precipitation;
      clouds = row.hourly[band === 'all' ? 'cloud_cover' : 'cloud_cover_'+band];
    }
    // In particular, keep null, missing and out-of-range samples distinct from zero.
    rain = times.map((_,i) => finite(rain?.[i]) && rain[i] >= 0 ? rain[i] : null);
    clouds = times.map((_,i) => finite(clouds?.[i]) && clouds[i] >= 0 && clouds[i] <= 100 ? clouds[i] : null);
    return {times,name,rain,clouds,cloudName:cloudNames[band]};
  }
  function rainCeiling(rain) {
    const max = Math.max(1,...rain.filter(finite)), power = 10**Math.floor(Math.log10(max));
    return power * [1,2,5,10].find(n => n*power >= max);
  }
  function chartPaths(values, base, ceiling, bar) {
    let marks = '', gaps = '';
    const step = values.length < 2 ? width : width/(values.length-1);
    const f = n => +n.toFixed(2);
    values.forEach((v,i) => {
      const center = xAt(i,values.length), left = Math.max(0,center-step/2), right = Math.min(width,center+step/2);
      if (v === null) {gaps += `M${f(left)},${base}V${base-21}H${f(right)}V${base}Z`; return}
      if (!v) return;
      const height = Math.max(bar ? 1.7 : 0.75, Math.min(1,v/ceiling)*21);
      const inset = bar ? step*.08 : 0;
      marks += `M${f(Math.max(0,center-step/2+inset))},${base}V${f(base-height)}H${f(Math.min(width,center+step/2-inset))}V${base}Z`;
    });
    return {marks,gaps};
  }
  function mount(root, slider, {onReadout}={}) {
    let lastState, series, grid = null, gridRequest = null, gridFailed = false, currentIndex = -1, readout;
    const gridLoader = window.AtlasProvinceClouds;
    root.classList.add('weather-track');
    root.innerHTML = `<div class="wt-heading"><span class="wt-site"></span><span class="wt-range"></span><span class="wt-missing" hidden>No data</span></div>
      <div class="wt-layout"><div class="wt-key" aria-hidden="true"><div><span>Rain · 1h</span><strong class="wt-rain-value"></strong></div><div><span class="wt-cloud-name">Cloud</span><strong class="wt-cloud-value"></strong></div></div>
      <div class="wt-column"><div class="wt-plot"><svg class="wt-graph" viewBox="0 0 1000 54" preserveAspectRatio="none" aria-hidden="true"><defs><pattern id="wt-no-data" patternUnits="userSpaceOnUse" width="5" height="5"><path d="M-1 1l2 -2M0 5l5 -5M4 6l2 -2"/></pattern></defs><path class="wt-days"/><path class="wt-base" d="M0 24.5H1000M0 51.5H1000"/><path class="wt-gaps"/><path class="wt-clouds"/><path class="wt-rain"/></svg><i class="wt-marker" aria-hidden="true"></i></div><div class="wt-ticks" aria-hidden="true"></div></div></div>`;
    const q = s => root.querySelector(s);
    const plot = q('.wt-plot'), ticks = q('.wt-ticks'), marker = q('.wt-marker');
    const site = q('.wt-site'), range = q('.wt-range'), missing = q('.wt-missing');
    const rainValue = q('.wt-rain-value'), cloudValue = q('.wt-cloud-value'), cloudTitle = q('.wt-cloud-name');
    const hatch = q('#wt-no-data');
    plot.append(slider);
    root.hidden = true;
    function ticksAtWidth() {
      if (!series || !plot.clientWidth) return;
      const times = series.times, n = times.length, pixels = plot.clientWidth;
      const compact = n <= 72, positions = [];
      // The SVG stretches with its column. Keep gap hatching at a readable screen size.
      hatch.setAttribute('patternTransform',`scale(${width/pixels} 1)`);
      function addTick(i,label,edge='') {
        const x = xAt(i,n)*pixels/width, span = label.length*6.5+2;
        const left = edge === 'start' ? 0 : edge === 'end' ? pixels-span : x-span/2;
        const right = left+span;
        if (left < -.5 || right > pixels+.5 || positions.some(t => left < t.right+6 && right+6 > t.left)) return;
        positions.push({left,right,i,label,edge});
      }
      const day = i => dateTick.format(times[i]*1000);
      addTick(0,day(0),'start');
      if (n > 1) addTick(n-1,day(n-1) === day(0) ? clockTick.format(times[n-1]*1000) : day(n-1),'end');
      for (let i=1;i<n-1;i++) {
        if (hourICT(times[i]) === 0 && day(i) !== day(n-1)) addTick(i,day(i));
      }
      if (compact) {
        for (let i=1;i<n-1;i++) if (hourICT(times[i]) === 12) addTick(i,'12h');
        for (let i=1;i<n-1;i++) if (hourICT(times[i]) % 12 === 6) addTick(i,`${hourICT(times[i])}h`);
      }
      ticks.replaceChildren(...positions.sort((a,b)=>a.i-b.i).map(t => {
        const label = document.createElement('span');
        label.textContent = t.label;label.dataset.edge = t.edge;
        label.style.left = `${xAt(t.i,n)/10}%`;
        return label;
      }));
    }
    function drawSeries() {
      const {times,rain,clouds,name,cloudName} = series, ceiling = rainCeiling(rain);
      const bars = chartPaths(rain,24,ceiling,true), cover = chartPaths(clouds,51,100,false);
      q('.wt-rain').setAttribute('d',bars.marks);
      q('.wt-clouds').setAttribute('d',cover.marks);
      q('.wt-gaps').setAttribute('d',bars.gaps+cover.gaps);
      q('.wt-days').setAttribute('d',times.flatMap((t,i) => hourICT(t) === 0 ? `M${xAt(i,times.length).toFixed(2)} 0v54` : []).join(''));
      missing.hidden = !bars.gaps && !cover.gaps;
      site.textContent = name;
      range.textContent = `Rain scale 0–${ceiling} mm`;
      cloudTitle.textContent = cloudName;
      ticksAtWidth();
    }
    function update(state) {
      if (!state?.packet?.rows?.length) return;
      const prev = lastState;
      const changed = !series || prev?.packet !== state.packet || prev.mode !== state.mode || prev.place !== state.place || prev.cellIndex !== state.cellIndex ||
        prev.band !== state.band || prev.point?.lat !== state.point?.lat || prev.point?.lon !== state.point?.lon;
      lastState = {...state, point: state.point && {...state.point}};
      if (state.mode === 'replay' && state.place === 'house' && gridLoader && !grid && !gridRequest && !gridFailed) {
        gridRequest = gridLoader.load().then(data => {
          grid = data;
          if (lastState.mode === 'replay' && lastState.place === 'house') {series = null; update(lastState)}
        }).catch(() => {gridFailed = true}).finally(() => {gridRequest = null});
      } else if (state.place !== 'house' || state.mode !== 'replay') gridFailed = false;
      if (changed) {
        series = sourceFor(state,grid);root.hidden = false;drawSeries();
      }
      const i = Math.max(0,Math.min(series.times.length-1,state.index || 0));
      if (changed || currentIndex !== i) {
        currentIndex = i;
        const rain = series.rain[i], cloud = series.clouds[i];
        const rainLabel = rain === null ? '—' : rainNumber.format(rain)+' mm';
        const cloudLabel = cloud === null ? '—' : Math.round(cloud)+'%';
        readout = {rainLabel,cloudLabel,cloudName:series.cloudName};
        rainValue.textContent = rain === null ? 'No data' : rainLabel;
        cloudValue.textContent = cloud === null ? 'No data' : cloudLabel;
        marker.style.left = `${xAt(i,series.times.length)/10}%`;
        slider.setAttribute('aria-valuetext',`${hourStamp.format(series.times[i]*1000)} ICT, ${series.name}, rain in preceding hour ${rainValue.textContent}, ${series.cloudName} cover ${cloudValue.textContent}`);
        onReadout?.(readout);
      }
      return readout;
    }
    if (window.ResizeObserver) new ResizeObserver(ticksAtWidth).observe(plot);
    else window.addEventListener('resize',ticksAtWidth);
    return {update};
  }
  return {mount,nearestRow};
})();
