(function(){
  'use strict';

  /* =====================================================================
     Grundlagen
     ===================================================================== */
  var $=function(id){return document.getElementById(id);};
  var NS='http://www.w3.org/2000/svg';
  var reduceMotion=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function n(v){var x=Number(v);return isFinite(x)?x:0;}
  function isNum(v){return typeof v==='number'&&isFinite(v);}
  function fmtInt(v){return Math.round(n(v)).toLocaleString('de-DE');}
  function fmtTemp(t){if(!isNum(t))return '–';var r=Math.round(t);return (r<0?'−'+Math.abs(r):String(r))+'°';}
  function fmtAlt(z){return fmtInt(Math.round(z/10)*10)+' m';}
  function p2(x){return String(x).padStart(2,'0');}
  function clock(d){d=d||new Date();return p2(d.getHours())+':'+p2(d.getMinutes());}
  function nowStr(){var d=new Date();return p2(d.getDate())+'.'+p2(d.getMonth()+1)+'.'+d.getFullYear()+', '+clock(d);}
  function toast(t){var el=$('toast');el.textContent=t;el.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(function(){el.hidden=true;},2800);}
  function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v);}catch(e){return null;}}
  function svg(tag,attrs,parent){var el=document.createElementNS(NS,tag);for(var k in attrs)el.setAttribute(k,attrs[k]);if(parent)parent.appendChild(el);return el;}
  /* Datum/Stunde in Ischgler Zeit als "YYYY-MM-DD" bzw. "YYYY-MM-DDTHH:00" */
  var fmtBerlin=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false});
  function berlinParts(d){var s=fmtBerlin.format(d||new Date());return {day:s.slice(0,10),hour:s.slice(0,10)+'T'+s.slice(11,13)+':00'};}
  var WD=['So','Mo','Di','Mi','Do','Fr','Sa'];

  /* Höhen im Skigebiet */
  var Z_TAL=1377, Z_TOP=2872;
  var LAT=46.9706, LON=10.2906;

  /* =====================================================================
     Countdown: erster Lift Do 26.11.2026 (00:00 MEZ = 25.11. 23:00 UTC)
     ===================================================================== */
  var target=Date.UTC(2026,10,25,23,0,0);
  function tick(){
    var diff=target-Date.now();
    if(diff<=0){
      $('cd-d').textContent='0';$('cd-hms').textContent='00:00:00';
      $('cd-note').innerHTML='Saison läuft<br>Ab auf die Piste';
      return;
    }
    var s=Math.floor(diff/1000);
    $('cd-d').textContent=Math.floor(s/86400);
    $('cd-hms').textContent=p2(Math.floor(s%86400/3600))+':'+p2(Math.floor(s%3600/60))+':'+p2(s%60);
  }
  tick();setInterval(tick,1000);

  /* =====================================================================
     Schneefall im Kopfbereich (Canvas)
     ===================================================================== */
  (function snowfx(){
    var cv=$('snowfx');if(!cv||!cv.getContext)return;
    var ctx=cv.getContext('2d'),W=0,H=0,dpr=1,flakes=[],running=true,raf=0;
    function size(){
      dpr=Math.min(window.devicePixelRatio||1,2);
      W=cv.clientWidth;H=cv.clientHeight;cv.width=W*dpr;cv.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
      var count=Math.round(Math.min(180,W*H/9000));
      flakes=[];for(var i=0;i<count;i++)flakes.push(newFlake(true));
      if(reduceMotion)draw();
    }
    function newFlake(any){var r=Math.random();return {x:Math.random()*W,y:any?Math.random()*H:-10,r:.6+r*2.4,s:.3+r*1.1,d:Math.random()*Math.PI*2,o:.35+r*.55};}
    function draw(){
      ctx.clearRect(0,0,W,H);
      for(var i=0;i<flakes.length;i++){var f=flakes[i];ctx.globalAlpha=f.o;ctx.beginPath();ctx.arc(f.x,f.y,f.r,0,6.283);ctx.fillStyle='#fff';ctx.fill();}
      ctx.globalAlpha=1;
    }
    function step(){
      for(var i=0;i<flakes.length;i++){var f=flakes[i];f.y+=f.s;f.d+=.01;f.x+=Math.sin(f.d)*.35;if(f.y>H+6){flakes[i]=newFlake(false);}}
      draw();if(running)raf=requestAnimationFrame(step);
    }
    size();window.addEventListener('resize',function(){clearTimeout(size._t);size._t=setTimeout(size,150);});
    if(reduceMotion)return;
    if('IntersectionObserver' in window){
      new IntersectionObserver(function(es){var vis=es[0].isIntersecting;if(vis&&!running){running=true;raf=requestAnimationFrame(step);}else if(!vis){running=false;cancelAnimationFrame(raf);}}).observe(cv);
    }
    raf=requestAnimationFrame(step);
  })();

  /* =====================================================================
     Daten: von Hand (data.json), offizieller Schneebericht (/api/snow),
     Wetter (Open-Meteo, direkt aus dem Browser)
     ===================================================================== */
  var STATUS={closed:'Geschlossen',partial:'Teilweise offen',open:'Geöffnet'};
  var FALLBACK={updated:'',status:'closed',statusNote:'',snowTop:0,snowValley:0,liftsOpen:0,liftsTotal:46,slopesOpen:0,slopesTotal:239,groupNote:''};
  var manual=null, official=null, officialErr=null, wx=null, wxErr=null, hasServer=false, lastRefresh=0;

  function getJSON(url,opt){
    return fetch(url,Object.assign({cache:'no-store'},opt||{})).then(function(r){
      return r.json().catch(function(){return null;}).then(function(j){if(!r.ok){var e=new Error((j&&j.error)||('HTTP '+r.status));e.status=r.status;throw e;}return j;});
    });
  }
  function loadManual(){
    return getJSON('data.json?t='+Date.now()).then(function(j){manual=Object.assign({},FALLBACK,j||{});})
      .catch(function(){if(!manual)manual=Object.assign({},FALLBACK);});
  }
  function loadOfficial(force){
    if(!hasServer)return Promise.resolve();
    return getJSON('api/snow'+(force?'?force=1':'')).then(function(j){official=j;officialErr=null;})
      .catch(function(e){officialErr=e.message;});
  }
  function omUrl(elev){
    return 'https://api.open-meteo.com/v1/forecast?latitude='+LAT+'&longitude='+LON+'&elevation='+elev+
      '&timezone=Europe%2FBerlin&past_days=1&forecast_days=7'+
      '&current=temperature_2m,weather_code'+
      '&hourly=temperature_2m,freezing_level_height,snowfall,precipitation'+
      '&daily=temperature_2m_max,temperature_2m_min,snowfall_sum,precipitation_sum,weather_code';
  }
  function loadWeather(){
    return Promise.all([getJSON(omUrl(Z_TAL),{cache:'default'}),getJSON(omUrl(Z_TOP),{cache:'default'})])
      .then(function(r){wx=buildWx(r[0],r[1]);wxErr=null;})
      .catch(function(e){wxErr=e.message||'Fehler';});
  }

  /* Nullgradgrenze aus zwei Temperaturen schätzen (falls das Modell keine liefert) */
  function zeroFromTemps(tLow,tHigh){
    if(!isNum(tLow)||!isNum(tHigh))return null;
    var lapse=(tLow-tHigh)/(Z_TOP-Z_TAL);
    if(!(lapse>0.002))lapse=0.0065;
    return Math.max(0,Math.min(5500,Z_TAL+tLow/lapse));
  }
  function avg(a){var s=0,c=0;for(var i=0;i<a.length;i++)if(isNum(a[i])){s+=a[i];c++;}return c?s/c:null;}

  function buildWx(tal,top){
    var now=berlinParts();
    var H=top.hourly, Ht=tal.hourly;
    var nowIdx=H.time.indexOf(now.hour);
    if(nowIdx<0){nowIdx=0;for(var i=0;i<H.time.length;i++)if(H.time[i]<=now.hour)nowIdx=i;}
    function flAt(i){
      var v=H.freezing_level_height&&H.freezing_level_height[i];
      return isNum(v)?v:zeroFromTemps(Ht.temperature_2m[i],H.temperature_2m[i]);
    }
    var snow24=0;for(var k=Math.max(0,nowIdx-23);k<=nowIdx;k++)snow24+=n(H.snowfall&&H.snowfall[k]);
    var D=top.daily, Dt=tal.daily, days=[];
    for(var d=0;d<D.time.length;d++){
      var date=D.time[d];
      if(date<now.day)continue;
      var fls=[],flAll=[];
      for(var h=0;h<H.time.length;h++){
        if(H.time[h].slice(0,10)!==date)continue;
        var hr=+H.time[h].slice(11,13),v=flAt(h);
        if(isNum(v)){flAll.push(v);if(hr>=8&&hr<=17)fls.push(v);}
      }
      var dt=new Date(date+'T12:00:00');
      days.push({
        date:date,
        label:date===now.day?'Heute':WD[dt.getDay()],
        dd:p2(dt.getDate())+'.'+p2(dt.getMonth()+1)+'.',
        fl:avg(fls.length?fls:flAll),
        flMin:flAll.length?Math.min.apply(null,flAll):null,
        flMax:flAll.length?Math.max.apply(null,flAll):null,
        tTop:D.temperature_2m_max[d], tTopMin:D.temperature_2m_min[d],
        tTal:Dt.temperature_2m_max[d], tTalMin:Dt.temperature_2m_min[d],
        snow:n(D.snowfall_sum[d]), precip:n(D.precipitation_sum[d]),
        code:D.weather_code[d]
      });
      if(days.length>=7)break;
    }
    var sum7=0;days.forEach(function(x){sum7+=x.snow;});
    return {
      nowTop:top.current&&top.current.temperature_2m, nowTal:tal.current&&tal.current.temperature_2m,
      nowFl:flAt(nowIdx), snow24:snow24, sum7:sum7, days:days, fetched:new Date()
    };
  }

  /* =====================================================================
     Darstellung: Ticker, Schneepegel, Kacheln
     ===================================================================== */
  function snowStations(){
    if(official&&official.stations&&official.stations.length){
      return official.stations.slice().sort(function(a,b){return b.alt-a.alt;}).map(function(s){return {name:s.name,alt:s.alt,depth:s.depth,fresh:s.fresh};});
    }
    if(!manual)return [];
    return [{name:'Berg',alt:null,depth:n(manual.snowTop),fresh:null},{name:'Tal',alt:null,depth:n(manual.snowValley),fresh:null}];
  }

  function stakeSvg(depth,fresh,maxCm){
    /* Schneepegel: rot-weiße Stange mit 20-cm-Feldern, Schnee bis zur Messhöhe */
    var Wd=120,Hd=200,top=14,ground=186,h=ground-top;
    var y=function(cm){return ground-h*Math.min(cm,maxCm)/maxCm;};
    var s='<svg viewBox="0 0 '+Wd+' '+Hd+'" aria-hidden="true">';
    for(var c=0;c<=maxCm;c+=50){s+='<line x1="16" x2="104" y1="'+y(c)+'" y2="'+y(c)+'" stroke="var(--line)" stroke-width="1"/>';
      s+='<text x="2" y="'+(y(c)+3.5)+'" font-size="10" font-family="var(--mono)" fill="var(--muted)">'+c+'</text>';}
    for(var seg=0;seg<maxCm;seg+=20){s+='<rect x="55" y="'+y(seg+20)+'" width="10" height="'+(y(seg)-y(seg+20))+'" fill="'+((seg/20)%2?'#ffffff':'var(--accent)')+'" stroke="var(--line)" stroke-width=".5"/>';}
    if(depth>0){
      var yt=y(depth);
      s+='<path d="M18 '+ground+' Q22 '+(yt+6)+' 40 '+yt+' L80 '+yt+' Q98 '+(yt+6)+' 102 '+ground+' Z" fill="var(--snow)" stroke="var(--snow-shade)" stroke-width="1.5"/>';
      if(fresh>0){var yf=y(Math.max(0,depth-fresh));s+='<path d="M24 '+yf+' Q28 '+(yt+4)+' 42 '+yt+' L78 '+yt+' Q92 '+(yt+4)+' 96 '+yf+' Z" fill="var(--ice)" opacity=".28"/>';}
    }
    s+='<line x1="10" x2="110" y1="'+ground+'" y2="'+ground+'" stroke="var(--muted)" stroke-width="2"/></svg>';
    return s;
  }

  function renderSnow(){
    var st=snowStations();
    var maxDepth=0;st.forEach(function(s){maxDepth=Math.max(maxDepth,s.depth);});
    var maxCm=Math.max(100,Math.ceil((maxDepth+20)/50)*50);
    var row=$('stakes');row.innerHTML='';
    st.forEach(function(s){
      var el=document.createElement('div');el.className='stake';
      el.innerHTML=stakeSvg(s.depth,s.fresh,maxCm)+
        '<span class="val num">'+fmtInt(s.depth)+'<em> cm</em></span>'+
        '<span class="name">'+esc(s.name)+'</span>'+
        (s.alt?'<span class="alt">'+fmtInt(s.alt)+' m</span>':'')+
        (s.fresh!=null?'<span class="fresh'+(s.fresh>=10?' hot':'')+'">+'+fmtInt(s.fresh)+' cm neu</span>':'');
      row.appendChild(el);
    });
    if(official&&official.stations){
      $('stake-src').textContent='ischgl.com'+(official.stale?' · älterer Stand':'');
      $('stake-last').textContent=official.lastSnowfall?'Letzter Schneefall: '+official.lastSnowfall:'';
    } else {
      $('stake-src').textContent='von Hand eingetragen';
      $('stake-last').textContent=manual&&manual.updated?'Stand: '+manual.updated:'';
    }
    /* Ticker: Schnee an der Idalp bzw. oberster Pegel */
    var idalp=st.filter(function(s){return /Idalp|Berg/.test(s.name);})[0]||st[0];
    $('tk-depth').innerHTML=idalp?fmtInt(idalp.depth)+'<em>cm</em>':'–';
  }

  function renderManual(){
    var s=manual||FALLBACK;
    $('st-pill').className='pill '+(STATUS[s.status]?s.status:'closed');
    $('st-label').textContent=STATUS[s.status]||STATUS.closed;
    $('st-note').textContent=s.statusNote||'';
    $('st-lifts').innerHTML=fmtInt(s.liftsOpen)+'<span> / '+fmtInt(s.liftsTotal||46)+'</span>';
    $('st-slopes').innerHTML=fmtInt(s.slopesOpen)+'<span> / '+fmtInt(s.slopesTotal||239)+' km</span>';
    var gn=$('group-note');
    if(s.groupNote&&String(s.groupNote).trim()){gn.textContent=s.groupNote;gn.hidden=false;}else gn.hidden=true;
  }

  function renderWxTiles(){
    if(!wx){$('st-ttop').textContent='–';$('st-tval').textContent='–';$('tk-top').textContent='–';$('tk-zero').textContent='–';$('tk-fc').textContent='–';return;}
    $('st-ttop').textContent=fmtTemp(wx.nowTop);
    $('st-tval').textContent=fmtTemp(wx.nowTal);
    $('tk-top').textContent=fmtTemp(wx.nowTop);
    $('tk-zero').innerHTML=isNum(wx.nowFl)?fmtInt(Math.round(wx.nowFl/10)*10)+'<em>m</em>':'–';
    $('tk-fc').innerHTML=fmtInt(wx.sum7)+'<em>cm</em>';
    $('tk-fc').parentNode.classList.toggle('hot',wx.sum7>=20);
  }

  /* =====================================================================
     Berg mit Nullgradgrenze
     ===================================================================== */
  var ZMIN=1000, ZMAX=3600, Y0=430, Y1=30;
  function yOf(z){return Y0-(z-ZMIN)*(Y0-Y1)/(ZMAX-ZMIN);}
  var RIDGE=[[0,1300],[40,1355],[90,1377],[150,1560],[210,1830],[270,2080],[320,2270],[350,2320],[420,2345],[470,2480],[520,2624],[565,2540],[610,2615],[660,2760],[705,2872],[750,2760],[800,2700],[850,2864],[905,2610],[950,2420],[1000,2260]];
  var BACK=[[0,2050],[70,2450],[150,2280],[250,2950],[330,2720],[430,3180],[505,2930],[600,3330],[690,3010],[790,3220],[880,2960],[1000,3120]];
  var MARKS=[{n:'Ischgl',z:1377,x:90,a:'start'},{n:'Idalp',z:2320,x:350,a:'middle',an:'end'},{n:'Pardatschgrat',z:2624,x:520,a:'middle'},{n:'Greitspitz',z:2872,x:705,a:'middle'}];
  var M={}, VW=1000, FS=1, narrow=null;
  function X(x){return +(x*VW/1000).toFixed(1);}
  function polyPath(pts){return 'M'+pts.map(function(p){return X(p[0])+' '+yOf(p[1]).toFixed(1);}).join(' L')+' L'+VW+' 440 L0 440 Z';}
  function edgePath(){ /* leicht unruhige Schneekante */
    var d='M0 -2',step=VW/24;
    for(var i=0;i<=24;i++){d+=' L'+(i*step).toFixed(1)+' '+(i%2?3:0.5);}
    return d+' L'+VW+' -2 Z';
  }

  function buildMountain(){
    var root=$('mtn');
    narrow=root.clientWidth>0&&root.clientWidth<600;
    VW=narrow?560:1000;FS=narrow?1.7:1;
    root.setAttribute('viewBox','0 0 '+VW+' 440');
    root.innerHTML='';
    var defs=svg('defs',{},root);
    var g=svg('linearGradient',{id:'skyg',x1:0,y1:0,x2:0,y2:1},defs);
    svg('stop',{offset:'0',style:'stop-color:var(--sky-top)'},g);
    svg('stop',{offset:'1',style:'stop-color:var(--sky-bot)'},g);
    var cp=svg('clipPath',{id:'mclip'},defs);svg('path',{d:polyPath(RIDGE)},cp);
    var cpUp=svg('clipPath',{id:'upclip'},defs);M.upRect=svg('rect',{x:0,y:0,width:VW,height:200},cpUp);
    var cpDn=svg('clipPath',{id:'dnclip'},defs);M.dnRect=svg('rect',{x:0,y:200,width:VW,height:240},cpDn);

    svg('rect',{x:0,y:0,width:VW,height:440,fill:'url(#skyg)'},root);
    [1500,2000,2500,3000,3500].forEach(function(z){
      svg('line',{x1:0,x2:VW,y1:yOf(z),y2:yOf(z),'stroke-width':1,'stroke-dasharray':'2 6',style:'stroke:var(--muted);opacity:.35'},root);
      var t=svg('text',{x:8,y:yOf(z)-5,'font-size':12*FS,style:'fill:var(--muted)'},root);t.textContent=fmtInt(z)+' m';
    });
    M.fx=svg('g',{},root);
    svg('path',{d:polyPath(BACK),style:'fill:var(--ridge-back)'},root);
    var mg=svg('g',{'clip-path':'url(#mclip)'},root);
    svg('rect',{x:0,y:0,width:VW,height:440,style:'fill:var(--rock)'},mg);
    M.cap=svg('g',{'class':'snowcap'},mg);
    svg('rect',{x:0,y:-460,width:VW,height:460,style:'fill:var(--snow)'},M.cap);
    svg('path',{d:edgePath(),style:'fill:var(--snow)'},M.cap);
    svg('path',{d:polyPath(RIDGE),fill:'none','stroke-width':2,style:'stroke:var(--snow-shade);opacity:.8'},root);
    /* Schneefallgrenze: Linie + Schild rechts unter der Linie */
    M.sline=svg('g',{'class':'sline'},root);
    svg('line',{x1:0,x2:VW,y1:0,y2:0,'stroke-width':2,'stroke-dasharray':'3 5',style:'stroke:var(--snowline)'},M.sline);
    M.slineBg=svg('rect',{x:0,y:6,width:10,height:20*FS+2,rx:4,style:'fill:var(--snowline)'},M.sline);
    M.slineTxt=svg('text',{x:VW-12,y:6+15*FS,'font-size':13*FS,'font-weight':600,'text-anchor':'end',style:'fill:#fff'},M.sline);
    /* Nullgradgrenze: Linie + Schild rechts über der Linie */
    M.zero=svg('g',{'class':'zero'},root);
    svg('line',{x1:0,x2:VW,y1:0,y2:0,'stroke-width':3.5,'stroke-dasharray':'14 8',style:'stroke:var(--zero)'},M.zero);
    M.zeroBg=svg('rect',{x:0,y:-(24*FS+8),width:10,height:24*FS,rx:5,style:'fill:var(--zero)'},M.zero);
    M.zeroTxt=svg('text',{x:VW-12,y:-(8*FS+8),'font-size':15*FS,'font-weight':700,'text-anchor':'end',style:'fill:#fff'},M.zero);
    /* Stationen */
    M.marks=MARKS.map(function(m){
      var gm=svg('g',{},root),x=X(m.x),y=yOf(m.z);
      svg('circle',{cx:x,cy:y,r:6,'stroke-width':2.5,style:'fill:var(--ink);stroke:var(--snow)'},gm);
      var anchor=(narrow&&m.an)?m.an:m.a, tx=anchor==='start'?x-4:anchor==='end'?x+6:x;
      var st='fill:var(--ink);paint-order:stroke;stroke:var(--paper);stroke-width:'+(narrow?5:3.5)+'px;stroke-linejoin:round';
      var t2=svg('text',{x:tx,y:y-14,'font-size':17*FS,'font-weight':700,'text-anchor':anchor,style:st},gm);
      var t1=svg('text',{x:tx,y:y-14-17*FS,'font-size':12*FS,'font-weight':600,'text-anchor':anchor,style:st},gm);
      t1.textContent=narrow?m.n:m.n+' '+fmtInt(m.z);
      return {m:m,t:t2};
    });
  }
  window.addEventListener('resize',function(){
    clearTimeout(buildMountain._t);
    buildMountain._t=setTimeout(function(){
      var w=$('mtn').clientWidth,nn=w>0&&w<600;
      if(nn!==narrow){buildMountain();if(wx)renderMountainDay();}
    },200);
  });

  function particles(day,ySnow){
    var fx=M.fx;fx.innerHTML='';
    if(!day||reduceMotion)return;
    var snowy=day.snow>=0.5, wet=day.precip>=1;
    if(!snowy&&!wet)return;
    M.upRect.setAttribute('height',Math.max(0,ySnow));
    M.dnRect.setAttribute('y',Math.max(0,ySnow));M.dnRect.setAttribute('height',Math.max(0,440-ySnow));
    var count=Math.min(70,10+Math.round((day.snow*3)+(day.precip*2)));
    if(narrow)count=Math.round(count*.6);
    var up=svg('g',{'clip-path':'url(#upclip)'},fx), dn=svg('g',{'clip-path':'url(#dnclip)'},fx);
    for(var i=0;i<count;i++){
      var x=Math.random()*VW,dur=(4+Math.random()*4).toFixed(2),del=(-Math.random()*8).toFixed(2);
      if(snowy){svg('circle',{cx:x,cy:0,r:((1.5+Math.random()*2.5)*(narrow?1.3:1)).toFixed(1),'class':'flake',style:'fill:#fff;opacity:.9;animation-duration:'+dur+'s;animation-delay:'+del+'s'},up);}
      if(wet&&ySnow<440){svg('line',{x1:x,x2:x-3,y1:0,y2:14,'class':'drop','stroke-width':2,style:'stroke:var(--snowline);opacity:.7;animation-duration:'+(dur/3).toFixed(2)+'s;animation-delay:'+del+'s'},dn);}
    }
  }

  function verdict(d){
    var fl=d.fl, sf=isNum(fl)?Math.max(0,fl-300):null, t, x='', badge='';
    if(!isNum(fl)){return {t:'Keine Daten',x:'Für diesen Tag fehlt die Prognose.',b:''};}
    if(fl<=Z_TAL){t='Winter bis ins Tal';x='Frost bis runter nach Ischgl. Schnee bleibt überall liegen.';}
    else if(fl<=2320){t='Winter ab '+fmtAlt(fl);x='Idalp und alles darüber unter null, unten im Tal Plusgrade.';}
    else if(fl<=Z_TOP){t='Nur ganz oben Frost';x='Minusgrade erst ab '+fmtAlt(fl)+'. Unterhalb taut es.';}
    else {t='Zu warm am Berg';x='Selbst auf der Greitspitze über 0 °C. Schnee taut, auch ganz oben.';}
    if(d.snow>=1){x+=' Dazu '+fmtInt(d.snow)+' cm Neuschnee am Gipfel, Schnee ab ca. '+fmtAlt(sf)+'.';}
    else if(d.precip>=1){x+=sf>Z_TOP?' Niederschlag kommt bis oben als Regen.':' Etwas Niederschlag, oben als Schnee.';}
    if(d.snow>=20)badge='Powder-Alarm';else if(d.snow>=5)badge='Neuschnee';else if(fl<=Z_TAL)badge='Winter pur';
    return {t:t,x:x,b:badge};
  }

  function labelBox(bg,txt,str){
    txt.textContent=str;
    var w;try{w=txt.getComputedTextLength();}catch(e){w=0;}
    if(!w)w=str.length*8.6*FS;
    w+=20;bg.setAttribute('x',VW-w-2);bg.setAttribute('width',w);
  }

  var selDay=0;
  function renderMountainDay(){
    if(!wx||!wx.days.length)return;
    var d=wx.days[selDay]||wx.days[0];
    var fl=isNum(d.fl)?d.fl:Z_TOP+400;
    var yZ=Math.max(Y1+30*FS,Math.min(445,yOf(fl)));
    var sf=Math.max(0,fl-300), yS=Math.max(Y1,Math.min(445,yOf(sf)));
    M.cap.style.transform='translateY('+yOf(fl)+'px)';
    M.zero.style.transform='translateY('+yZ+'px)';
    labelBox(M.zeroBg,M.zeroTxt,'0 °C · '+fmtAlt(fl)+(fl>ZMAX?' ↑':''));
    var showS=(d.precip>=1||d.snow>=0.5)&&yS<420;
    M.sline.style.display=showS?'':'none';
    M.sline.style.transform='translateY('+yS+'px)';
    if(showS)labelBox(M.slineBg,M.slineTxt,'Schnee ab ca. '+fmtAlt(sf));
    M.marks.forEach(function(mk){
      var t=null;
      if(isNum(d.tTal)&&isNum(d.tTop))t=d.tTal+(d.tTop-d.tTal)*(mk.m.z-Z_TAL)/(Z_TOP-Z_TAL);
      mk.t.textContent=fmtTemp(t);
    });
    particles(d,yS);
    var v=verdict(d);
    $('mt-title').textContent=v.t;$('mt-text').textContent=v.x;
    var b=$('mt-badge');b.textContent=v.b;b.hidden=!v.b;
    $('days').querySelectorAll('.daybtn').forEach(function(btn,i){btn.setAttribute('aria-pressed',i===selDay?'true':'false');});
  }

  function icon(code,snow){
    var c=n(code);
    var cloud='<path d="M8 18h9a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 8 18z" fill="currentColor" opacity=".25" stroke="currentColor" stroke-width="1.6"/>';
    if((c>=71&&c<=77)||c===85||c===86||snow>=1)return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" style="color:var(--ice)"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M10 4.5l2 1.5 2-1.5M10 19.5l2-1.5 2 1.5"/></svg>';
    if((c>=51&&c<=67)||(c>=80&&c<=82)||c>=95)return '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" aria-hidden="true" style="color:var(--muted)">'+cloud.replace('M8 18','M8 15').replace('a4 4 0 0 0 .5-8','a4 4 0 0 0 .5-8')+'<path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" stroke="var(--ice)" stroke-width="1.8"/></svg>';
    if(c>=2)return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" style="color:var(--muted)">'+cloud+'</svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="#f2a900" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="#f2a900" fill-opacity=".35"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>';
  }

  function renderDays(){
    var box=$('days');box.innerHTML='';
    if(!wx){return;}
    wx.days.forEach(function(d,i){
      var b=document.createElement('button');b.type='button';b.className='daybtn';b.setAttribute('aria-pressed',i===selDay?'true':'false');
      b.innerHTML='<span class="dn">'+esc(d.label)+'</span><span class="dd">'+esc(d.dd)+'</span>'+icon(d.code,d.snow)+
        '<span class="t">'+fmtTemp(d.tTop)+' / '+fmtTemp(d.tTal)+'</span>'+
        '<span class="sn'+(d.snow>=5?' hot':'')+'">'+(d.snow>=0.5?'+'+fmtInt(d.snow)+' cm':'0° '+(isNum(d.fl)?fmtInt(Math.round(d.fl/100)*100):'–'))+'</span>';
      b.title='Gipfel / Tal, Tageshöchstwert';
      b.addEventListener('click',function(){selDay=i;renderMountainDay();});
      box.appendChild(b);
    });
  }

  function renderWx(){
    renderWxTiles();
    if(!wx){
      $('mt-title').textContent=wxErr?'Prognose nicht erreichbar':'Lade Prognose …';
      $('mt-text').textContent=wxErr?'Open-Meteo antwortet gerade nicht. Später nochmal aktualisieren.':'';
      return;
    }
    if(selDay>=wx.days.length)selDay=0;
    renderDays();renderMountainDay();
    $('mt-src').textContent='Quelle: Open-Meteo · geladen '+clock(wx.fetched);
  }

  /* =====================================================================
     Aktualisieren
     ===================================================================== */
  var busy=false;
  function setLive(state,text,src){
    var el=$('live-state');el.className='live-dot'+(state?' '+state:'');
    $('live-text').textContent=text;$('live-src').textContent=src||'';
  }
  function refresh(force){
    if(busy)return Promise.resolve();
    busy=true;var btn=$('btn-refresh');btn.disabled=true;btn.classList.add('spin');
    setLive('', 'Aktualisiere …');
    if(force)refreshCams();
    return Promise.all([loadManual(),loadOfficial(force),loadWeather()]).then(function(){
      renderManual();renderSnow();renderWx();
      lastRefresh=Date.now();
      var probs=[];
      if(wxErr)probs.push('Wetter nicht erreichbar');
      if(hasServer&&officialErr&&!official)probs.push('Schneebericht nicht erreichbar, zeige Werte von Hand');
      else if(official&&official.stale)probs.push('Schneebericht gerade nicht erreichbar, zeige letzten Stand');
      var src=[hasServer?'ischgl.com':'',wx?'Open-Meteo':''].filter(Boolean).join(' · ');
      if(probs.length)setLive('err','Aktualisiert '+clock()+' · '+probs.join(' · '),src);
      else setLive('on','Aktualisiert '+clock(),src);
    }).finally(function(){busy=false;btn.disabled=false;btn.classList.remove('spin');});
  }
  $('btn-refresh').addEventListener('click',function(){refresh(true).then(function(){toast('Alles auf dem neuesten Stand.');});});
  setInterval(function(){if(!document.hidden)refresh(false);},15*60*1000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&Date.now()-lastRefresh>10*60*1000)refresh(false);});

  /* =====================================================================
     Webcams (Bilder direkt von ischgl.com)
     ===================================================================== */
  var CAM_PAGE='https://www.ischgl.com/en/plan-your-trip/webcams/';
  var CAM_IMG='https://www.ischgl.com/var/webcams/';
  var CAM_MS=5*60*1000;
  var CAMS=[
    {id:'100000136',n:'Greitspitz',a:2872,u:'greitspitz_webcam_100000136',p:1},
    {id:'100007712',n:'Palinkopf',a:2864,u:'palinkopf_webcam_100007712'},
    {id:'100178319',n:'Palinkopf (2. Kamera)',a:2864,u:'palinkopf_webcam_100178319'},
    {id:'100163839',n:'Piz Val Gronda',a:2812,u:'piz-val-gronda_webcam_100163839'},
    {id:'100178353',n:'Pardatschgrat',a:2624,u:'pardatschgrat_webcam_100178353',p:1},
    {id:'100178355',n:'Pardatschgrat (2. Kamera)',a:2624,u:'pardatschgrat_webcam_100178355'},
    {id:'100178343',n:'Alp Trida Sattel',a:2511,u:'alp-trida-sattel_webcam_100178343',ch:1},
    {id:'100178361',n:'Samnaun TV',a:2488,u:'samnaun-tv_webcam_100178361',ch:1},
    {id:'100178345',n:'Idalp',a:2320,u:'idalp_webcam_100178345',p:1},
    {id:'100178351',n:'Ischgl TV (Idalp)',a:2320,u:'ischgl-tv_webcam_100178351'},
    {id:'108486387',n:'Idalp (2. Kamera)',a:2300,u:'idalp_webcam_108486387'},
    {id:'100178341',n:'Alp Trida',a:2260,u:'alp-trida_webcam_100178341',ch:1},
    {id:'100178359',n:'Samnaun-Dorf',a:1840,u:'samnaun-dorf_webcam_100178359',ch:1},
    {id:'100178357',n:'Samnaun-Compatsch',a:1700,u:'samnaun-compatsch_webcam_100178357',ch:1},
    {id:'124696581',n:'Ischgl Dorf',a:1400,u:'ischgl-dorf_webcam_124696581',p:1},
    {id:'100178315',n:'FlyingCam Ischgl',a:1377,u:'flyingcam-ischgl_webcam_100178315'}
  ];
  var camBust=0;
  function camUrl(c){return CAM_IMG+c.id+'.jpg?t='+(Math.floor(Date.now()/CAM_MS)+camBust);}
  function buildCams(){
    var grid=$('cams');grid.innerHTML='';
    CAMS.forEach(function(c){
      var el=document.createElement('article');el.className='cam';
      el.innerHTML=
        '<button type="button" class="cam-media" data-cam="'+c.id+'" aria-label="'+esc(c.n)+' vergrößern">'+
          '<span class="cam-empty"><b>'+fmtInt(c.a)+' m</b><span>Bild wird geladen …</span></span>'+
          '<img alt="Webcam '+esc(c.n)+'" loading="lazy" decoding="async" hidden>'+
          '<span class="cam-alt">'+fmtInt(c.a)+' m</span>'+
          (c.p?'<span class="cam-tip">Tipp</span>':'')+
          '<span class="cam-live" hidden><i></i><span>Stand –</span></span>'+
        '</button>'+
        '<div class="cam-body"><div><strong>'+esc(c.n)+'</strong><small>'+(c.ch?'Samnaun':'Ischgl')+'</small></div>'+
        '<a href="'+CAM_PAGE+c.u+'" target="_blank" rel="noopener">Live ↗</a></div>';
      var img=el.querySelector('img'),empty=el.querySelector('.cam-empty'),live=el.querySelector('.cam-live');
      img.addEventListener('load',function(){img.dataset.loaded='1';img.hidden=false;empty.hidden=true;live.hidden=false;live.lastChild.textContent='Stand '+clock();});
      img.addEventListener('error',function(){
        if(!img.dataset.loaded){img.hidden=true;empty.hidden=false;live.hidden=true;empty.querySelector('span').textContent='Bild nicht verfügbar · Live ansehen';}
      });
      c.img=img;img.src=camUrl(c);
      grid.appendChild(el);
    });
    grid.addEventListener('click',function(e){
      var b=e.target.closest('.cam-media');if(!b)return;
      var c=CAMS.filter(function(x){return x.id===b.dataset.cam;})[0];if(c)openLightbox(c);
    });
  }
  function refreshCams(){
    camBust++;
    CAMS.forEach(function(c){
      if(!c.img)return;
      var pre=new Image();pre.onload=function(){c.img.src=pre.src;};pre.src=camUrl(c);
    });
  }
  setInterval(function(){if(!document.hidden)refreshCams();},CAM_MS);
  var lb=$('lightbox');
  function openLightbox(c){
    $('lb-title').textContent=c.n;
    $('lb-meta').textContent=fmtInt(c.a)+' m · '+(c.ch?'Samnaun':'Ischgl');
    $('lb-img').src=c.img&&c.img.dataset.loaded?c.img.src:camUrl(c);
    $('lb-img').alt='Webcam '+c.n;
    $('lb-live').href=CAM_PAGE+c.u;
    if(lb.showModal)lb.showModal();else window.open(CAM_PAGE+c.u,'_blank');
  }
  $('lb-close').addEventListener('click',function(){lb.close();});
  lb.addEventListener('click',function(e){if(e.target===lb)lb.close();});

  /* =====================================================================
     Bearbeiten
     server: server.py mit EDIT_TOKEN speichert direkt
     file:   statischer Webspace, Seite mit #bearbeiten öffnen → data.json herunterladen
     ===================================================================== */
  var mode=null, dlg=$('editor'), saving=false;
  var FIELDS=['liftsOpen','liftsTotal','slopesOpen','snowTop','snowValley'];
  function enableFileMode(){
    if(mode)return;mode='file';
    $('ownerbar-text').textContent='Bearbeitungsmodus ohne Server: Das Formular erzeugt eine neue data.json. Ersetze damit die Datei im Seitenordner und lade den Ordner neu hoch.';
    $('e-token-wrap').hidden=true;$('ed-save').textContent='data.json herunterladen';$('ownerbar').hidden=false;
  }
  function checkHash(){if(!mode&&/^#bearbeiten$/i.test(location.hash))enableFileMode();}
  window.addEventListener('hashchange',checkHash);
  function openEditor(){
    var s=manual||FALLBACK;
    $('e-token').value=ls('ischgl26-token')||'';
    $('e-status').value=STATUS[s.status]?s.status:'closed';$('e-statusNote').value=s.statusNote||'';
    FIELDS.forEach(function(k){$('e-'+k).value=n(s[k]);});
    $('e-groupNote').value=s.groupNote||'';
    var m=$('ed-msg');m.classList.remove('err');
    m.textContent=mode==='file'?'Lädt eine neue data.json herunter. Erst nach dem Hochladen sehen alle den neuen Stand.':'Speichern ändert die Seite für alle.';
    dlg.showModal();
  }
  function collect(){
    var next=JSON.parse(JSON.stringify(manual||FALLBACK));
    next.status=$('e-status').value;next.statusNote=$('e-statusNote').value.trim();
    FIELDS.forEach(function(k){next[k]=n($('e-'+k).value);});
    next.groupNote=$('e-groupNote').value.trim();
    next.updated=nowStr();
    return next;
  }
  function downloadJson(obj){
    var blob=new Blob([JSON.stringify(obj,null,2)+'\n'],{type:'application/json'});
    var url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='data.json';document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},4000);
  }
  $('btn-edit').addEventListener('click',openEditor);
  $('ed-close').addEventListener('click',function(){dlg.close();});
  $('ed-save').addEventListener('click',function(){
    if(saving)return;
    var next=collect();
    if(mode==='file'){
      downloadJson(next);manual=next;renderManual();renderSnow();dlg.close();
      toast('data.json heruntergeladen. Jetzt im Ordner ersetzen und hochladen.');return;
    }
    var btn=$('ed-save'),m=$('ed-msg'),token=$('e-token').value;
    if(!token){m.textContent='Bitte das Passwort eintragen.';m.classList.add('err');$('e-token').focus();return;}
    saving=true;btn.disabled=true;btn.textContent='Speichert …';m.classList.remove('err');m.textContent='Wird gespeichert …';
    getJSON('api/data',{method:'POST',headers:{'Content-Type':'application/json','X-Edit-Token':token},body:JSON.stringify(next)})
      .then(function(){ls('ischgl26-token',token);manual=next;renderManual();renderSnow();dlg.close();toast('Gespeichert. Alle sehen jetzt den neuen Stand.');})
      .catch(function(e){m.textContent=e.message||'Speichern hat nicht geklappt.';m.classList.add('err');})
      .finally(function(){saving=false;btn.disabled=false;btn.textContent='Speichern';});
  });

  /* =====================================================================
     Packliste, Kopieren, Navigation
     ===================================================================== */
  var items=['Skipass gekauft oder Mehrtagespass','Ausweis','Helm &amp; Skibrille','Handschuhe, Mütze, Buff','Warme Schicht für den Abend draußen','Sonnencreme &amp; Lippenschutz','Powerbank &amp; Ladekabel','Ski/Board gewachst, Bindung geprüft'];
  var KEY='ischgl26-pack',packed={};
  try{packed=JSON.parse(ls(KEY)||'{}')||{};}catch(e){packed={};}
  items.forEach(function(txt,i){
    var id='pack-'+i,l=document.createElement('label');l.setAttribute('for',id);
    l.innerHTML='<input type="checkbox" id="'+id+'"'+(packed[i]?' checked':'')+'><span>'+txt+'</span>';
    l.querySelector('input').addEventListener('change',function(e){packed[i]=e.target.checked;ls(KEY,JSON.stringify(packed));});
    $('check').appendChild(l);
  });
  document.querySelectorAll('[data-copy]').forEach(function(b){
    b.addEventListener('click',function(){
      var txt=b.getAttribute('data-copy');
      function reset(){setTimeout(function(){b.textContent='Kopieren';},1500);}
      function fallback(){var r=document.createRange();r.selectNodeContents(b.previousElementSibling);var s=getSelection();s.removeAllRanges();s.addRange(r);b.textContent='Markiert';reset();}
      try{navigator.clipboard.writeText(txt).then(function(){b.textContent='Kopiert';reset();},fallback);}catch(e){fallback();}
    });
  });
  if('IntersectionObserver' in window){
    var links={};document.querySelectorAll('#navlinks a').forEach(function(a){links[a.getAttribute('href').slice(1)]=a;});
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){Object.keys(links).forEach(function(k){links[k].classList.toggle('on',k===e.target.id);});}});},{rootMargin:'-45% 0px -50% 0px'});
    Object.keys(links).forEach(function(k){var s=$(k);if(s)io.observe(s);});
  }

  /* =====================================================================
     Start
     ===================================================================== */
  buildMountain();
  buildCams();
  getJSON('api/config').then(function(cfg){
    hasServer=!!(cfg&&cfg.snow);
    if(cfg&&cfg.editable){mode='server';$('ownerbar').hidden=false;}else checkHash();
  }).catch(checkHash).then(function(){refresh(false);});
})();
