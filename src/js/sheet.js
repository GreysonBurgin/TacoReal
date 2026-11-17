/* The editor. If site-data.js names a Google Sheet, read it and put its facts on the page.
   Order of trust: the sheet as just read > the last good copy kept in this browser > the facts typed into site-data.js and menu-data.js.
   A sheet that is unreachable or malformed changes nothing: the page keeps what it already shows.
   ?preview=1 also shows rows marked Draft (and remembers that while you click around); ?preview=0 turns it off. */
(function(){
  var base=window.TACO_SITE||{}, cfg=base.sheet||{};
  var KEY='taco-sheet-v1', TABS=['Menu','Sections','Hours','Info'];
  var q=/[?&]preview=(draft|[01])/.exec(location.search), preview=false, draft=false;
  try{ if(q) sessionStorage.setItem('taco-preview', q[1]); var pv=sessionStorage.getItem('taco-preview'); draft=pv==='draft'; preview=draft||pv==='1'; }catch(e){ draft=!!(q&&q[1]==='draft'); preview=draft||!!(q&&q[1]==='1'); }

  function url(tab){ return cfg.base ? cfg.base+tab+'.csv' : 'https://docs.google.com/spreadsheets/d/'+cfg.id+'/gviz/tq?tqx=out:csv&headers=1&sheet='+encodeURIComponent(tab); }
  function csv(text){ // rows of cells; handles quotes, doubled quotes, commas and line breaks inside cells
    var rows=[], row=[], cell='', inq=false, i=0, c;
    text=text.replace(/^﻿/,'');
    for(;i<text.length;i++){ c=text[i];
      if(inq){ if(c==='"'){ if(text[i+1]==='"'){ cell+='"'; i++; } else inq=false; } else cell+=c; }
      else if(c==='"') inq=true;
      else if(c===','){ row.push(cell); cell=''; }
      else if(c==='\n'||c==='\r'){ if(c==='\r'&&text[i+1]==='\n') i++; row.push(cell); rows.push(row); row=[]; cell=''; }
      else cell+=c; }
    if(cell!==''||row.length){ row.push(cell); rows.push(row); }
    return rows;
  }
  function table(text){ // [{header: value}] keyed by the first row; takes CSV text or rows already split into cells
    var r=(typeof text==='string'?csv(text):text.slice()), h=(r.shift()||[]).map(function(x){ return String(x).trim().toLowerCase(); });
    return r.map(function(c){ var o={}; h.forEach(function(k,i){ o[k]=(c[i]==null?'':String(c[i])).trim(); }); return o; });
  }
  function num(v){ var n=parseFloat(String(v).replace(/[^0-9.]/g,'')); return isNaN(n)?null:n; }
  function yes(v){ return /^(y|yes|true|x|1)$/i.test(v||''); }
  function slug(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'x'; }
  function time24(v){ var m=/^\s*(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])?\.?m?\.?\s*$/i.exec(v||''); if(!m) return null;
    var h=+m[1], mi=+(m[2]||0), ap=(m[3]||'').toLowerCase(); if(ap==='p'&&h<12) h+=12; if(ap==='a'&&h===12) h=24;
    if(h>24||mi>59) return null; return (h<10?'0':'')+h+':'+(mi<10?'0':'')+mi; }

  function build(t){
    var out={}, info={}; t.Info.forEach(function(r){ if(r.setting) info[r.setting.toLowerCase()]=r.value; });
    function pick(k, fb){ var v=info[k]; return v?v:fb; }
    var bi=base.info||{}, bl=base.links||{};
    out.info={ street:pick('street address',bi.street), streetShort:pick('short address',bi.streetShort), city:pick('city and state',bi.city), phone:pick('phone',bi.phone) };
    out.links={ order:pick('order online link',bl.order), reservations:pick('reservations link',bl.reservations), directions:pick('directions link',bl.directions), instagram:pick('instagram link',bl.instagram),
      mailing:pick('mailing list link',bl.mailing), giftcards:pick('gift cards link',bl.giftcards), catering:pick('catering request link',bl.catering), events:pick('event request link',bl.events) };
    Object.keys(out.links).forEach(function(k){ if(!/^https?:\/\//i.test(out.links[k]||'')) out.links[k]=bl[k]; }); // only real web addresses
    out.announcement={ text:info['announcement']||'', linkText:info['announcement link text']||'', link:/^https?:\/\//i.test(info['announcement link']||'')?info['announcement link']:'' };
    out.pricesChecked=info['prices last checked']||'';

    var order=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'], byDay={};
    t.Hours.forEach(function(r){ byDay[(r.day||'').toLowerCase()]=r; });
    var hours=order.map(function(d){ var r=byDay[d]; if(!r) return null; var o=time24(r.opens), c=time24(r.closes), closed=yes(r['closed all day']);
      if(!closed&&(!o||!c)) return null; return { day:d.charAt(0).toUpperCase()+d.slice(1), open:o, close:c, closed:closed }; });
    out.hours = hours.indexOf(null)<0 ? hours : base.hours; // a half-filled Hours tab never reaches the page

    var secs=[], byName={};
    t.Sections.forEach(function(r){ if(!r.section) return; var s={ id:slug(r.section), name:r['heading on the site']||r.section, items:[] };
      var p=num(r['price for every item']); if(p) s.price=p; if(yes(r['in the quick links'])) s.nav=s.name; if(/^compact$/i.test(r.layout)) s.compact=true; if(r['note under the section']) s.note=r['note under the section'];
      byName[r.section.toLowerCase()]=s; secs.push(s); });
    t.Menu.forEach(function(r){ if(!r.item) return; var st=(r.status||'live').toLowerCase();
      if(st==='hidden'||(st==='draft'&&!preview)) return;
      var key=(r.section||'More').toLowerCase(), s=byName[key];
      if(!s){ s={ id:slug(r.section||'More'), name:r.section||'More', items:[] }; byName[key]=s; secs.push(s); }
      var it={ id:s.id+'-'+slug(r.item), name:r.item, desc:r.description||'' }, p=num(r.price);
      if(p) it.price=p; if(yes(r['starts at'])) it.from=true; if(st==='sold out') it.soldOut=true;
      var tags=(r.note||'').split(';').map(function(x){ return x.trim(); }).filter(Boolean); if(st==='draft') tags.push('Draft, not public'); if(tags.length) it.tags=tags;
      s.items.push(it); });
    secs=secs.filter(function(s){ return s.items.length; });
    secs.forEach(function(s){ s.items=s.items.filter(function(it){ return it.price||s.price; }); var n=s.items.length; if(!s.compact&&n<=3&&n%2===1) s.items[n-1].solo=true; });
    secs=secs.filter(function(s){ return s.items.length; });
    if(secs.length) out.menu={ groups:secs };
    return out;
  }

  function show(data){ if(window.TACO_APPLY) window.TACO_APPLY(data); }
  function badge(){ var framed=false; try{ framed=window.top!==window; }catch(e){ framed=true; } if(!preview||framed||document.getElementById('taco-preview')) return; var b=document.createElement('a'); b.id='taco-preview'; b.href=location.pathname+'?preview=0';
    b.textContent=draft?'Preview of unpublished changes. Close preview':'Preview: drafts are showing. Turn off'; b.setAttribute('style','position:fixed;right:12px;bottom:12px;z-index:200;background:#9e4c17;color:#fbf4e8;padding:10px 14px;font:500 14px/1.2 "DM Sans",system-ui,sans-serif;text-decoration:none;border-radius:4px');
    document.body.appendChild(b); }

  function tables(tabs){ var t={}; TABS.forEach(function(tab){ t[tab]=table(tabs[tab]||[]); }); if(!t.Info.length||!t.Hours.length) throw new Error('empty data'); return t; }
  function stored(k){ try{ return JSON.parse(localStorage.getItem(k)||'null'); }catch(e){ return null; } }

  // 1. a preview opened from the editor: the unpublished changes kept in this browser
  if(draft){ var d=stored('taco-draft'); if(d){ try{ show(build(tables(d))); }catch(e){} } badge(); return; }
  // 2. no sheet connected: the editor's demo mode publishes to this browser only
  if(!cfg.api&&!cfg.id&&!cfg.base){ var demo=stored('taco-demo'); if(demo){ try{ show(build(tables(demo))); }catch(e){} } return; }

  var src=cfg.api||cfg.id||cfg.base, saved=stored(KEY); if(saved&&saved.id===src&&!preview){ try{ show(saved.data); }catch(e){} }
  var load = cfg.api
    ? fetch(cfg.api+(cfg.api.indexOf('?')<0?'?':'&')+'action=read', {cache:'no-store'}).then(function(r){ if(!r.ok) throw new Error('editor '+r.status); return r.json(); }).then(function(j){ if(!j||!j.tabs) throw new Error('editor sent no data'); return tables(j.tabs); })
    : Promise.all(TABS.map(function(tab){ return fetch(url(tab), {cache:'no-store'}).then(function(r){ if(!r.ok) throw new Error(tab+' '+r.status); return r.text(); }); })).then(function(texts){ var o={}; TABS.forEach(function(tab,i){ o[tab]=csv(texts[i]); }); return tables(o); });
  load.then(function(t){ var data=build(t); show(data); badge();
      if(!preview){ try{ localStorage.setItem(KEY, JSON.stringify({ id:src, data:data })); }catch(e){} } })
    .catch(function(e){ if(window.console) console.warn('T/aco editor data not read, keeping the built-in facts:', e.message); });
})();
