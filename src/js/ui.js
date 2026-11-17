/* In-page links glide, and the heading you land on marks itself. */
(function(){
  var calm=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function find(hash){ try{ return document.getElementById(decodeURIComponent(hash.slice(1))); }catch(e){ return null; } }
  function go(el){ el.scrollIntoView({behavior:calm?'auto':'smooth', block:'start'});
    var h=el.matches('h1,h2,h3')?el:(el.querySelector('h1,h2,h3')||el);
    document.querySelectorAll('.landed').forEach(function(x){ x.classList.remove('landed'); }); void h.offsetWidth; h.classList.add('landed');
    if(!el.hasAttribute('tabindex')) el.setAttribute('tabindex','-1'); el.focus({preventScroll:true}); }
  document.addEventListener('click', function(e){ var a=e.target.closest('a[href]'); if(!a||e.metaKey||e.ctrlKey||e.shiftKey) return; var u=new URL(a.getAttribute('href'), location.href);
    if(u.pathname===location.pathname && u.hash.length>1){ var el=find(u.hash); if(el){ e.preventDefault(); if(location.hash!==u.hash) history.pushState(null,'',u.hash); go(el); } } });
  addEventListener('popstate', function(){ var el=location.hash.length>1&&find(location.hash); if(el) go(el); else scrollTo({top:0, behavior:calm?'auto':'smooth'}); });
  if(location.hash.length>1){ var t=find(location.hash); if(t){ if('scrollRestoration' in history) history.scrollRestoration='manual'; scrollTo(0,0);
    addEventListener('load', function(){ scrollTo(0,0); setTimeout(function(){ go(t); }, 350); }); } }
})();

/* Phone menu. */
/* phones: the nav folds into a Menu button. the button only exists at phone width. */
(function(){
  var H=document.documentElement, hd=document.querySelector('.page > header'), nav=hd&&hd.querySelector('nav'); if(!nav) return;
  nav.id=nav.id||'mainnav';
  var b=document.createElement('button'); b.type='button'; b.className='navtog'; b.setAttribute('aria-controls',nav.id); b.setAttribute('aria-expanded','false'); b.textContent='Menu';
  hd.insertBefore(b, nav);
  function set(o){ hd.classList.toggle('nav-open',o); b.setAttribute('aria-expanded',String(o)); b.textContent=o?'Close':'Menu'; }
  b.addEventListener('click', function(){ set(!hd.classList.contains('nav-open')); });
  nav.addEventListener('click', function(e){ if(e.target.closest('a')) set(false); });
  addEventListener('keydown', function(e){ if(e.key==='Escape'&&hd.classList.contains('nav-open')){ set(false); b.focus(); } });
  addEventListener('resize', function(){ if(!H.classList.contains('m')) set(false); });
})();
