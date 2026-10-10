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
  var fmtBerlin=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false});
  function berlinParts(d){var s=fmtBerlin.format(d||new Date());return {day:s.slice(0,10),hour:s.slice(0,10)+'T'+s.slice(11,13)+':00'};}
  var WD=['So','Mo','Di','Mi','Do','Fr','Sa'];
  function getJSON(url,opt){
    return fetch(url,Object.assign({cache:'no-store'},opt||{})).then(function(r){
      return r.json().catch(function(){return null;}).then(function(j){if(!r.ok){var e=new Error((j&&j.error)||('HTTP '+r.status));e.status=r.status;throw e;}return j;});
    });
  }

  var Z_TAL=1377, Z_TOP=2872, LAT=46.9706, LON=10.2906;
  var CAM_IMG='https://www.ischgl.com/var/webcams/';
  var CAM_PAGE='https://www.ischgl.com/en/plan-your-trip/webcams/';
  var CAM_MS=5*60*1000, camBust=0;
  function camSrc(id){return CAM_IMG+id+'.jpg?t='+(Math.floor(Date.now()/CAM_MS)+camBust);}

  /* =====================================================================
     Countdown & Hero-Cam
     ===================================================================== */
  var target=Date.UTC(2026,10,25,23,0,0); /* Do 26.11.2026 00:00 MEZ */
  function daysLeft(){return Math.max(0,Math.ceil((target-Date.now())/86400000));}
  function tick(){
    var diff=target-Date.now();
    if(diff<=0){['cd-d','cd-h','cd-m','cd-s'].forEach(function(i){$(i).textContent='00';});$('cd-note').textContent='Die Saison läuft. Ab auf die Piste!';return;}
    var s=Math.floor(diff/1000);
    $('cd-d').textContent=Math.floor(s/86400);$('cd-h').textContent=p2(Math.floor(s%86400/3600));
    $('cd-m').textContent=p2(Math.floor(s%3600/60));$('cd-s').textContent=p2(s%60);
  }
  tick();setInterval(tick,1000);
  var heroCam=$('hero-cam');
  heroCam.addEventListener('load',function(){heroCam.hidden=false;});
  heroCam.addEventListener('error',function(){if(!heroCam.dataset.ok)heroCam.hidden=true;});
  heroCam.addEventListener('load',function(){heroCam.dataset.ok='1';});
  function loadHeroCam(){var pre=new Image();pre.onload=function(){heroCam.src=pre.src;};pre.src=camSrc('100178345');}
  loadHeroCam();

  /* =====================================================================
     Daten
     ===================================================================== */
  var STATUS={closed:'Geschlossen',partial:'Teilweise offen',open:'Geöffnet'};
  var FALLBACK={updated:'',status:'closed',statusNote:'',snowTop:0,snowValley:0,liftsOpen:0,liftsTotal:46,slopesOpen:0,slopesTotal:239,groupNote:''};
  var manual=null, official=null, officialErr=null, wx=null, wxErr=null, cfg={}, lastRefresh=0;
  var cfgReady=getJSON('api/config').then(function(c){cfg=c||{};}).catch(function(){cfg={};});

  function loadManual(){
    return getJSON('data.json?t='+Date.now()).then(function(j){manual=Object.assign({},FALLBACK,j||{});})
      .catch(function(){if(!manual)manual=Object.assign({},FALLBACK);});
  }
  function loadOfficial(force){
    if(!cfg.snow)return Promise.resolve();
    return getJSON('api/snow'+(force?'?force=1':'')).then(function(j){official=j;officialErr=null;})
      .catch(function(e){officialErr=e.message;});
  }
  function omUrl(elev){
    return 'https://api.open-meteo.com/v1/forecast?latitude='+LAT+'&longitude='+LON+'&elevation='+elev+
      '&timezone=Europe%2FBerlin&past_days=1&forecast_days=7&current=temperature_2m,weather_code'+
      '&hourly=temperature_2m,freezing_level_height,snowfall,precipitation'+
      '&daily=temperature_2m_max,temperature_2m_min,snowfall_sum,precipitation_sum,weather_code';
  }
  function loadWeather(){
    return Promise.all([getJSON(omUrl(Z_TAL),{cache:'default'}),getJSON(omUrl(Z_TOP),{cache:'default'})])
      .then(function(r){wx=buildWx(r[0],r[1]);wxErr=null;})
      .catch(function(e){wxErr=e.message||'Fehler';});
  }
  function zeroFromTemps(tLow,tHigh){
    if(!isNum(tLow)||!isNum(tHigh))return null;
    var lapse=(tLow-tHigh)/(Z_TOP-Z_TAL);if(!(lapse>0.002))lapse=0.0065;
    return Math.max(0,Math.min(5500,Z_TAL+tLow/lapse));
  }
  function avg(a){var s=0,c=0;for(var i=0;i<a.length;i++)if(isNum(a[i])){s+=a[i];c++;}return c?s/c:null;}
  function buildWx(tal,top){
    var now=berlinParts(),H=top.hourly,Ht=tal.hourly;
    var nowIdx=H.time.indexOf(now.hour);
    if(nowIdx<0){nowIdx=0;for(var i=0;i<H.time.length;i++)if(H.time[i]<=now.hour)nowIdx=i;}
    function flAt(i){var v=H.freezing_level_height&&H.freezing_level_height[i];return isNum(v)?v:zeroFromTemps(Ht.temperature_2m[i],H.temperature_2m[i]);}
    var D=top.daily,Dt=tal.daily,days=[];
    for(var d=0;d<D.time.length;d++){
      var date=D.time[d];if(date<now.day)continue;
      var fls=[],flAll=[];
      for(var h=0;h<H.time.length;h++){
        if(H.time[h].slice(0,10)!==date)continue;
        var hr=+H.time[h].slice(11,13),v=flAt(h);
        if(isNum(v)){flAll.push(v);if(hr>=8&&hr<=17)fls.push(v);}
      }
      var dt=new Date(date+'T12:00:00');
      days.push({date:date,label:date===now.day?'Heute':WD[dt.getDay()],dd:p2(dt.getDate())+'.'+p2(dt.getMonth()+1)+'.',
        fl:avg(fls.length?fls:flAll),tTop:D.temperature_2m_max[d],tTal:Dt.temperature_2m_max[d],
        snow:n(D.snowfall_sum[d]),precip:n(D.precipitation_sum[d]),code:D.weather_code[d]});
      if(days.length>=7)break;
    }
    var sum7=0;days.forEach(function(x){sum7+=x.snow;});
    return {nowTop:top.current&&top.current.temperature_2m,nowTal:tal.current&&tal.current.temperature_2m,nowFl:flAt(nowIdx),sum7:sum7,days:days,fetched:new Date()};
  }

  /* =====================================================================
     Schneelage
     ===================================================================== */
  function snowStations(){
    if(official&&official.stations&&official.stations.length)
      return official.stations.slice().sort(function(a,b){return b.alt-a.alt;});
    if(!manual)return [];
    return [{name:'Berg',alt:null,depth:n(manual.snowTop),fresh:null},{name:'Tal',alt:null,depth:n(manual.snowValley),fresh:null}];
  }
  function stakeSvg(depth,fresh,maxCm){
    var W=120,H=200,top=14,ground=186,h=ground-top;
    var y=function(cm){return ground-h*Math.min(cm,maxCm)/maxCm;};
    var s='<svg viewBox="0 0 '+W+' '+H+'" aria-hidden="true">';
    for(var c=0;c<=maxCm;c+=50){
      s+='<line x1="18" x2="104" y1="'+y(c)+'" y2="'+y(c)+'" style="stroke:rgba(255,255,255,.12)"/>';
      s+='<text x="0" y="'+(y(c)+4)+'" font-size="12" style="fill:var(--dim);font-family:var(--cond);font-weight:700">'+c+'</text>';
    }
    for(var seg=0;seg<maxCm;seg+=20)
      s+='<rect x="55" y="'+y(seg+20)+'" width="10" height="'+(y(seg)-y(seg+20))+'" style="fill:'+((seg/20)%2?'#fff':'var(--pink)')+'"/>';
    if(depth>0){
      var yt=y(depth);
      s+='<path d="M16 '+ground+' Q22 '+(yt+6)+' 40 '+yt+' L80 '+yt+' Q98 '+(yt+6)+' 104 '+ground+' Z" style="fill:var(--snow)"/>';
      if(fresh>0){var yf=y(Math.max(0,depth-fresh));s+='<path d="M22 '+yf+' Q28 '+(yt+4)+' 42 '+yt+' L78 '+yt+' Q92 '+(yt+4)+' 98 '+yf+' Z" style="fill:var(--cyan);opacity:.55"/>';}
    }
    return s+'<line x1="8" x2="112" y1="'+ground+'" y2="'+ground+'" style="stroke:var(--mute);stroke-width:2"/></svg>';
  }
  function renderSnow(){
    var st=snowStations(),maxDepth=0;
    st.forEach(function(s){maxDepth=Math.max(maxDepth,s.depth);});
    var maxCm=Math.max(100,Math.ceil((maxDepth+20)/50)*50);
    var row=$('stakes');row.innerHTML='';
    st.forEach(function(s){
      var el=document.createElement('div');el.className='stake';
      el.innerHTML=stakeSvg(s.depth,s.fresh,maxCm)+'<span class="val num">'+fmtInt(s.depth)+'<em>cm</em></span>'+
        '<span class="name">'+esc(s.name)+'</span>'+(s.alt?'<span class="alt">'+fmtInt(s.alt)+' m</span>':'')+
        (s.fresh!=null?'<span class="fresh'+(s.fresh>=10?' hot':'')+'">+'+fmtInt(s.fresh)+' cm neu</span>':'');
      row.appendChild(el);
    });
    if(official&&official.stations){
      $('stake-src').textContent='ischgl.com'+(official.stale?' · älterer Stand':'');
      $('stake-last').textContent=official.lastSnowfall?'Letzter Schneefall: '+official.lastSnowfall:'';
    }else{
      $('stake-src').textContent='von Hand';
      $('stake-last').textContent=manual&&manual.updated?'Stand: '+manual.updated:'';
    }
  }
  function renderManual(){
    var s=manual||FALLBACK,st=STATUS[s.status]?s.status:'closed';
    $('st-pill').className='status '+st;$('st-label').textContent=STATUS[st];
    $('st-box').classList.toggle('open',st==='open');
    $('st-note').textContent=s.statusNote||'';
    $('st-lifts').innerHTML=fmtInt(s.liftsOpen)+'<span> / '+fmtInt(s.liftsTotal||46)+'</span>';
    $('st-slopes').innerHTML=fmtInt(s.slopesOpen)+'<span> / '+fmtInt(s.slopesTotal||239)+' km</span>';
    var gn=$('group-note');
    if(s.groupNote&&String(s.groupNote).trim()){gn.textContent=s.groupNote;gn.hidden=false;}else gn.hidden=true;
  }
  function renderMarquee(){
    var items=[],st=snowStations(),s=manual||FALLBACK;
    if(wx){
      items.push('Gipfel '+fmtTemp(wx.nowTop));
      if(isNum(wx.nowFl))items.push('0°-Grenze '+fmtAlt(wx.nowFl));
      items.push('Neuschnee 7 Tage '+fmtInt(wx.sum7)+' cm');
      if(wx.sum7>=20)items.push('Powder-Alarm');
    }
    var idalp=st.filter(function(x){return /Idalp|Berg/.test(x.name);})[0];
    if(idalp)items.push('Schnee Idalp '+fmtInt(idalp.depth)+' cm');
    items.push('Lifte '+fmtInt(s.liftsOpen)+'/'+fmtInt(s.liftsTotal||46));
    if(daysLeft()>0)items.push('Noch '+daysLeft()+' Tage bis Opening');else items.push('Saison läuft');
    items.push('239 km Piste');
    var html=items.map(function(t){return '<span>'+esc(t)+'</span>';}).join('');
    var tr=$('marquee');tr.innerHTML=html+html;
    tr.style.animationDuration=Math.max(24,items.length*5)+'s';
  }
  function renderWxFacts(){
    $('st-ttop').textContent=wx?fmtTemp(wx.nowTop):'–';
    $('st-tval').textContent=wx?fmtTemp(wx.nowTal):'–';
  }

  /* =====================================================================
     Berg mit 0°-Grenze
     ===================================================================== */
  var ZMIN=1000,ZMAX=3600,Y0=430,Y1=30;
  function yOf(z){return Y0-(z-ZMIN)*(Y0-Y1)/(ZMAX-ZMIN);}
  var RIDGE=[[0,1300],[40,1355],[90,1377],[150,1560],[210,1830],[270,2080],[320,2270],[350,2320],[420,2345],[470,2480],[520,2624],[565,2540],[610,2615],[660,2760],[705,2872],[750,2760],[800,2700],[850,2864],[905,2610],[950,2420],[1000,2260]];
  var BACK=[[0,2050],[70,2450],[150,2280],[250,2950],[330,2720],[430,3180],[505,2930],[600,3330],[690,3010],[790,3220],[880,2960],[1000,3120]];
  var MARKS=[{n:'Ischgl',z:1377,x:90,a:'start'},{n:'Idalp',z:2320,x:350,a:'middle',an:'end'},{n:'Pardatschgrat',z:2624,x:520,a:'middle'},{n:'Greitspitz',z:2872,x:705,a:'middle'}];
  var M={},VW=1000,FS=1,narrow=null;
  function X(x){return +(x*VW/1000).toFixed(1);}
  function polyPath(pts){return 'M'+pts.map(function(p){return X(p[0])+' '+yOf(p[1]).toFixed(1);}).join(' L')+' L'+VW+' 440 L0 440 Z';}
  function buildMountain(){
    var root=$('mtn');narrow=root.clientWidth>0&&root.clientWidth<600;VW=narrow?560:1000;FS=narrow?1.7:1;
    root.setAttribute('viewBox','0 0 '+VW+' 440');root.innerHTML='';
    var defs=svg('defs',{},root),g=svg('linearGradient',{id:'skyg',x1:0,y1:0,x2:0,y2:1},defs);
    svg('stop',{offset:'0',style:'stop-color:var(--sky-top)'},g);svg('stop',{offset:'1',style:'stop-color:var(--sky-bot)'},g);
    var cp=svg('clipPath',{id:'mclip'},defs);svg('path',{d:polyPath(RIDGE)},cp);
    var cu=svg('clipPath',{id:'upclip'},defs);M.upRect=svg('rect',{x:0,y:0,width:VW,height:200},cu);
    var cd=svg('clipPath',{id:'dnclip'},defs);M.dnRect=svg('rect',{x:0,y:200,width:VW,height:240},cd);
    var glow=svg('filter',{id:'glow',x:'-20%',y:'-200%',width:'140%',height:'500%'},defs);
    svg('feGaussianBlur',{stdDeviation:4,result:'b'},glow);var mg=svg('feMerge',{},glow);svg('feMergeNode',{in:'b'},mg);svg('feMergeNode',{in:'SourceGraphic'},mg);
    svg('rect',{x:0,y:0,width:VW,height:440,fill:'url(#skyg)'},root);
    for(var i=0;i<40;i++)svg('circle',{cx:(Math.random()*VW).toFixed(0),cy:(Math.random()*200).toFixed(0),r:(Math.random()*1.3+.3).toFixed(1),style:'fill:#fff;opacity:'+(Math.random()*.6+.2).toFixed(2)},root);
    [1500,2000,2500,3000,3500].forEach(function(z){
      svg('line',{x1:0,x2:VW,y1:yOf(z),y2:yOf(z),'stroke-dasharray':'2 7',style:'stroke:#fff;opacity:.18'},root);
      var t=svg('text',{x:8,y:yOf(z)-5,'font-size':13*FS,style:'fill:var(--mute);font-weight:700'},root);t.textContent=fmtInt(z)+' m';
    });
    M.fx=svg('g',{},root);
    svg('path',{d:polyPath(BACK),style:'fill:var(--ridge-back)'},root);
    var mgp=svg('g',{'clip-path':'url(#mclip)'},root);
    svg('rect',{x:0,y:0,width:VW,height:440,style:'fill:var(--rock)'},mgp);
    M.cap=svg('g',{'class':'snowcap'},mgp);
    svg('rect',{x:0,y:-460,width:VW,height:463,style:'fill:var(--snow)'},M.cap);
    svg('path',{d:polyPath(RIDGE),fill:'none',style:'stroke:#fff;stroke-width:2;opacity:.5'},root);
    M.sline=svg('g',{'class':'sline'},root);
    svg('line',{x1:0,x2:VW,y1:0,y2:0,'stroke-dasharray':'3 6',style:'stroke:var(--snowline);stroke-width:3'},M.sline);
    M.slineBg=svg('rect',{x:0,y:6,width:10,height:22*FS,style:'fill:var(--snowline)'},M.sline);
    M.slineTxt=svg('text',{x:VW-12,y:6+16*FS,'font-size':15*FS,'text-anchor':'end',style:'fill:var(--bg);font-weight:800;font-style:italic'},M.sline);
    M.zero=svg('g',{'class':'zero'},root);
    svg('line',{x1:0,x2:VW,y1:0,y2:0,'stroke-dasharray':'16 8',filter:'url(#glow)',style:'stroke:var(--zero);stroke-width:4'},M.zero);
    M.zeroBg=svg('rect',{x:0,y:-(26*FS+8),width:10,height:26*FS,style:'fill:var(--zero)'},M.zero);
    M.zeroTxt=svg('text',{x:VW-12,y:-(8*FS+8),'font-size':18*FS,'text-anchor':'end',style:'fill:#fff;font-weight:800;font-style:italic'},M.zero);
    M.marks=MARKS.map(function(m){
      var gm=svg('g',{},root),x=X(m.x),y=yOf(m.z);
      svg('circle',{cx:x,cy:y,r:6*(narrow?1.3:1),style:'fill:var(--pink);stroke:#fff;stroke-width:2.5'},gm);
      var anchor=(narrow&&m.an)?m.an:m.a,tx=anchor==='start'?x-4:anchor==='end'?x+6:x;
      var st='fill:#fff;paint-order:stroke;stroke:var(--bg);stroke-width:'+(narrow?6:4)+'px;stroke-linejoin:round;font-weight:800;font-style:italic';
      var t2=svg('text',{x:tx,y:y-14,'font-size':22*FS,'text-anchor':anchor,style:st},gm);
      var t1=svg('text',{x:tx,y:y-14-21*FS,'font-size':14*FS,'text-anchor':anchor,style:st+';text-transform:uppercase;letter-spacing:.04em'},gm);
      t1.textContent=narrow?m.n:m.n+' '+fmtInt(m.z);
      return {m:m,t:t2};
    });
  }
  window.addEventListener('resize',function(){
    clearTimeout(buildMountain._t);
    buildMountain._t=setTimeout(function(){var w=$('mtn').clientWidth,nn=w>0&&w<600;if(nn!==narrow){buildMountain();if(wx)renderMountainDay();}},200);
  });
  function particles(day,ySnow){
    var fx=M.fx;fx.innerHTML='';
    if(!day||reduceMotion)return;
    var snowy=day.snow>=0.5,wet=day.precip>=1;if(!snowy&&!wet)return;
    M.upRect.setAttribute('height',Math.max(0,ySnow));
    M.dnRect.setAttribute('y',Math.max(0,ySnow));M.dnRect.setAttribute('height',Math.max(0,440-ySnow));
    var count=Math.min(80,12+Math.round(day.snow*3+day.precip*2));if(narrow)count=Math.round(count*.6);
    var up=svg('g',{'clip-path':'url(#upclip)'},fx),dn=svg('g',{'clip-path':'url(#dnclip)'},fx);
    for(var i=0;i<count;i++){
      var x=Math.random()*VW,dur=(4+Math.random()*4).toFixed(2),del=(-Math.random()*8).toFixed(2);
      if(snowy)svg('circle',{cx:x,cy:0,r:((1.5+Math.random()*2.5)*(narrow?1.3:1)).toFixed(1),'class':'flake',style:'fill:#fff;opacity:.9;animation-duration:'+dur+'s;animation-delay:'+del+'s'},up);
      if(wet&&ySnow<440)svg('line',{x1:x,x2:x-3,y1:0,y2:14,'class':'drop',style:'stroke:var(--cyan);stroke-width:2;opacity:.7;animation-duration:'+(dur/3).toFixed(2)+'s;animation-delay:'+del+'s'},dn);
    }
  }
  function verdict(d){
    var fl=d.fl,sf=isNum(fl)?Math.max(0,fl-300):null,t,x='',b='';
    if(!isNum(fl))return {t:'Keine Daten',x:'Für diesen Tag fehlt die Prognose.',b:''};
    if(fl<=Z_TAL){t='Winter bis ins Tal';x='Frost bis runter nach Ischgl. Schnee bleibt überall liegen.';}
    else if(fl<=2320){t='Winter ab '+fmtAlt(fl);x='Idalp und alles darüber unter null, unten im Tal Plusgrade.';}
    else if(fl<=Z_TOP){t='Nur ganz oben Frost';x='Minusgrade erst ab '+fmtAlt(fl)+'. Unterhalb taut es.';}
    else{t='Zu warm am Berg';x='Selbst auf der Greitspitze über 0 °C. Schnee taut, auch ganz oben.';}
    if(d.snow>=1)x+=' Dazu '+fmtInt(d.snow)+' cm Neuschnee am Gipfel, Schnee ab ca. '+fmtAlt(sf)+'.';
    else if(d.precip>=1)x+=sf>Z_TOP?' Niederschlag kommt bis oben als Regen.':' Etwas Niederschlag, oben als Schnee.';
    if(d.snow>=20)b='Powder-Alarm';else if(d.snow>=5)b='Neuschnee';else if(fl<=Z_TAL)b='Winter pur';
    return {t:t,x:x,b:b};
  }
  function labelBox(bg,txt,str){
    txt.textContent=str;var w;try{w=txt.getComputedTextLength();}catch(e){w=0;}
    if(!w)w=str.length*9*FS;w+=22;bg.setAttribute('x',VW-w-1);bg.setAttribute('width',w);
  }
  var selDay=0;
  function renderMountainDay(){
    if(!wx||!wx.days.length)return;
    var d=wx.days[selDay]||wx.days[0],fl=isNum(d.fl)?d.fl:Z_TOP+400;
    var yZ=Math.max(Y1+34*FS,Math.min(445,yOf(fl))),sf=Math.max(0,fl-300),yS=Math.max(Y1,Math.min(445,yOf(sf)));
    M.cap.style.transform='translateY('+yOf(fl)+'px)';
    M.zero.style.transform='translateY('+yZ+'px)';
    labelBox(M.zeroBg,M.zeroTxt,'0 °C · '+fmtAlt(fl)+(fl>ZMAX?' ↑':''));
    var showS=(d.precip>=1||d.snow>=0.5)&&yS<420;
    M.sline.style.display=showS?'':'none';M.sline.style.transform='translateY('+yS+'px)';
    if(showS)labelBox(M.slineBg,M.slineTxt,'Schnee ab ca. '+fmtAlt(sf));
    M.marks.forEach(function(mk){var t=null;if(isNum(d.tTal)&&isNum(d.tTop))t=d.tTal+(d.tTop-d.tTal)*(mk.m.z-Z_TAL)/(Z_TOP-Z_TAL);mk.t.textContent=fmtTemp(t);});
    particles(d,yS);
    var v=verdict(d);$('mt-title').textContent=v.t;$('mt-text').textContent=v.x;
    var b=$('mt-badge');b.textContent=v.b;b.hidden=!v.b;
    $('days').querySelectorAll('.daybtn').forEach(function(btn,i){btn.setAttribute('aria-pressed',i===selDay?'true':'false');});
  }
  function wxIcon(code,snow){
    var c=n(code);
    if((c>=71&&c<=77)||c===85||c===86||snow>=1)return '<svg viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/></svg>';
    if((c>=51&&c<=67)||(c>=80&&c<=82)||c>=95)return '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" aria-hidden="true"><path d="M7 14a4.5 4.5 0 1 1 8.7-1.7H16a3 3 0 0 1 0 6H7a2.5 2.5 0 0 1 0-4.3z" fill="rgba(255,255,255,.2)" stroke="#fff" stroke-width="1.6"/><path d="M9 20l-1 2.5M13 20l-1 2.5" stroke="var(--cyan)" stroke-width="2"/></svg>';
    if(c>=2)return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17a4.5 4.5 0 1 1 8.7-1.7H16a3 3 0 0 1 0 6H7a2.5 2.5 0 0 1 0-4.3z" fill="rgba(255,255,255,.25)" stroke="#fff" stroke-width="1.6" transform="translate(0,-3)"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="var(--amber)" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="var(--amber)"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';
  }
  function renderDays(){
    var box=$('days');box.innerHTML='';if(!wx)return;
    wx.days.forEach(function(d,i){
      var b=document.createElement('button');b.type='button';b.className='daybtn';b.setAttribute('aria-pressed',i===selDay?'true':'false');
      b.innerHTML='<span class="dn">'+esc(d.label)+'</span><span class="dd">'+esc(d.dd)+'</span>'+wxIcon(d.code,d.snow)+
        '<span class="t">'+fmtTemp(d.tTop)+' / '+fmtTemp(d.tTal)+'</span>'+
        '<span class="sn'+(d.snow>=5?' hot':'')+'">'+(d.snow>=0.5?'+'+fmtInt(d.snow)+' cm':'0° '+(isNum(d.fl)?fmtInt(Math.round(d.fl/100)*100):'–'))+'</span>';
      b.addEventListener('click',function(){selDay=i;renderMountainDay();});
      box.appendChild(b);
    });
  }
  function renderWx(){
    renderWxFacts();
    if(!wx){$('mt-title').textContent=wxErr?'Prognose nicht erreichbar':'Lade Prognose …';$('mt-text').textContent=wxErr?'Open-Meteo antwortet gerade nicht. Später nochmal aktualisieren.':'';return;}
    if(selDay>=wx.days.length)selDay=0;
    renderDays();renderMountainDay();
    $('mt-src').textContent='Open-Meteo · geladen '+clock(wx.fetched);
  }

  /* =====================================================================
     Aktualisieren
     ===================================================================== */
  var busy=false;
  function setLive(state,text){$('live-state').className='live'+(state?' '+state:'');$('live-text').textContent=text;}
  function refresh(force){
    if(busy)return Promise.resolve();
    busy=true;var btn=$('btn-refresh');btn.disabled=true;btn.classList.add('spin');setLive('','Aktualisiere …');
    if(force){refreshCams();loadHeroCam();if(RD.map)loadRadarFrames();}
    return Promise.all([loadManual(),loadOfficial(force),loadWeather()]).then(function(){
      renderManual();renderSnow();renderWx();renderMarquee();lastRefresh=Date.now();
      var probs=[];
      if(wxErr)probs.push('Wetter nicht erreichbar');
      if(cfg.snow&&officialErr&&!official)probs.push('Schneebericht nicht erreichbar, Werte von Hand');
      else if(official&&official.stale)probs.push('Schneebericht: letzter Stand');
      setLive(probs.length?'err':'on','Live · '+clock()+(probs.length?' · '+probs.join(' · '):''));
    }).finally(function(){busy=false;btn.disabled=false;btn.classList.remove('spin');});
  }
  $('btn-refresh').addEventListener('click',function(){refresh(true).then(function(){toast('Alles frisch!');});});
  setInterval(function(){if(!document.hidden)refresh(false);},15*60*1000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&Date.now()-lastRefresh>10*60*1000)refresh(false);});

  /* =====================================================================
     Leaflet (wird erst geladen, wenn eine Karte gebraucht wird)
     ===================================================================== */
  var LEAFLET='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
  function loadLeaflet(){
    if(window.L)return Promise.resolve(window.L);
    if(loadLeaflet.p)return loadLeaflet.p;
    loadLeaflet.p=new Promise(function(res,rej){
      var css=document.createElement('link');css.rel='stylesheet';css.href=LEAFLET+'leaflet.css';
      document.head.insertBefore(css,document.head.querySelector('style'));
      var s=document.createElement('script');s.src=LEAFLET+'leaflet.js';
      s.onload=function(){res(window.L);};s.onerror=function(){loadLeaflet.p=null;rej(new Error('Kartenbibliothek nicht ladbar'));};
      document.head.appendChild(s);
    });
    return loadLeaflet.p;
  }
  function mapMsg(id,html,loading){var el=$(id);el.innerHTML=(loading?'<div class="loader"></div>':'')+html;el.hidden=false;}

  /* =====================================================================
     SKI-NAVI
     ===================================================================== */
  var NV={map:null,data:null,g:null,from:null,to:null,tap:'a',level:2,closed:{},lines:{},route:null,mk:{},me:null,started:false};
  try{NV.closed=JSON.parse(ls('ischgl26-closed')||'{}')||{};}catch(e){NV.closed={};}
  (function(){var l=+ls('ischgl26-level');if(l===1||l===2||l===4)NV.level=l;})();
  var LIFT_LBL={cable_car:'Seilbahn',gondola:'Gondelbahn',mixed_lift:'Kombibahn',chair_lift:'Sessellift',drag_lift:'Schlepplift','t-bar':'Schlepplift','j-bar':'Schlepplift',platter:'Tellerlift',rope_tow:'Seillift',magic_carpet:'Förderband'};
  function lvlOf(w){
    var d=(w.d||'').toLowerCase();
    if(w.gr==='backcountry'||d==='freeride'||d==='extreme')return 4;
    if(d==='novice'||d==='easy')return 1;
    if(d==='advanced'||d==='expert')return 3;
    return 2;
  }
  function pisteColor(w){
    var d=(w.d||'').toLowerCase();
    if(w.lvl===4)return '#ff9f1a';
    if(d==='novice'||d==='easy')return '#2f7dff';
    if(d==='advanced'||d==='expert')return '#0d0d0d';
    if(d==='intermediate')return '#ff2b3d';
    return '#8f8aa8';
  }
  var LVL_TXT={1:'blau',2:'rot',3:'schwarz',4:'Skiroute'};
  function dist(a,b){
    var R=6371000,toR=Math.PI/180,dLat=(b.lat-a.lat)*toR,dLon=(b.lon-a.lon)*toR;
    var s=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(a.lat*toR)*Math.cos(b.lat*toR)*Math.sin(dLon/2)*Math.sin(dLon/2);
    return 2*R*Math.asin(Math.min(1,Math.sqrt(s)));
  }
  function liftName(w){return [w.r,w.n].filter(Boolean).join(' ')||LIFT_LBL[w.t]||'Lift';}
  function pisteName(w){
    if(w.r&&w.n)return 'Piste '+w.r+' · '+w.n;
    if(w.r)return 'Piste '+w.r;
    return w.n||'Piste';
  }

  function buildGraph(ways){
    var nodes={},all=[],pn=[],lifts=[];
    function key(w,i){return (w.nd&&w.nd.length===w.g.length)?'n'+w.nd[i]:'c'+w.g[i][0].toFixed(6)+','+w.g[i][1].toFixed(6);}
    function node(k,p){var x=nodes[k];if(!x){x=nodes[k]={k:k,lat:p[0],lon:p[1],out:[],inc:0};all.push(x);}return x;}
    function edge(a,b,cost,len,w,kind){a.out.push({to:b,cost:cost,len:len,w:w,kind:kind});b.inc++;}
    ways.forEach(function(w){
      if(w.k==='p'){
        w.lvl=lvlOf(w);w.col=pisteColor(w);
        var idx=w.g.map(function(_,i){return i;});
        if(isNum(w.e0)&&isNum(w.e1)&&w.e1>w.e0+3){idx.reverse();w.g=w.g.slice().reverse();w.nd=w.nd&&w.nd.slice().reverse();var t=w.e0;w.e0=w.e1;w.e1=t;idx=w.g.map(function(_,i){return i;});}
        var sp=w.lvl===1?7:w.lvl===4?6:8.5,prev=null;
        idx.forEach(function(i){var x=node(key(w,i),w.g[i]);x.p=true;(x.ways||(x.ways=[])).push(w.i);pn.push(x);
          if(prev&&prev!==x){var L=dist(prev,x);edge(prev,x,L/sp,L,w,'p');}prev=x;});
      }else if(w.k==='l'){
        var a=0,b=w.g.length-1;
        if(isNum(w.e0)&&isNum(w.e1)&&w.e0>w.e1+3){a=b;b=0;}
        var bot=node(key(w,a),w.g[a]),top=node(key(w,b),w.g[b]),L=0;
        for(var i=1;i<w.g.length;i++)L+=dist({lat:w.g[i-1][0],lon:w.g[i-1][1]},{lat:w.g[i][0],lon:w.g[i][1]});
        var sp2={cable_car:8,gondola:5.5,mixed_lift:5,chair_lift:4.5}[w.t]||3;
        w.len=L;w.ride=w.dur?w.dur*60:L/sp2;w.bot=bot;w.top=top;
        edge(bot,top,w.ride+90,L,w,'l');
        if(w.t==='cable_car'||w.t==='gondola'||w.t==='mixed_lift')edge(top,bot,w.ride+90,L,w,'l');
        lifts.push(w);
      }
    });
    /* Raster für Nachbarsuche */
    var CELL=0.0008,grid={};
    function gk(y,x){return y+':'+x;}
    pn.forEach(function(x){var k=gk(Math.floor(x.lat/CELL),Math.floor(x.lon/CELL));(grid[k]||(grid[k]=[])).push(x);});
    function near(x,r){
      var cy=Math.floor(x.lat/CELL),cx=Math.floor(x.lon/CELL),sp=Math.ceil(r/60)+1,res=[];
      for(var dy=-sp;dy<=sp;dy++)for(var dx=-sp;dx<=sp;dx++){var c=grid[gk(cy+dy,cx+dx)];if(!c)continue;
        for(var i=0;i<c.length;i++){var d=dist(x,c[i]);if(d<=r&&c[i]!==x)res.push({n:c[i],d:d});}}
      return res;
    }
    function nearestPerWay(list){var best={};list.forEach(function(o){(o.n.ways||[]).forEach(function(wi){if(!best[wi]||best[wi].d>o.d)best[wi]=o;});});return Object.keys(best).map(function(k){return best[k];});}
    lifts.forEach(function(w){
      nearestPerWay(near(w.top,80)).forEach(function(o){edge(w.top,o.n,o.d/1.3+10,o.d,null,'w');});
      nearestPerWay(near(w.bot,80)).forEach(function(o){edge(o.n,w.bot,o.d/1.3+10,o.d,null,'w');});
      lifts.forEach(function(v){if(v===w)return;
        var d=dist(w.top,v.bot);if(d<=100)edge(w.top,v.bot,d/1.2+20,d,null,'w');
        /* Talstationen im Dorf: zu Fuß erreichbar */
        var d2=dist(w.bot,v.bot);if(d2<=400&&w.bot!==v.bot)edge(w.bot,v.bot,d2/1.2+30,d2,null,'f');});
    });
    /* Pistenkreuzungen ohne gemeinsamen Punkt */
    pn.forEach(function(x){near(x,16).forEach(function(o){var same=(x.ways||[]).some(function(wi){return (o.n.ways||[]).indexOf(wi)>=0;});if(!same)edge(x,o.n,o.d/2,o.d,null,'j');});});
    return {nodes:nodes,all:all,lifts:lifts};
  }

  function Heap(){this.a=[];}
  Heap.prototype.push=function(p,v){var a=this.a;a.push([p,v]);var i=a.length-1;while(i>0){var j=(i-1)>>1;if(a[j][0]<=a[i][0])break;var t=a[i];a[i]=a[j];a[j]=t;i=j;}};
  Heap.prototype.pop=function(){var a=this.a,top=a[0],last=a.pop();if(a.length){a[0]=last;var i=0;for(;;){var l=2*i+1,r=l+1,m=i;if(l<a.length&&a[l][0]<a[m][0])m=l;if(r<a.length&&a[r][0]<a[m][0])m=r;if(m===i)break;var t=a[i];a[i]=a[m];a[m]=t;i=m;}}return top;};
  function allowed(e){
    if(e.kind==='p')return e.w.lvl<=NV.level;
    if(e.kind==='l')return !NV.closed[e.w.i];
    return true;
  }
  function dijkstra(s,t){
    var D=new Map(),P=new Map(),h=new Heap();D.set(s,0);h.push(0,s);
    while(h.a.length){
      var top=h.pop(),d=top[0],u=top[1];if(u===t)break;if(d>D.get(u))continue;
      for(var i=0;i<u.out.length;i++){var e=u.out[i];if(!allowed(e))continue;var nd=d+e.cost,old=D.get(e.to);
        if(old===undefined||nd<old){D.set(e.to,nd);P.set(e.to,{u:u,e:e});h.push(nd,e.to);}}
    }
    if(s!==t&&!P.has(t))return null;
    var path=[],x=t;while(x!==s){var p=P.get(x);path.unshift({from:p.u,e:p.e});x=p.u;}
    return {edges:path,cost:D.get(t)||0};
  }
  function snap(lat,lon,role){
    var best=null,bd=Infinity,pt={lat:lat,lon:lon};
    NV.g.all.forEach(function(x){if(role==='a'&&!x.out.length)return;if(role==='b'&&!x.inc)return;var d=dist(pt,x);if(d<bd){bd=d;best=x;}});
    return {node:best,d:bd};
  }

  function liftStyle(w){
    var closed=!!NV.closed[w.i];
    return closed?{color:'#7d7896',weight:3,dashArray:'6 8',opacity:.9}:{color:'#ffffff',weight:3,opacity:.95};
  }
  function drawNetwork(L){
    var pistes=L.layerGroup().addTo(NV.map),lifts=L.layerGroup().addTo(NV.map);
    NV.data.ways.forEach(function(w){
      if(w.k==='p'){
        var line=L.polyline(w.g,{color:w.col,weight:4,opacity:.95,dashArray:w.lvl===4?'8 7':null}).addTo(pistes);
        line.bindPopup('<b>'+esc(pisteName(w))+'</b>'+(w.lvl===4?'Skiroute (nicht präpariert)':'Schwierigkeit: '+LVL_TXT[w.lvl]));
      }else{
        L.polyline(w.g,{color:'#08060f',weight:7,opacity:.55}).addTo(lifts);
        var ln=L.polyline(w.g,liftStyle(w)).addTo(lifts);NV.lines[w.i]=ln;
        L.circleMarker(w.g[0],{radius:3.5,color:'#08060f',weight:2,fillColor:'#fff',fillOpacity:1}).addTo(lifts);
        L.circleMarker(w.g[w.g.length-1],{radius:3.5,color:'#08060f',weight:2,fillColor:'#fff',fillOpacity:1}).addTo(lifts);
        ln.on('click',function(ev){
          var div=document.createElement('div'),closed=!!NV.closed[w.i];
          div.innerHTML='<b>'+esc(liftName(w))+'</b>'+esc(LIFT_LBL[w.t]||'Lift')+(w.ride?' · ca. '+Math.max(1,Math.round(w.ride/60))+' min':'')+'<br><br>';
          var btn=document.createElement('button');btn.className='btn small '+(closed?'ice':'hot');btn.type='button';
          btn.textContent=closed?'Wieder offen':'Gesperrt';
          btn.addEventListener('click',function(){
            if(NV.closed[w.i])delete NV.closed[w.i];else NV.closed[w.i]=1;
            ls('ischgl26-closed',JSON.stringify(NV.closed));ln.setStyle(liftStyle(w));NV.map.closePopup();computeRoute();
            toast(NV.closed[w.i]?liftName(w)+' gesperrt':liftName(w)+' wieder offen');
          });
          div.appendChild(btn);L.popup().setLatLng(ev.latlng).setContent(div).openOn(NV.map);
          L.DomEvent.stopPropagation(ev);
        });
      }
    });
    lifts.eachLayer(function(l){l.bringToFront&&l.bringToFront();});
  }
  function fillPlaces(){
    var opts=[];
    NV.g.lifts.forEach(function(w){if(!w.n&&!w.r)return;opts.push({v:'b:'+w.i,t:liftName(w)+' – Talstation'});opts.push({v:'t:'+w.i,t:liftName(w)+' – Bergstation'});});
    opts.sort(function(a,b){return a.t.localeCompare(b.t,'de',{numeric:true});});
    ['nv-from','nv-to'].forEach(function(id){
      var sel=$(id),keep=sel.options[0];sel.innerHTML='';sel.appendChild(keep);
      opts.forEach(function(o){var op=document.createElement('option');op.value=o.v;op.textContent=o.t;sel.appendChild(op);});
    });
  }
  function nodeFromValue(v){
    if(!v)return null;var id=+v.slice(2),w=NV.g.lifts.filter(function(x){return x.i===id;})[0];
    if(!w)return null;return v[0]==='b'?w.bot:w.top;
  }
  function setPoint(role,node,fromSelect){
    var L=window.L;if(!node)return;
    if(role==='a')NV.from=node;else NV.to=node;
    if(!fromSelect)$(role==='a'?'nv-from':'nv-to').value='';
    if(NV.mk[role])NV.map.removeLayer(NV.mk[role]);
    NV.mk[role]=L.marker([node.lat,node.lon],{icon:L.divIcon({className:'',html:'<div class="pin '+role+'"></div>',iconSize:[22,22],iconAnchor:[11,11]}),zIndexOffset:1000}).addTo(NV.map);
    NV.tap=role==='a'?'b':'a';
    $('nv-tap').innerHTML='Karte antippen setzt '+(NV.tap==='a'?'den <b>Start</b>':'das <b>Ziel</b>')+'.';
    computeRoute();
  }
  function stepsFrom(edges){
    var steps=[];
    edges.forEach(function(x){
      var e=x.e,last=steps[steps.length-1];
      if(e.kind==='w'||e.kind==='j'||e.kind==='f'){
        if(last&&last.kind==='w'){last.len+=e.len;last.t+=e.cost;last.foot=last.foot||e.kind==='f';return;}
        steps.push({kind:'w',len:e.len,t:e.cost,foot:e.kind==='f'});return;
      }
      var lbl=e.kind==='l'?liftName(e.w):pisteName(e.w);
      if(last&&last.kind===e.kind&&(last.w===e.w||(e.kind==='p'&&last.lbl===lbl&&last.w.lvl===e.w.lvl))){last.len+=e.len;last.t+=e.cost;return;}
      steps.push({kind:e.kind,w:e.w,lbl:lbl,len:e.len,t:e.cost,down:e.kind==='l'&&x.from===e.w.top});
    });
    return steps.filter(function(s){return !(s.kind==='w'&&s.len<40);});
  }
  function fmtMin(sec){var m=Math.max(1,Math.round(sec/60));return m>=60?Math.floor(m/60)+' h '+p2(m%60):m+' min';}
  function fmtLen(m){return m>=1000?(m/1000).toFixed(1).replace('.',',')+' km':Math.round(m/10)*10+' m';}
  function computeRoute(){
    var L=window.L;if(!NV.g||!L)return;
    if(NV.route){NV.map.removeLayer(NV.route);NV.route=null;}
    $('nv-err').hidden=true;$('nv-result').hidden=true;
    if(!NV.from||!NV.to)return;
    if(NV.from===NV.to){$('nv-err').textContent='Start und Ziel sind gleich.';$('nv-err').hidden=false;return;}
    var r=dijkstra(NV.from,NV.to);
    if(!r){
      $('nv-err').innerHTML='<b>Keine Route gefunden.</b> '+(NV.level<4?'Probier „Alles“ bei den Pisten, ':'')+'prüf gesperrte Lifte oder wähl einen Punkt direkt an einer Piste.';
      $('nv-err').hidden=false;return;
    }
    var pts=[[NV.from.lat,NV.from.lon]];r.edges.forEach(function(x){pts.push([x.e.to.lat,x.e.to.lon]);});
    NV.route=L.layerGroup([
      L.polyline(pts,{color:'#ff2e93',weight:14,opacity:.28,lineCap:'round',lineJoin:'round'}),
      L.polyline(pts,{color:'#ff2e93',weight:5,opacity:1,lineCap:'round',lineJoin:'round'}),
      L.polyline(pts,{color:'#ffffff',weight:1.5,opacity:.9,dashArray:'2 10'})
    ]).addTo(NV.map);
    var steps=stepsFrom(r.edges),km=0,nl=0;
    steps.forEach(function(s){if(s.kind==='p')km+=s.len;if(s.kind==='l')nl++;});
    $('nv-time').textContent=fmtMin(r.cost);$('nv-km').textContent=fmtLen(km);$('nv-lifts').textContent=nl;
    var ol=$('nv-steps');ol.innerHTML='';
    steps.forEach(function(s){
      var li=document.createElement('li'),ic,title,sub;
      if(s.kind==='l'){
        ic='<span class="ic lift"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 5l18-3M12 3.5V9"/><rect x="6" y="9" width="12" height="10" rx="2"/><path d="M6 14h12"/></svg></span>';
        title=liftName(s.w);sub=(LIFT_LBL[s.w.t]||'Lift')+(s.down?' · runterfahren':' · hoch');
      }else if(s.kind==='p'){
        ic='<span class="ic" style="background:'+s.w.col+';color:#fff;'+(s.w.col==='#0d0d0d'?'outline:1px solid #888':'')+'">'+esc(s.w.r||'')+'</span>';
        title=pisteName(s.w);sub=(s.w.lvl===4?'Skiroute':'Piste '+LVL_TXT[s.w.lvl])+' · '+fmtLen(s.len);
      }else{
        ic='<span class="ic" style="background:var(--s3)">→</span>';title=s.foot||s.len>150?'Zu Fuß rüber':'Rüberfahren';sub=fmtLen(s.len);
      }
      li.innerHTML=ic+'<div><b>'+esc(title)+'</b><span>'+esc(sub)+'</span></div><em>'+fmtMin(s.t)+'</em>';
      ol.appendChild(li);
    });
    $('nv-result').hidden=false;
    NV.map.fitBounds(L.latLngBounds(pts).pad(.15),{maxZoom:15});
  }

  function initNavi(){
    if(NV.started)return;NV.started=true;
    cfgReady.then(initNavi2);
  }
  function initNavi2(){
    if(!cfg.pistes){mapMsg('navi-msg','<span>Ski-Navi braucht den Server</span><small>Läuft die Seite auf einem reinen Webspace, fehlen die Pistendaten. Den offiziellen Live-Pistenplan gibt es im zweiten Tab.</small>');return;}
    Promise.all([loadLeaflet(),getJSON('api/pistes'+(NV.retry?'?force=1':''),{cache:NV.retry?'no-store':'default'})]).then(function(r){
      var L=r[0],data=r[1];NV.data=data;
      NV.g=buildGraph(data.ways);
      NV.map=L.map('navi-map',{zoomControl:true,attributionControl:true,tap:true});
      L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{subdomains:'abc',maxZoom:17,attribution:'Karte © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · Daten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(NV.map);
      var b=L.latLngBounds([]);data.ways.forEach(function(w){b.extend(w.g[0]);b.extend(w.g[w.g.length-1]);});
      NV.map.fitBounds(b.pad(.05));
      drawNetwork(L);fillPlaces();
      $('navi-msg').hidden=true;
      var nP=0,nL=0;data.ways.forEach(function(w){if(w.k==='p')nP++;else nL++;});
      var d=new Date((data.fetchedAt||0)*1000);
      $('nv-src').textContent='Pistennetz: '+nL+' Lifte, '+nP+' Pistenabschnitte aus OpenStreetMap, Stand '+p2(d.getDate())+'.'+p2(d.getMonth()+1)+'.'+(data.stale?' (älter)':'')+(data.elevation?'':' · ohne Höhendaten');
      NV.map.on('click',function(ev){var s=snap(ev.latlng.lat,ev.latlng.lng,NV.tap);if(!s.node)return;
        if(s.d>400){toast('Zu weit weg von Piste oder Lift');return;}setPoint(NV.tap,s.node);});
    }).catch(function(e){
      NV.started=false;console.warn('Ski-Navi:',e);
      mapMsg('navi-msg','<span>Pistendaten nicht geladen</span><small>'+esc(e.message)+'</small><button class="btn small hot" type="button" id="nv-retry">Nochmal</button>');
      $('nv-retry').addEventListener('click',function(){NV.retry=true;mapMsg('navi-msg','<span>Lade Pisten &amp; Lifte …</span><small>Fragt jetzt mehrere OpenStreetMap-Server nacheinander. Bis zu 2 Minuten.</small>',true);initNavi();});
    });
  }
  $('nv-from').addEventListener('change',function(e){var x=nodeFromValue(e.target.value);if(x)setPoint('a',x,true);});
  $('nv-to').addEventListener('change',function(e){var x=nodeFromValue(e.target.value);if(x)setPoint('b',x,true);});
  $('nv-swap').addEventListener('click',function(){
    if(!NV.g)return;var a=NV.from,b=NV.to,va=$('nv-from').value,vb=$('nv-to').value;
    NV.from=null;NV.to=null;if(b)setPoint('a',b,true);if(a)setPoint('b',a,true);$('nv-from').value=vb;$('nv-to').value=va;
  });
  document.querySelectorAll('#nv-level button').forEach(function(b){
    b.setAttribute('aria-pressed',+b.dataset.l===NV.level?'true':'false');
    b.addEventListener('click',function(){NV.level=+b.dataset.l;ls('ischgl26-level',String(NV.level));
      document.querySelectorAll('#nv-level button').forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false');});computeRoute();});
  });
  $('nv-gps').addEventListener('click',function(){
    if(!NV.g){toast('Karte lädt noch …');return;}
    if(!window.isSecureContext||!navigator.geolocation){toast('GPS geht nur über https, z. B. die Tailscale-Adresse');return;}
    var btn=$('nv-gps');btn.classList.add('on');
    navigator.geolocation.getCurrentPosition(function(pos){
      btn.classList.remove('on');var L=window.L,c=pos.coords;
      if(NV.me)NV.map.removeLayer(NV.me);
      NV.me=L.marker([c.latitude,c.longitude],{icon:L.divIcon({className:'',html:'<div class="me-dot"></div>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(NV.map);
      var s=snap(c.latitude,c.longitude,'a');
      if(!s.node||s.d>600){toast('Du bist nicht im Skigebiet');NV.map.setView([c.latitude,c.longitude],14);return;}
      setPoint('a',s.node);toast('Start: dein Standort');
    },function(err){btn.classList.remove('on');toast(err.code===1?'Standort nicht freigegeben':'Standort nicht gefunden');},{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
  });

  /* Tabs Pistenplan */
  document.querySelectorAll('#karte .tab').forEach(function(t){
    t.addEventListener('click',function(){
      document.querySelectorAll('#karte .tab').forEach(function(x){var on=x===t;x.setAttribute('aria-selected',on?'true':'false');$(x.dataset.pane).hidden=!on;});
      if(t.dataset.pane==='pane-live'){var f=$('live-map');if(!f.src)f.src=f.dataset.src;}
      else if(NV.map)setTimeout(function(){NV.map.invalidateSize();},50);
    });
  });

  /* =====================================================================
     WETTERRADAR (RainViewer) + Windy
     ===================================================================== */
  var RD={map:null,frames:[],layers:[],idx:0,timer:null,host:'',started:false};
  function radarLabel(f){var d=new Date(f.time*1000),ago=Math.round((Date.now()-d)/60000);return clock(d)+(ago>2?' · vor '+ago+' min':' · jetzt');}
  function showFrame(i){
    if(!RD.layers.length)return;RD.idx=(i+RD.layers.length)%RD.layers.length;
    RD.layers.forEach(function(l,j){l.setOpacity(j===RD.idx?.78:0);});
    $('rd-slider').value=RD.idx;$('rd-time').textContent=radarLabel(RD.frames[RD.idx]);
  }
  function play(on){
    clearTimeout(RD.timer);RD.timer=null;$('rd-play').textContent=on?'❚❚ Pause':'▶ Play';
    if(!on)return;
    (function step(){RD.timer=setTimeout(function(){showFrame(RD.idx+1);step();},RD.idx===RD.layers.length-2?1800:650);})();
  }
  function loadRadarFrames(){
    var L=window.L;
    return getJSON('https://api.rainviewer.com/public/weather-maps.json').then(function(j){
      RD.layers.forEach(function(l){RD.map.removeLayer(l);});
      RD.host=j.host;RD.frames=(j.radar&&j.radar.past)||[];
      RD.layers=RD.frames.map(function(f){
        return L.tileLayer(RD.host+f.path+'/256/{z}/{x}/{y}/2/1_1.png',{opacity:0,maxNativeZoom:7,maxZoom:9,attribution:'Radar © <a href="https://www.rainviewer.com">RainViewer</a>'}).addTo(RD.map);
      });
      $('rd-slider').max=Math.max(0,RD.layers.length-1);
      showFrame(RD.layers.length-1);$('radar-msg').hidden=true;
      if(!reduceMotion)play(true);
    });
  }
  function initRadar(){
    if(RD.started)return;RD.started=true;
    loadLeaflet().then(function(L){
      RD.map=L.map('radar-map',{zoomControl:true,minZoom:4,maxZoom:9}).setView([LAT,LON],6);
      /* freie OSM-Kacheln, per CSS-Filter dunkel eingefärbt (CARTO verlangt inzwischen einen Schlüssel) */
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,className:'bm-dark',attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(RD.map);
      L.marker([LAT,LON],{icon:L.divIcon({className:'',html:'<div class="pin b"></div>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(RD.map).bindTooltip('Ischgl',{permanent:true,direction:'right',offset:[12,0]});
      return loadRadarFrames();
    }).catch(function(e){RD.started=false;mapMsg('radar-msg','<span>Radar nicht geladen</span><small>'+esc(e.message)+'</small>');});
  }
  $('rd-play').addEventListener('click',function(){play(!RD.timer);});
  $('rd-slider').addEventListener('input',function(e){play(false);showFrame(+e.target.value);});
  setInterval(function(){if(RD.map&&!document.hidden)loadRadarFrames().catch(function(){});},10*60*1000);
  var WINDY_LBL={snowAccu:'Neuschnee-Prognose (Summe) · Windy.com',deg0:'Nullgradgrenze · Windy.com',wind:'Wind · Windy.com'};
  document.querySelectorAll('#radar .tab').forEach(function(t){
    t.addEventListener('click',function(){
      document.querySelectorAll('#radar .tab').forEach(function(x){x.setAttribute('aria-selected',x===t?'true':'false');});
      var o=t.dataset.wx,isR=o==='radar';
      $('radar-pane').hidden=!isR;$('windy-pane').hidden=isR;
      if(isR){if(RD.map)setTimeout(function(){RD.map.invalidateSize();},50);return;}
      $('windy').src='https://embed.windy.com/embed2.html?lat=46.97&lon=10.29&detailLat=46.97&detailLon=10.29&width=650&height=450&zoom=9&level=surface&overlay='+o+
        '&product=ecmwf&menu=&message=true&marker=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1';
      $('windy-lbl').textContent=WINDY_LBL[o]||'Windy.com';
    });
  });

  /* Karten erst laden, wenn man hinscrollt */
  if('IntersectionObserver' in window){
    var lazy=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;
      if(e.target.id==='karte')initNavi();if(e.target.id==='radar')initRadar();lazy.unobserve(e.target);});},{rootMargin:'400px 0px'});
    lazy.observe($('karte'));lazy.observe($('radar'));
  }else{initNavi();initRadar();}

  /* =====================================================================
     Webcams
     ===================================================================== */
  var CAMS=[
    {id:'100178345',n:'Idalp',a:2320,u:'idalp_webcam_100178345',feat:1},
    {id:'100000136',n:'Greitspitz',a:2872,u:'greitspitz_webcam_100000136',p:1},
    {id:'100007712',n:'Palinkopf',a:2864,u:'palinkopf_webcam_100007712'},
    {id:'100178319',n:'Palinkopf 2',a:2864,u:'palinkopf_webcam_100178319'},
    {id:'100163839',n:'Piz Val Gronda',a:2812,u:'piz-val-gronda_webcam_100163839'},
    {id:'100178353',n:'Pardatschgrat',a:2624,u:'pardatschgrat_webcam_100178353',p:1},
    {id:'100178355',n:'Pardatschgrat 2',a:2624,u:'pardatschgrat_webcam_100178355'},
    {id:'100178343',n:'Alp Trida Sattel',a:2511,u:'alp-trida-sattel_webcam_100178343'},
    {id:'100178361',n:'Samnaun TV',a:2488,u:'samnaun-tv_webcam_100178361'},
    {id:'100178351',n:'Ischgl TV',a:2320,u:'ischgl-tv_webcam_100178351'},
    {id:'108486387',n:'Idalp 2',a:2300,u:'idalp_webcam_108486387'},
    {id:'100178341',n:'Alp Trida',a:2260,u:'alp-trida_webcam_100178341'},
    {id:'100178359',n:'Samnaun Dorf',a:1840,u:'samnaun-dorf_webcam_100178359'},
    {id:'100178357',n:'Compatsch',a:1700,u:'samnaun-compatsch_webcam_100178357'},
    {id:'124696581',n:'Ischgl Dorf',a:1400,u:'ischgl-dorf_webcam_124696581',p:1},
    {id:'100178315',n:'FlyingCam',a:1377,u:'flyingcam-ischgl_webcam_100178315'}
  ];
  /* Die 5 wichtigsten zuerst, der Rest erst auf Klick (spart Ladezeit) */
  var CAM_TOP=['100178345','100000136','100178353','100007712','124696581'];
  CAMS.sort(function(x,y){var i=CAM_TOP.indexOf(x.id),j=CAM_TOP.indexOf(y.id);
    if(i<0&&j<0)return y.a-x.a;if(i<0)return 1;if(j<0)return -1;return i-j;});
  var camsOpen=false;
  function camTile(c){
    var el=document.createElement('article');el.className='cam'+(c.feat?' feat':'');
    el.innerHTML='<button type="button" data-cam="'+c.id+'" aria-label="'+esc(c.n)+' vergrößern">'+
      '<span class="cam-empty">'+fmtInt(c.a)+' m</span><img alt="Webcam '+esc(c.n)+'" decoding="async" hidden>'+
      '<div class="cam-top">'+(c.feat?'<em>Hauptpiste</em>':'')+'<time hidden></time></div>'+
      '<div class="cam-cap"><b>'+esc(c.n)+'</b><span>'+fmtInt(c.a)+' m</span></div></button>'+
      '<a class="live" href="'+CAM_PAGE+c.u+'" target="_blank" rel="noopener">Live ↗</a>';
    var img=el.querySelector('img'),empty=el.querySelector('.cam-empty'),tm=el.querySelector('time');
    img.addEventListener('load',function(){img.dataset.loaded='1';img.hidden=false;empty.hidden=true;tm.hidden=false;tm.textContent=clock();});
    img.addEventListener('error',function(){if(!img.dataset.loaded){img.hidden=true;empty.hidden=false;empty.textContent='Kein Bild';}});
    c.img=img;c.el=el;img.src=camSrc(c.id);
    return el;
  }
  function buildCams(){
    var grid=$('cams');grid.innerHTML='';
    CAMS.forEach(function(c){if(CAM_TOP.indexOf(c.id)>=0)grid.appendChild(camTile(c));});
    grid.addEventListener('click',function(e){var b=e.target.closest('button[data-cam]');if(!b)return;
      var c=CAMS.filter(function(x){return x.id===b.dataset.cam;})[0];if(c)openLightbox(c);});
    var rest=CAMS.length-CAM_TOP.length,btn=$('cams-toggle');
    btn.querySelector('span').textContent='Alle '+CAMS.length+' Cams zeigen (+'+rest+')';
    btn.addEventListener('click',function(){
      camsOpen=!camsOpen;btn.setAttribute('aria-expanded',camsOpen?'true':'false');
      CAMS.forEach(function(c){
        if(CAM_TOP.indexOf(c.id)>=0)return;
        if(camsOpen)grid.appendChild(camTile(c));
        else if(c.el){c.el.remove();c.el=null;c.img=null;}
      });
      btn.querySelector('span').textContent=camsOpen?'Weniger Cams':'Alle '+CAMS.length+' Cams zeigen (+'+rest+')';
      if(!camsOpen)$('webcams').scrollIntoView({block:'start'});
    });
  }
  /* Neu laden nur für Cams, die gerade angezeigt werden */
  function refreshCams(){camBust++;CAMS.forEach(function(c){if(!c.img||!c.el)return;var pre=new Image();pre.onload=function(){if(c.img)c.img.src=pre.src;};pre.src=camSrc(c.id);});}
  setInterval(function(){if(!document.hidden){refreshCams();loadHeroCam();}},CAM_MS);
  var lb=$('lightbox');
  function openLightbox(c){
    $('lb-title').textContent=c.n;$('lb-meta').textContent=fmtInt(c.a)+' m';
    $('lb-img').src=c.img&&c.img.dataset.loaded?c.img.src:camSrc(c.id);$('lb-img').alt='Webcam '+c.n;
    $('lb-live').href=CAM_PAGE+c.u;if(lb.showModal)lb.showModal();else window.open(CAM_PAGE+c.u,'_blank');
  }
  $('lb-close').addEventListener('click',function(){lb.close();});
  lb.addEventListener('click',function(e){if(e.target===lb)lb.close();});

  /* =====================================================================
     Bearbeiten
     ===================================================================== */
  var mode=null,dlg=$('editor'),saving=false,FIELDS=['liftsOpen','liftsTotal','slopesOpen','snowTop','snowValley'];
  function enableFileMode(){
    if(mode)return;mode='file';
    $('ownerbar-text').textContent='Bearbeitungsmodus ohne Server: Das Formular erzeugt eine neue data.json. Ersetze damit die Datei im Seitenordner und lade den Ordner neu hoch.';
    $('e-token-wrap').hidden=true;$('ed-save').textContent='data.json herunterladen';$('ownerbar').hidden=false;
  }
  function checkHash(){if(!mode&&/^#bearbeiten$/i.test(location.hash))enableFileMode();}
  window.addEventListener('hashchange',checkHash);
  function openEditor(){
    var s=manual||FALLBACK;$('e-token').value=ls('ischgl26-token')||'';
    $('e-status').value=STATUS[s.status]?s.status:'closed';$('e-statusNote').value=s.statusNote||'';
    FIELDS.forEach(function(k){$('e-'+k).value=n(s[k]);});$('e-groupNote').value=s.groupNote||'';
    var m=$('ed-msg');m.classList.remove('err');
    m.textContent=mode==='file'?'Lädt eine neue data.json herunter. Erst nach dem Hochladen sehen alle den neuen Stand.':'Speichern ändert die Seite für alle.';
    dlg.showModal();
  }
  function collect(){
    var next=JSON.parse(JSON.stringify(manual||FALLBACK));
    next.status=$('e-status').value;next.statusNote=$('e-statusNote').value.trim();
    FIELDS.forEach(function(k){next[k]=n($('e-'+k).value);});next.groupNote=$('e-groupNote').value.trim();next.updated=nowStr();
    return next;
  }
  function downloadJson(obj){
    var blob=new Blob([JSON.stringify(obj,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='data.json';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},4000);
  }
  $('btn-edit').addEventListener('click',openEditor);
  $('ed-close').addEventListener('click',function(){dlg.close();});
  $('ed-save').addEventListener('click',function(){
    if(saving)return;var next=collect();
    if(mode==='file'){downloadJson(next);manual=next;renderManual();renderSnow();renderMarquee();dlg.close();toast('data.json heruntergeladen');return;}
    var btn=$('ed-save'),m=$('ed-msg'),token=$('e-token').value;
    if(!token){m.textContent='Bitte das Passwort eintragen.';m.classList.add('err');$('e-token').focus();return;}
    saving=true;btn.disabled=true;btn.textContent='Speichert …';m.classList.remove('err');m.textContent='Wird gespeichert …';
    getJSON('api/data',{method:'POST',headers:{'Content-Type':'application/json','X-Edit-Token':token},body:JSON.stringify(next)})
      .then(function(){ls('ischgl26-token',token);manual=next;renderManual();renderSnow();renderMarquee();dlg.close();toast('Gespeichert!');})
      .catch(function(e){m.textContent=e.message||'Speichern hat nicht geklappt.';m.classList.add('err');})
      .finally(function(){saving=false;btn.disabled=false;btn.textContent='Speichern';});
  });

  /* =====================================================================
     Packliste, Kopieren, Navigation
     ===================================================================== */
  var items=['Skipass','Ausweis','Helm &amp; Skibrille','Handschuhe, Mütze, Buff','Warme Schicht für abends','Sonnencreme','Powerbank &amp; Kabel','Ski gewachst, Bindung geprüft'];
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
      var txt=b.getAttribute('data-copy');function reset(){setTimeout(function(){b.textContent='Kopieren';},1500);}
      function fallback(){var r=document.createRange();r.selectNodeContents(b.previousElementSibling);var s=getSelection();s.removeAllRanges();s.addRange(r);b.textContent='Markiert';reset();}
      try{navigator.clipboard.writeText(txt).then(function(){b.textContent='Kopiert';reset();},fallback);}catch(e){fallback();}
    });
  });
  if('IntersectionObserver' in window){
    var navA=document.querySelectorAll('#navlinks a'),SEC2LINK={schnee:'schnee',nullgrad:'schnee',karte:'karte',radar:'radar',webcams:'webcams',mehr:'mehr'};
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;var act=SEC2LINK[e.target.id];
      navA.forEach(function(a){a.classList.toggle('on',a.getAttribute('href')==='#'+act);});});},{rootMargin:'-40% 0px -55% 0px'});
    Object.keys(SEC2LINK).forEach(function(k){var el=$(k);if(el)io.observe(el);});
  }

  /* =====================================================================
     Start
     ===================================================================== */
  buildMountain();buildCams();
  cfgReady.then(function(){if(cfg.editable){mode='server';$('ownerbar').hidden=false;}else checkHash();refresh(false);});
})();
