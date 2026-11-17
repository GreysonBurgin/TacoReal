/* Puts the facts in site-data.js onto the page: address, phone, links, hours, the open/closed line, the announcement.
   The HTML carries the same facts as plain text, so the page still reads correctly if this script never runs. */
(function(){
  var SHORT={Sunday:'Sun',Monday:'Mon',Tuesday:'Tue',Wednesday:'Wed',Thursday:'Thu',Friday:'Fri',Saturday:'Sat'};
  function mins(t){ var m=/^(\d{1,2}):(\d{2})$/.exec(String(t||'').trim()); return m? +m[1]*60 + +m[2] : null; }
  function clock(m, ampm){ var h=Math.floor(m/60), mm=m%60, h12=h%12||12; return h12+(mm?':'+(mm<10?'0':'')+mm:'')+(ampm?(h<12?' am':' pm'):''); }
  function all(sel){ return [].slice.call(document.querySelectorAll(sel)); }
  function el(tag, text){ var e=document.createElement(tag); if(text!=null) e.textContent=text; return e; }

  function week(data){ // seven rows, Sunday first: {day, o, c} with o/c in minutes, or closed
    return (data.hours||[]).slice(0,7).map(function(r){ var o=mins(r.open), c=mins(r.close); return { day:r.day, closed: !!r.closed || o==null || c==null, o:o, c:c }; });
  }
  function groups(w){ // consecutive days with the same hours become one line
    var out=[]; w.forEach(function(d){ var k=d.closed?'x':d.o+'-'+d.c, last=out[out.length-1]; if(last&&last.k===k) last.to=d.day; else out.push({k:k, from:d.day, to:d.day, d:d}); });
    return out;
  }

  function applyInfo(data){
    var i=data.info||{}, tel='tel:+1'+String(i.phone||'').replace(/\D/g,'');
    all('[data-f="phone"]').forEach(function(e){ e.textContent=i.phone; var a=e.closest('a[href^="tel:"]'); if(a) a.setAttribute('href', tel); });
    all('[data-f="street"]').forEach(function(e){ e.textContent=i.street; });
    all('[data-f="city"]').forEach(function(e){ e.textContent=i.city; });
    all('[data-f="street-h"]').forEach(function(e){ e.textContent=i.streetShort+'.'; });
    var L=data.links||{};
    all('[data-link]').forEach(function(a){ var u=L[a.getAttribute('data-link')]; if(u) a.setAttribute('href', u); });
  }

  function applyHours(data){
    var w=week(data); if(w.length!==7) return;
    var g=groups(w), everyDay=g.length===1;
    all('[data-hours="long"]').forEach(function(dl){
      all('[data-hours="long"] [data-day-group]').forEach(function(n){ if(dl.contains(n)) n.remove(); });
      var before=dl.firstChild;
      g.forEach(function(x){ var div=el('div'); div.setAttribute('data-day-group','');
        div.appendChild(el('dt', everyDay?'Every day':(x.from===x.to?x.from:x.from+' – '+x.to)));
        div.appendChild(el('dd', x.d.closed?'Closed':clock(x.d.o,true)+' – '+clock(x.d.c,true)));
        dl.insertBefore(div, before); });
    });
    all('[data-hours="short"]').forEach(function(box){
      box.textContent='';
      g.forEach(function(x){ var days=everyDay?'Daily':(x.from===x.to?SHORT[x.from]:SHORT[x.from]+'–'+SHORT[x.to]);
        box.appendChild(el('p', days+' · '+(x.d.closed?'Closed':clock(x.d.o)+'–'+clock(x.d.c)))); });
    });
  }

  var timer;
  function applyOpenLine(data){
    var els=all('[data-open]'), w=week(data); if(!els.length||w.length!==7) return;
    var IDX={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}, fmt;
    try{ fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',weekday:'short',hour:'numeric',minute:'numeric',hourCycle:'h23'}); }catch(e){ return; }
    function tick(){
      var d,h,mi; fmt.formatToParts(new Date()).forEach(function(p){ if(p.type==='weekday') d=IDX[p.value]; if(p.type==='hour') h=+p.value; if(p.type==='minute') mi=+p.value; });
      if(d===undefined||isNaN(h)||isNaN(mi)) return;
      var now=(h%24)*60+mi, t=w[d], n=w[(d+1)%7], open=!t.closed&&now>=t.o&&now<t.c, text;
      if(open) text='Open till '+clock(t.c);
      else if(!t.closed&&now<t.o) text='Opens at '+clock(t.o)+' today';
      else if(!n.closed) text='Closed till '+clock(n.o)+' tomorrow';
      else text=t.closed?'Closed today':'Closed now';
      els.forEach(function(e){ e.textContent=text; var dot=e.parentNode.querySelector('.dot'); if(dot) dot.style.background=open?'':'#7a4a1e'; });
    }
    clearInterval(timer); tick(); timer=setInterval(tick,30000);
  }

  function applyAnnouncement(data){
    var a=data.announcement||{}, page=document.querySelector('.page'), bar=document.getElementById('announce');
    if(!a.text){ if(bar) bar.remove(); return; }
    if(!bar){ bar=el('div'); bar.id='announce'; bar.setAttribute('role','region'); bar.setAttribute('aria-label','Announcement'); if(page) page.insertBefore(bar, page.firstChild); }
    bar.textContent=''; bar.appendChild(el('span', a.text));
    if(a.link){ var l=el('a', a.linkText||'More'); l.href=a.link; bar.appendChild(document.createTextNode(' ')); bar.appendChild(l); }
  }

  function apply(data){ if(!data) return; applyInfo(data); applyHours(data); applyOpenLine(data); applyAnnouncement(data);
    if(data.menu&&window.TACO_RENDER_MENU) window.TACO_RENDER_MENU(data.menu, data.pricesChecked); }
  window.TACO_APPLY=apply;
  apply(window.TACO_SITE);
})();
