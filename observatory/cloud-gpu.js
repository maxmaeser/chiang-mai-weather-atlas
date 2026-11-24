/* Local pressure-column clouds in the same geocentric depth buffer as the DEM.
   Distances in the material are physical kilometres. All density detail is illustrative. */
window.AtlasCloudGPU = (() => {
  const vertex = `attribute vec2 corner;
    uniform vec4 bounds;
    void main(){gl_Position=vec4(mix(bounds.xy,bounds.zw,corner),0.,1.);}`;
  const fragment = `#extension GL_EXT_frag_depth : require
    precision highp float;
    uniform sampler2D noiseMap;
    uniform vec3 right,up,forward,axisE,axisN,axisU,origin,extent,sun,tint;
    uniform vec2 viewport,principal,cell,wind,drift;uniform vec4 linked,bottomDelta,topDelta,coverDelta;uniform float altitude,verticalBound;
    uniform float focal,aspectVE,shear,nearZ,farZ,band,cover,humidity,opacity,stepCount,daylight;
    vec2 noisePair(vec3 p){
      p=mod(p,32.);float z=floor(p.z),next=mod(z+1.,32.);
      vec2 xy=mod(p.xy,32.)+1.;vec2 a=vec2(mod(z,8.),floor(z/8.)),b=vec2(mod(next,8.),floor(next/8.));
      vec2 size=vec2(272.,136.);
      return mix(texture2D(noiseMap,(a*34.+xy+.5)/size).rg,texture2D(noiseMap,(b*34.+xy+.5)/size).rg,fract(p.z));
    }
    float noise3(vec3 p){return noisePair(p).r;}
    float horizontalMask(vec2 q){
      // Overlapping supported neighbours share a broad transition. An exposed
      // boundary tapers radially rather than outlining the square ray box.
      vec2 side=vec2(q.x<0.?linked.x:linked.y,q.y<0.?linked.z:linked.w);
      vec2 edge=abs(q)/(1.+side*.32);
      float roundness=length(edge*(1.-side));
      vec2 world=cell+q*extent.xy;
      float bend=.07*sin(dot(world,vec2(.24,.13)))+.045*sin(dot(world,vec2(-.31,.21)));
      float rim=1.-smoothstep(.42,1.,roundness+bend*min(1.,roundness));
      vec2 feather=1.-smoothstep(vec2(.55),vec2(1.),edge);
      return rim*feather.x*feather.y;
    }
    float density(vec3 p, bool detail){
      vec3 q=p/extent;
      vec4 toward=max(vec4(-q.x,q.x,-q.y,q.y),0.)*.5*linked;
      toward/=max(1.,dot(toward,vec4(1.)));
      float floorZ=-extent.z+dot(bottomDelta,toward),roofZ=extent.z+dot(topDelta,toward);
      q.z=2.*(p.z-floorZ)/max(.04,roofZ-floorZ)-1.;
      float cellCover=clamp(cover+dot(coverDelta,toward),0.,1.);
      float horizontal=horizontalMask(q.xy);
      if(horizontal<=.001||abs(q.z)>=1.)return 0.;
      vec2 xy=cell+p.xy,aligned=vec2(dot(xy,wind),dot(xy,vec2(-wind.y,wind.x)));
      vec2 adv=xy-drift;
      vec2 alignedAdv=vec2(dot(adv,wind),dot(adv,vec2(-wind.y,wind.x)));
      vec2 freq=band<.5?vec2(.56,.57):band<1.5?vec2(.21,.46):vec2(.075,.89);
      vec3 s=vec3((band<.5?xy:aligned)*freq,(p.z+altitude)*(band<.5?1.05:.7)+8.3*band);
      vec3 a=vec3((band<.5?adv:alignedAdv)*freq,s.z);
      float macro=noise3(s*.57+vec3(6.1,3.4,.3));
      float mid=noise3(s*1.31+vec3(3.2,9.7,2.));
      vec2 shape=noisePair(s*4.1+vec3(.36*mid,4.8*macro,1.6));
      float lobes=shape.g,n=.32*macro+.30*mid+.38*lobes;
      vec2 fr=noisePair(a*8.8+vec3(5.,2.,.4));
      float erosion=detail?(.48*fr.r+.52*fr.g):.50;
      n+=.23*(erosion-.50);
      float z=(q.z+1.)*.5;
      float floorH=band<.5?.075+.12*mid:.11+.13*macro;
      float ceiling=band<.5?.14+.33*macro+.54*lobes+.11*mid:band<1.5?.44+.24*macro+.25*lobes:.26+.28*macro+.26*lobes;
      ceiling+=.15*(erosion-.5);
      float body=smoothstep(floorH-.07,floorH+.07,z)*(1.-smoothstep(ceiling-.13,ceiling+.075,z));
      float edge=.69-.36*sqrt(cellCover);
      float condensate=smoothstep(edge-.065,edge+.20,n+.05*horizontal);
      return body*horizontal*condensate*(.41+.59*n)*(.38+.62*sqrt(cellCover))*(.80+.20*humidity);
    }
    float lightDensity(vec3 p){
      vec3 q=p/extent;if(max(max(abs(q.x),abs(q.y)),abs(q.z))>=1.)return 0.;
      vec2 xy=cell+p.xy;vec2 aligned=vec2(dot(xy,wind),dot(xy,vec2(-wind.y,wind.x)));
      vec2 freq=band<.5?vec2(.56,.57):band<1.5?vec2(.21,.46):vec2(.075,.89);
      vec2 cloud=noisePair(vec3(aligned*freq*.85,p.z*.8+8.3*band));
      float height=q.z*.5+.5,insideZ=smoothstep(.04,.20,height)*(1.-smoothstep(.44+.29*cloud.g,.78+.18*cloud.g,height));
      return insideZ*horizontalMask(q.xy)*smoothstep(.59-.28*sqrt(cover),.68,.64*cloud.r+.36*cloud.g)*(.38+.56*cover);
    }
    void main(){
      vec2 uv=gl_FragCoord.xy/viewport;
      vec2 pixel=vec2(uv.x,1.-uv.y)*viewport;
      float x=(pixel.x-principal.x)/focal,y=(principal.y-pixel.y)/focal+shear*x;
      vec3 ray=normalize(forward+x*right+y*up);
      vec3 d=vec3(dot(ray,axisE),dot(ray,axisN),dot(ray,axisU)/aspectVE);
      vec3 inv=1./(d+vec3(1.e-8));
      vec3 lo=-extent*vec3(1.+linked.x*.32,1.+linked.z*.32,verticalBound),hi=extent*vec3(1.+linked.y*.32,1.+linked.w*.32,verticalBound);vec3 t1=(lo-origin)*inv,t2=(hi-origin)*inv,tn=min(t1,t2),tf=max(t1,t2);
      float entry=max(nearZ,max(tn.x,max(tn.y,tn.z))),exitT=min(tf.x,min(tf.y,tf.z));
      if(exitT<=entry)discard;
      float dt=(exitT-entry)/stepCount,T=1.,first=-1.;
      vec3 radiance=vec3(0.);float depthRate=dot(ray,forward);
      float k=(band<.5?1.90:band<1.5?1.43:.95)/max(.26,sqrt(extent.z));
      for(int i=0;i<32;i++){
        if(float(i)>=stepCount||T<.023)break;
        float travel=entry+(float(i)+.5)*dt;
        vec3 p=origin+travel*d;
        float rho=density(p,true);
        if(rho<.003)continue;
        float ds=dt*length(d),absorb=1.-exp(-rho*k*ds*opacity);
        if(absorb<.0002)continue;
        if(first<0.&&absorb>.001)first=travel;
        float reach=clamp(extent.z*.75,.18,1.7);
        float nearSun=lightDensity(p+sun*reach*.55),farSun=lightDensity(p+sun*reach*1.55);
        float shade=exp(-reach*k*(2.65*nearSun+1.32*farSun));
        float height=clamp(p.z/extent.z*.5+.5,0.,1.);
        float phase=.12*pow(max(0.,dot(normalize(d),sun)),4.);
        vec3 ambient=mix(vec3(.30,.36,.42),vec3(.52,.61,.70),height);
        vec3 lit=mix(ambient,vec3(1.,.98,.92),clamp(shade*(.34+.58*height)+phase+clamp((rho-nearSun)*1.3,-.18,.24),0.,1.));
        lit=mix(vec3(.21,.27,.36)+.16*height,lit,daylight);
        radiance+=T*absorb*lit*tint;T*=1.-absorb;
      }
      float alpha=1.-T;if(alpha<.006||first<0.)discard;
      float z=max(nearZ,first*depthRate);
      gl_FragDepthEXT=clamp(farZ/(farZ-nearZ)-farZ*nearZ/((farZ-nearZ)*z),0.,1.);
      gl_FragColor=vec4(radiance/alpha,alpha);
    }`;
  const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,k)=>a.map(v=>v*k);
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],unit=a=>mul(a,1/(Math.hypot(...a)||1));
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  function noiseTexture(gl){
    const n=32,tile=34,w=8*tile,h=4*tile,src=new Uint8Array(n**3),packed=new Uint8Array(w*h*4);
    let seed=58921;for(let i=0;i<src.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;src[i]=seed>>>24}
    const cell=(x,y,z)=>(((z+8)%8*8+(y+8)%8)*8+(x+8)%8)*3;
    for(let z=0;z<n;z++)for(let y=0;y<tile;y++)for(let x=0;x<tile;x++){
      const sx=(x-1+n)%n,sy=(y-1+n)%n;
      const offset=4*((Math.floor(z/8)*tile+y)*w+(z%8)*tile+x),X=sx/4,Y=sy/4,Z=z/4;
      let nearest=4;for(let c=Math.floor(Z)-1;c<=Math.floor(Z)+1;c++)for(let b=Math.floor(Y)-1;b<=Math.floor(Y)+1;b++)for(let a=Math.floor(X)-1;a<=Math.floor(X)+1;a++){
        const f=cell(a,b,c),x0=a+.12+.76*src[f]/255-X,y0=b+.12+.76*src[f+1]/255-Y,z0=c+.12+.76*src[f+2]/255-Z;
        nearest=Math.min(nearest,x0*x0+y0*y0+z0*z0);
      }
      packed[offset]=src[(z*n+sy)*n+sx];packed[offset+1]=Math.round(255*clamp(1-.96*Math.sqrt(nearest),0,1));packed[offset+3]=255;
    }
    const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
    for(const [name,value] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,name,value);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,packed);return tex;
  }
  function renderTarget(gl){
    if(!gl.getExtension('WEBGL_depth_texture'))return null;
    const combine=gl.createProgram(),sources=[
      [gl.VERTEX_SHADER,'attribute vec2 corner;varying vec2 uv;void main(){uv=corner;gl_Position=vec4(corner*2.-1.,0.,1.);}'],
      [gl.FRAGMENT_SHADER,'#extension GL_EXT_frag_depth : require\nprecision highp float;varying vec2 uv;uniform sampler2D colorMap,depthMap;void main(){vec4 c=texture2D(colorMap,uv);if(c.a<.004)discard;gl_FragDepthEXT=texture2D(depthMap,uv).r;gl_FragColor=vec4(c.rgb/max(c.a,.004),c.a);}']
    ];
    for(const [type,source] of sources){const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);gl.deleteProgram(combine);return null}gl.attachShader(combine,shader);gl.deleteShader(shader)}
    gl.bindAttribLocation(combine,0,'corner');gl.linkProgram(combine);if(!gl.getProgramParameter(combine,gl.LINK_STATUS)){gl.deleteProgram(combine);return null}
    const colorMap=gl.getUniformLocation(combine,'colorMap'),depthMap=gl.getUniformLocation(combine,'depthMap');
    const fb=gl.createFramebuffer(),color=gl.createTexture(),depth=gl.createTexture();
    let width=0,height=0,previous=null;
    function boundTexture(tex,filter){
      gl.bindTexture(gl.TEXTURE_2D,tex);for(const p of [gl.TEXTURE_MAG_FILTER,gl.TEXTURE_MIN_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,filter);
      for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);
    }
    return {
      begin(w,h){
        previous=gl.getParameter(gl.FRAMEBUFFER_BINDING);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
        if(w!==width||h!==height){
          width=w;height=h;gl.activeTexture(gl.TEXTURE7);boundTexture(color,gl.LINEAR);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,color,0);
          boundTexture(depth,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT,w,h,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,depth,0);gl.bindTexture(gl.TEXTURE_2D,null);
        }
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){gl.bindFramebuffer(gl.FRAMEBUFFER,previous);gl.activeTexture(gl.TEXTURE0);return false}
        gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);return true;
      },
      composite(){
        gl.bindFramebuffer(gl.FRAMEBUFFER,previous);gl.viewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight);gl.useProgram(combine);
        gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,color);gl.uniform1i(colorMap,6);
        gl.activeTexture(gl.TEXTURE7);gl.bindTexture(gl.TEXTURE_2D,depth);gl.uniform1i(depthMap,7);
        gl.depthMask(false);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.drawArrays(gl.TRIANGLES,0,6);
        gl.bindTexture(gl.TEXTURE_2D,null);gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,null);gl.activeTexture(gl.TEXTURE0);
      },
      destroy(){gl.deleteFramebuffer(fb);gl.deleteTexture(color);gl.deleteTexture(depth);gl.deleteProgram(combine)}
    };
  }
  function create(gl){
    if(!gl.getExtension('EXT_frag_depth'))return null;
    const prog=gl.createProgram(),shaders=[];
    try{
      for(const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){
        const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);
        if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(prog,s);
      }
      gl.bindAttribLocation(prog,0,'corner');gl.linkProgram(prog);
      if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(prog));
    }catch(e){gl.deleteProgram(prog);console.warn('Atlas cloud volume pass',e.message);return null}
    finally{for(const shader of shaders)gl.deleteShader(shader)}
    const loc={};for(const s of 'linked bottomDelta topDelta coverDelta verticalBound altitude bounds right up forward axisE axisN axisU origin extent sun tint viewport principal cell wind drift focal aspectVE shear nearZ farZ band cover humidity opacity stepCount daylight noiseMap'.split(' '))loc[s]=gl.getUniformLocation(prog,s);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,1,0,1,1,0,0,1,1,0,1]),gl.STATIC_DRAW);
    gl.activeTexture(gl.TEXTURE6);const noise=noiseTexture(gl);gl.activeTexture(gl.TEXTURE0);
    const maxAttr=gl.getParameter(gl.MAX_VERTEX_ATTRIBS),target=renderTarget(gl),info=gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName=String(gl.getParameter(info?info.UNMASKED_RENDERER_WEBGL:gl.RENDERER));
    const software=/swiftshader|llvmpipe|softpipe|software rasterizer/i.test(rendererName);
    let saved='',cached=false,lastSize=[0,0];
    let last=0,seconds=0,lastSignature=null,valid=null,groups=[],visible=0,oldGroups=[],transitionStart=0,neighbors=new Map();
    function linkedCells(){
      neighbors=new Map();
      for(const g of groups){const neighborsAt=[null,null,null,null],kmLon=111.2*Math.cos(g.la*Math.PI/180);
        for(const peer of groups){if(g===peer||g.band!==peer.band||g.bottom>=peer.top||peer.bottom>=g.top)continue;
          const half=(g.radius+peer.radius)/.84,dx=(peer.lo-g.lo)*kmLon/half,dy=(peer.la-g.la)*111.2/half;
          if(Math.abs(dx)>.65&&Math.abs(dx)<1.18&&Math.abs(dy)<.37)neighborsAt[dx<0?0:1]=peer;
          if(Math.abs(dy)>.65&&Math.abs(dy)<1.18&&Math.abs(dx)<.37)neighborsAt[dy<0?2:3]=peer;
        }neighbors.set(g.key,neighborsAt);
      }
    }
    function currentGroups(now){
      if(!transitionStart)return groups;
      const f=clamp((now-transitionStart)/460,0,1);if(f>=1){oldGroups=[];transitionStart=0;return groups}
      const old=new Map(oldGroups.map(g=>[g.key,g])),out=[];
      for(const g of groups){const previous=old.get(g.key);if(!previous){out.push({...g,opacity:f});continue}
        old.delete(g.key);const v={...g};for(const prop of ['bottom','top','cover','rh','east','north','opacity'])v[prop]=previous[prop]+(g[prop]-previous[prop])*f;
        out.push(v)}
      for(const g of old.values())out.push({...g,opacity:g.opacity*(1-f)});return out;
    }
    function draw({camera:c,raw,selected,geo,time,sun,style,opacity,edgeHandoff=0,animated,speed,reduced,moving,signature}){
      if(!window.AtlasCloudLight?.envelopes)return false;
      const now=performance.now();
      if(lastSignature!==signature){
        const adjacent=!reduced&&valid!==null&&Math.abs(time-valid)===3600;
        oldGroups=adjacent?currentGroups(now):[];groups=window.AtlasCloudLight.envelopes(raw,selected);
        linkedCells();transitionStart=adjacent?now:0;valid=time;lastSignature=signature;
      }
      if(animated&&last)seconds+=(now-last)/1000*speed;last=now;
      const previous=gl.getParameter(gl.CURRENT_PROGRAM);
      const quantum=Math.max(2,speed*(software?.55:.11));
      const phase=animated?Math.floor(seconds/quantum):seconds;
      const stamp=[signature,style,opacity,edgeHandoff,time,sun.join('/'),moving,phase,c.w,c.h,c.focal,c.cx,c.cy,c.shear,c.ve,c.near,...c.eye,...c.F,...c.up].join(',');
      function bindQuad(){gl.bindBuffer(gl.ARRAY_BUFFER,buffer);for(let i=1;i<maxAttr;i++)gl.disableVertexAttribArray(i);
       gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0)}
      if(target&&cached&&saved===stamp&&!transitionStart){
        bindQuad();gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);target.composite();gl.depthMask(true);gl.disable(gl.BLEND);gl.useProgram(previous);return true;
      }
      const packets=[];
      for(const g of currentGroups(now)){
        if(g.opacity<.002)continue;const h=(g.top+g.bottom)/2,base=geo(g.lo,g.la,h),center=c.stretch(base),E=unit(sub(geo(g.lo+.001,g.la,h),base)),N=unit(sub(geo(g.lo,g.la+.001,h),base)),U=unit(add(base,[0,0,6371.0088]));
        const extent=[g.radius/.84,g.radius/.84,Math.max(.025,(g.top-g.bottom)/2)],rel=sub(c.eye,center),origin=[dot(rel,E),dot(rel,N),dot(rel,U)/c.ve];
        let left=c.w,top=c.h,right=0,bottom=0,front=0,back=0;
        const near=neighbors.get(g.key)||[null,null,null,null],links=near.map(p=>p?1:0);
        const bottomDelta=near.map(p=>p?clamp(p.bottom-g.bottom,-2*extent[2],2*extent[2]):0),topDelta=near.map(p=>p?clamp(p.top-g.top,-2*extent[2],2*extent[2]):0),coverDelta=near.map(p=>p?(p.cover-g.cover)/100:0);
        const verticalBound=1+Math.max(0,...bottomDelta.map(v=>-v),...topDelta)/extent[2];
        for(const a of [-1,1])for(const b of [-1,1])for(const z of [-1,1]){
          const v=add(add(add(center,mul(E,a*extent[0]*(1+.32*links[a<0?0:1]))),mul(N,b*extent[1]*(1+.32*links[b<0?2:3]))),mul(U,z*extent[2]*verticalBound*c.ve)),diff=sub(v,c.eye),depth=dot(diff,c.F);
          if(depth<=c.near){back++;continue}front++;
          const x=dot(diff,c.right)*c.focal/depth,y=dot(diff,c.up)*c.focal/depth;
          left=Math.min(left,c.cx+x);right=Math.max(right,c.cx+x);top=Math.min(top,c.cy-y+c.shear*x);bottom=Math.max(bottom,c.cy-y+c.shear*x);
        }
        if(!front)continue;if(back){left=0;top=0;right=c.w;bottom=c.h}
        left=clamp(left,0,c.w);right=clamp(right,0,c.w);top=clamp(top,0,c.h);bottom=clamp(bottom,0,c.h);
        if(right-left<1||bottom-top<1)continue;
        packets.push({g,E,N,U,origin,extent,links,bottomDelta,topDelta,coverDelta,verticalBound,bounds:[2*left/c.w-1,1-2*bottom/c.h,2*right/c.w-1,1-2*top/c.h],depth:dot(sub(center,c.eye),c.F),area:(right-left)*(bottom-top)});
      }
      visible=packets.length;if(!visible)return true;
      const cap=software?(moving?170:275):(moving?400:620),factor=software?.46:.68;
      const w=Math.max(1,Math.round(Math.min(cap,c.w*factor))),h=Math.max(1,Math.round(w*c.h/c.w)),offscreen=target?.begin(w,h);
      const rw=offscreen?w:gl.drawingBufferWidth,rhgt=offscreen?h:gl.drawingBufferHeight,dpr=rw/c.w;
      gl.useProgram(prog);bindQuad();
      gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,noise);gl.uniform1i(loc.noiseMap,6);gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.DEPTH_TEST);gl.depthMask(Boolean(offscreen));gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      const f=(key,v)=>gl.uniform1f(loc[key],v),v2=(k,v)=>gl.uniform2fv(loc[k],v),v3=(k,v)=>gl.uniform3fv(loc[k],v);
      v3('right',c.right);v3('up',c.up);v3('forward',c.F);v3('sun',sun);v2('viewport',[rw,rhgt]);v2('principal',[c.cx*dpr,c.cy*dpr]);
      f('focal',c.focal*dpr);f('aspectVE',c.ve);f('shear',c.shear);f('nearZ',c.near);f('farZ',c.far);f('opacity',opacity);
      f('daylight',clamp((sun[2]+.12)/.37,0,1));
      packets.sort((a,b)=>b.depth-a.depth);
      for(const p of packets){
        const {g}=p,band=g.band==='low'?0:g.band==='mid'?1:2,rh=clamp((g.rh-70)/30,0,1),speed=Math.hypot(g.east,g.north);
        gl.uniform4fv(loc.linked,p.links);gl.uniform4fv(loc.bottomDelta,p.bottomDelta);gl.uniform4fv(loc.topDelta,p.topDelta);gl.uniform4fv(loc.coverDelta,p.coverDelta);f('verticalBound',p.verticalBound);f('altitude',(g.top+g.bottom)/2);v3('axisE',p.E);v3('axisN',p.N);v3('axisU',p.U);v3('origin',p.origin);v3('extent',p.extent);v2('cell',[(g.lo-98.985)*105.25,(g.la-18.79)*111.2]);
        v2('wind',speed>.01?[g.east/speed,g.north/speed]:[1,0]);v2('drift',[g.east*seconds/3600,g.north*seconds/3600]);
        v3('tint',style==='height'?[[.60,.96,.79],[1,.81,.54],[.82,.73,1]][band]:style==='humidity'?[.80-.49*rh,.91-.25*rh,.99]:[1,1,1]);
        f('opacity',opacity*g.opacity*(1-edgeHandoff*.82*(1-g.interior)));f('band',band);f('cover',g.cover/100);f('humidity',rh);f('stepCount',software?(moving?10:p.area>900?16:10):(p.area>c.w*c.h*.35?22:p.area>900?28:14));
        gl.uniform4fv(loc.bounds,p.bounds);gl.drawArrays(gl.TRIANGLES,0,6);
      }
      cached=!!offscreen;saved=stamp;lastSize=[rw,rhgt];if(offscreen)target.composite();gl.depthMask(true);gl.disable(gl.BLEND);gl.useProgram(previous);return true;
    }
    return {draw,suspend(){last=0},get stats(){return {software,width:lastSize[0],height:lastSize[1]}},get transitioning(){return !!transitionStart},get visible(){return visible},destroy(){target?.destroy();gl.deleteTexture(noise);gl.deleteBuffer(buffer);gl.deleteProgram(prog)}};
  }
  return {create};
})();
