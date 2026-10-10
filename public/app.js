(function(){
  'use strict';

  /* ---------- Fixed reference data ---------- */
  var CAM_PAGE='https://www.ischgl.com/en/plan-your-trip/webcams/';
  var CAM_IMG='https://www.ischgl.com/var/webcams/';
  var REFRESH_MS=5*60*1000;
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
  var STATUS={closed:'Geschlossen',partial:'Teilweise offen',open:'Geöffnet'};
  var FALLBACK={updated:'',status:'closed',statusNote:'',snowTop:0,snowValley:0,newSnow:0,liftsOpen:0,liftsTotal:46,slopesOpen:0,slopesTotal:239,groupNote:'',forecast:{title:'Nullgradgrenze',source:'',issued:'',comment:'',rows:[]}};

  var state=null;
  var $=function(id){return document.getElementById(id);};
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function n(v){var x=Number(v);return isFinite(x)?x:0;}
  function fmtInt(v){return n(v).toLocaleString('de-DE');}
  function p2(x){return String(x).padStart(2,'0');}
  function nowStr(){var d=new Date();return p2(d.getDate())+'.'+p2(d.getMonth()+1)+'.'+d.getFullYear()+', '+p2(d.getHours())+':'+p2(d.getMinutes());}
  function clock(){var d=new Date();return p2(d.getHours())+':'+p2(d.getMinutes());}
  function toast(t){var el=$('toast');el.textContent=t;el.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(function(){el.hidden=true;},2800);}
  function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v);}catch(e){return null;}}

  /* ---------- Status + forecast ---------- */
  function renderStatus(){
    var s=state;
    $('st-pill').className='pill '+(STATUS[s.status]?s.status:'closed');
    $('st-label').textContent=STATUS[s.status]||STATUS.closed;
    $('st-note').textContent=s.statusNote||'';
    $('st-top').innerHTML=fmtInt(s.snowTop)+'<span> cm</span>';
    $('st-valley').innerHTML=fmtInt(s.snowValley)+'<span> cm</span>';
    $('st-new').innerHTML=fmtInt(s.newSnow)+'<span> cm</span>';
    $('st-lifts').innerHTML=fmtInt(s.liftsOpen)+'<span> / '+fmtInt(s.liftsTotal)+'</span>';
    $('st-slopes').innerHTML=fmtInt(s.slopesOpen)+'<span> / '+fmtInt(s.slopesTotal||239)+' km</span>';
    $('st-updated').textContent='Zuletzt aktualisiert: '+(s.updated||'–')+'. Für den Live-Stand die Links unten öffnen.';
    var gn=$('group-note');
    if(s.groupNote&&String(s.groupNote).trim()){gn.textContent=s.groupNote;gn.hidden=false;}else{gn.hidden=true;}
  }

  var MIN=2000,MAX=4000;
  function pct(m){m=Math.max(MIN,Math.min(MAX,n(m)));return ((m-MIN)/(MAX-MIN)*100).toFixed(2)+'%';}
  function renderForecast(){
    var f=state.forecast||{};
    $('fc-title').textContent=f.title||'Nullgradgrenze';
    $('fc-meta').textContent=[f.source,f.issued?('Stand '+f.issued):''].filter(Boolean).join(' · ');
    $('fc-comment').textContent=f.comment||'';
    $('fc-comment').hidden=!f.comment;
    var rows=$('fl-rows');rows.innerHTML='';
    var list=f.rows||[];
    if(!list.length){rows.innerHTML='<p class="stamp">Noch keine Prognose eingetragen.</p>';}
    list.forEach(function(r){
      var lo=Math.min(n(r.lo),n(r.hi)),hi=Math.max(n(r.lo),n(r.hi));
      var row=document.createElement('div');row.className='fl-row';
      row.innerHTML='<div class="fl-day">'+esc(r.d)+'<small>'+esc(r.dt)+'</small></div>'+
        '<div class="fl-track" role="img" aria-label="Nullgradgrenze '+lo+' bis '+hi+' Meter">'+
          '<span class="fl-ref mid" style="left:'+pct(2126)+'"></span>'+
          '<span class="fl-ref top" style="left:'+pct(2872)+'"></span>'+
          '<span class="fl-bar" style="left:'+pct(lo)+';width:calc('+pct(hi)+' - '+pct(lo)+')"></span>'+
        '</div>'+
        '<div class="fl-side num"><b>'+fmtInt(r.snow)+' cm</b> · '+fmtInt(r.mm)+' mm<br>'+n(r.tmin)+' / '+n(r.tmax)+'°</div>';
      rows.appendChild(row);
    });
    var axis=$('fl-axis');axis.innerHTML='';
    [2000,2500,3000,3500,4000].forEach(function(m){var s=document.createElement('span');s.style.left=pct(m);s.textContent=(m/1000).toFixed(1).replace('.',',')+'k';axis.appendChild(s);});
  }

  /* ---------- Webcams: live JPGs from ischgl.com ---------- */
  function camUrl(c){return CAM_IMG+c.id+'.jpg?t='+Math.floor(Date.now()/REFRESH_MS);}
  function buildCams(){
    var grid=$('cams');grid.innerHTML='';
    CAMS.forEach(function(c){
      var el=document.createElement('article');el.className='cam';
      el.innerHTML=
        '<button type="button" class="cam-media" data-cam="'+c.id+'" aria-label="'+esc(c.n)+' vergrößern" style="border:0;padding:0;width:100%">'+
          '<span class="cam-empty"><b>'+fmtInt(c.a)+' m</b><span>Bild wird geladen …</span></span>'+
          '<img alt="Webcam '+esc(c.n)+'" loading="lazy" decoding="async" hidden>'+
          '<span class="cam-time" hidden></span>'+
          (c.p?'<span class="cam-tip">Tipp</span>':'')+
          '<span class="cam-live" hidden><i></i>Live-Bild</span>'+
        '</button>'+
        '<div class="cam-body"><div><strong>'+esc(c.n)+'</strong><small>'+fmtInt(c.a)+' m · '+(c.ch?'Samnaun':'Ischgl')+'</small></div>'+
        '<a href="'+CAM_PAGE+c.u+'" target="_blank" rel="noopener">Live ↗</a></div>';
      var img=el.querySelector('img'),empty=el.querySelector('.cam-empty'),time=el.querySelector('.cam-time'),live=el.querySelector('.cam-live');
      img.addEventListener('load',function(){img.hidden=false;empty.hidden=true;time.hidden=false;live.hidden=false;time.textContent='Stand '+clock();});
      img.addEventListener('error',function(){
        if(!img.dataset.loaded){img.hidden=true;empty.hidden=false;time.hidden=true;live.hidden=true;empty.querySelector('span').textContent='Bild nicht verfügbar · Live ansehen';}
      });
      img.addEventListener('load',function(){img.dataset.loaded='1';});
      c.img=img;
      img.src=camUrl(c);
      grid.appendChild(el);
    });
    grid.addEventListener('click',function(e){
      var b=e.target.closest('.cam-media');if(!b)return;
      var c=CAMS.filter(function(x){return x.id===b.dataset.cam;})[0];if(!c)return;
      openLightbox(c);
    });
  }
  function refreshCams(){
    if(document.hidden)return;
    CAMS.forEach(function(c){
      if(!c.img)return;
      /* preload, then swap so the tile never flashes empty */
      var pre=new Image();
      pre.onload=function(){c.img.src=pre.src;};
      pre.src=camUrl(c);
    });
  }
  setInterval(refreshCams,REFRESH_MS);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)refreshCams();});

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

  /* ---------- Load data ---------- */
  function setState(s){
    state=Object.assign({},FALLBACK,s||{});
    state.forecast=Object.assign({},FALLBACK.forecast,(s&&s.forecast)||{});
    renderStatus();renderForecast();
    $('app').classList.remove('loading');
  }
  function load(){
    return fetch('data.json?t='+Date.now(),{cache:'no-store'})
      .then(function(r){if(!r.ok)throw new Error(r.status);return r.json();})
      .then(setState)
      .catch(function(){setState(state||FALLBACK);$('st-updated').textContent='Daten konnten nicht geladen werden.';});
  }
  load();
  buildCams();

  /* ---------- Editing ----------
     server mode: server.py with EDIT_TOKEN saves directly.
     file mode:   any static host; open the page with #bearbeiten,
                  the form produces a new data.json to upload. */
  var mode=null;
  function enableFileMode(){
    if(mode)return;
    mode='file';
    $('ownerbar-text').textContent='Bearbeitungsmodus ohne Server: Das Formular erzeugt eine neue data.json. Ersetze damit die Datei im Seitenordner und lade den Ordner neu hoch.';
    $('btn-edit').textContent='Daten bearbeiten';
    $('e-token-wrap').hidden=true;
    $('ed-save').textContent='data.json herunterladen';
    $('ownerbar').hidden=false;
  }
  function checkHash(){if(!mode&&/^#bearbeiten$/i.test(location.hash))enableFileMode();}
  fetch('api/config',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;})
    .then(function(cfg){
      if(cfg&&cfg.editable){mode='server';$('ownerbar').hidden=false;}
      else checkHash();
    }).catch(checkHash);
  window.addEventListener('hashchange',checkHash);

  var dlg=$('editor'),busy=false;
  function rowHtml(r){
    r=r||{};
    function cell(k,type,ph,label){return '<td><input data-k="'+k+'" type="'+type+'" value="'+esc(r[k]==null?'':r[k])+'"'+(ph?' placeholder="'+ph+'"':'')+(type==='number'?' inputmode="numeric" step="any"':'')+' aria-label="'+label+'"></td>';}
    return cell('d','text','Sa','Tag')+cell('dt','text','28.11.','Datum')+cell('lo','number','2400','Nullgrad von')+cell('hi','number','2800','Nullgrad bis')+
      cell('snow','number','0','Neuschnee cm')+cell('mm','number','0','Niederschlag mm')+cell('tmin','number','-5','Min °C')+cell('tmax','number','2','Max °C')+
      '<td><button type="button" class="x" aria-label="Zeile löschen">×</button></td>';
  }
  function addRow(r){var tr=document.createElement('tr');tr.innerHTML=rowHtml(r);tr.querySelector('.x').addEventListener('click',function(){tr.remove();});$('e-rows').appendChild(tr);}
  function openEditor(){
    if(!state)return;
    var s=state,f=s.forecast||{};
    $('e-token').value=ls('ischgl26-token')||'';
    $('e-status').value=STATUS[s.status]?s.status:'closed';$('e-statusNote').value=s.statusNote||'';
    ['snowTop','snowValley','newSnow','liftsOpen','liftsTotal','slopesOpen'].forEach(function(k){$('e-'+k).value=n(s[k]);});
    $('e-groupNote').value=s.groupNote||'';
    $('e-fcSource').value=f.source||'';$('e-fcIssued').value=f.issued||'';$('e-fcComment').value=f.comment||'';
    $('e-rows').innerHTML='';(f.rows||[]).forEach(addRow);if(!(f.rows||[]).length)addRow();
    var m=$('ed-msg');m.classList.remove('err');
    m.textContent=mode==='file'?'Lädt eine neue data.json herunter. Erst nach dem Hochladen sehen alle den neuen Stand.':'Speichern ändert die Seite für alle.';
    dlg.showModal();
  }
  function collect(){
    var next=JSON.parse(JSON.stringify(state));
    next.status=$('e-status').value;next.statusNote=$('e-statusNote').value.trim();
    ['snowTop','snowValley','newSnow','liftsOpen','liftsTotal','slopesOpen'].forEach(function(k){next[k]=n($('e-'+k).value);});
    next.groupNote=$('e-groupNote').value.trim();
    next.forecast=Object.assign({},next.forecast,{source:$('e-fcSource').value.trim(),issued:$('e-fcIssued').value.trim(),comment:$('e-fcComment').value.trim()});
    var rows=[];
    $('e-rows').querySelectorAll('tr').forEach(function(tr){
      var r={};tr.querySelectorAll('input').forEach(function(i){r[i.dataset.k]=i.type==='number'?n(i.value):i.value.trim();});
      if(r.d||r.dt||r.lo||r.hi)rows.push(r);
    });
    next.forecast.rows=rows;
    next.forecast.title=rows.length?('Nullgradgrenze · '+rows.length+(rows.length===1?' Tag':' Tage')):'Nullgradgrenze';
    next.updated=nowStr();
    return next;
  }
  $('e-addrow').addEventListener('click',function(){addRow();});
  $('ed-close').addEventListener('click',function(){dlg.close();});
  $('btn-edit').addEventListener('click',openEditor);
  function downloadJson(obj){
    var blob=new Blob([JSON.stringify(obj,null,2)+'\n'],{type:'application/json'});
    var url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='data.json';document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},4000);
  }
  $('ed-save').addEventListener('click',function(){
    if(busy)return;
    if(mode==='file'){
      var data=collect();downloadJson(data);
      state=data;renderStatus();renderForecast();dlg.close();
      toast('data.json heruntergeladen. Jetzt im Ordner ersetzen und hochladen.');
      return;
    }
    var btn=$('ed-save'),m=$('ed-msg'),token=$('e-token').value;
    if(!token){m.textContent='Bitte das Passwort eintragen.';m.classList.add('err');$('e-token').focus();return;}
    var next=collect();busy=true;btn.disabled=true;btn.textContent='Speichert …';m.classList.remove('err');m.textContent='Wird gespeichert …';
    fetch('api/data',{method:'POST',headers:{'Content-Type':'application/json','X-Edit-Token':token},body:JSON.stringify(next)})
      .then(function(r){return r.json().catch(function(){return {};}).then(function(j){if(!r.ok)throw new Error(j.error||('Fehler '+r.status));return j;});})
      .then(function(){ls('ischgl26-token',token);state=next;renderStatus();renderForecast();dlg.close();toast('Gespeichert. Alle sehen jetzt den neuen Stand.');})
      .catch(function(e){m.textContent=e.message||'Speichern hat nicht geklappt.';m.classList.add('err');})
      .finally(function(){busy=false;btn.disabled=false;btn.textContent='Speichern';});
  });

  /* Reload data every 10 minutes so open tabs stay current */
  setInterval(function(){if(!document.hidden&&!(dlg.open))load();},10*60*1000);

  /* ---------- Countdown: 28.11.2026 18:00 MEZ = 17:00 UTC ---------- */
  var target=Date.UTC(2026,10,28,17,0,0);
  function tick(){
    var diff=target-Date.now();
    if(diff<=0){$('cd-d').textContent='0';$('cd-h').textContent=$('cd-m').textContent=$('cd-s').textContent='00';
      $('cd-note').textContent=diff>-4*3600e3?'Westlife spielen gerade auf P1!':'Das Opening ist vorbei.';return;}
    var s=Math.floor(diff/1000);
    $('cd-d').textContent=Math.floor(s/86400);$('cd-h').textContent=p2(Math.floor(s%86400/3600));
    $('cd-m').textContent=p2(Math.floor(s%3600/60));$('cd-s').textContent=p2(s%60);
  }
  tick();setInterval(tick,1000);

  /* ---------- Packing list (per device) ---------- */
  var items=['Konzert-/Skipass gekauft oder Mehrtagespass','Ausweis','Helm &amp; Skibrille','Handschuhe, Mütze, Buff','Warme Schicht fürs Konzert (18 Uhr, draußen)','Sonnencreme &amp; Lippenschutz','Powerbank &amp; Ladekabel','Ski/Board gewachst und Bindung geprüft'];
  var KEY='ischgl26-pack',packed={};
  try{packed=JSON.parse(ls(KEY)||'{}')||{};}catch(e){packed={};}
  items.forEach(function(txt,i){
    var id='pack-'+i,l=document.createElement('label');l.setAttribute('for',id);
    l.innerHTML='<input type="checkbox" id="'+id+'"'+(packed[i]?' checked':'')+'><span>'+txt+'</span>';
    l.querySelector('input').addEventListener('change',function(e){packed[i]=e.target.checked;ls(KEY,JSON.stringify(packed));});
    $('check').appendChild(l);
  });

  /* ---------- Copy buttons ---------- */
  document.querySelectorAll('[data-copy]').forEach(function(b){
    b.addEventListener('click',function(){
      var txt=b.getAttribute('data-copy');
      function reset(){setTimeout(function(){b.textContent='Kopieren';},1500);}
      function fallback(){var r=document.createRange();r.selectNodeContents(b.previousElementSibling);var s=getSelection();s.removeAllRanges();s.addRange(r);b.textContent='Markiert';reset();}
      try{navigator.clipboard.writeText(txt).then(function(){b.textContent='Kopiert';reset();},fallback);}catch(e){fallback();}
    });
  });
})();
