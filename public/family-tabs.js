(() => {
 const navigation=document.getElementById('familyTabs');
 const panels=new Map(Array.from(document.querySelectorAll('[data-family-panel]'),panel=>[panel.dataset.familyPanel,panel]));
 const tools=new Map();
 function loadTool(panel){
  const frame=document.createElement('iframe'),status=document.createElement('p');
  const path=panel.dataset.tool;
  frame.className='family-tool-frame';
  frame.title=panel.getAttribute('aria-label');
  frame.hidden=true;
  status.setAttribute('role','status');
  status.textContent='Loading '+frame.title+'…';
  let observer,resize=()=>{};
  frame.addEventListener('load',()=>{
   observer?.disconnect();
   try{
    const doc=frame.contentDocument,main=doc?.querySelector('body.family-embedded main');
    if(!main)throw Error('Panel unavailable');
    status.hidden=true;frame.hidden=false;
    resize=()=>{
     if(!panel.hidden)frame.style.height=Math.ceil(main.getBoundingClientRect().height+2)+'px';
    };
    observer=new ResizeObserver(resize);
    observer.observe(main);resize();
    doc.addEventListener('click',event=>{
     const link=event.target.closest?.('a[href]');
     if(!link||link.target||link.hasAttribute('download')||link.getAttribute('href').startsWith('#'))return;
     const url=new URL(link.href);
     if(url.origin===location.origin)link.target='_top';
    });
   }catch{
    frame.hidden=true;status.hidden=false;
    status.textContent='This section could not load here. ';
    const retry=document.createElement('button'),link=document.createElement('a');
    retry.type='button';retry.textContent='Retry';
    retry.onclick=()=>{status.textContent='Loading…';frame.src=path+'?embed=family'};
    link.href=path;link.target='_top';link.textContent='Open separately';
    status.append(retry,' ',link);
   }
  });
  frame.src=path+'?embed=family';
  panel.append(status,frame);
  tools.set(panel,()=>requestAnimationFrame(resize));
 }
 function render(){
  const hash=location.hash.slice(1),current=panels.has(hash)?hash:'summary';
  for(const [name,panel] of panels)panel.hidden=name!==current;
  for(const link of navigation.querySelectorAll('a')){
   if(link.hash==='#'+current)link.setAttribute('aria-current','page');
   else link.removeAttribute('aria-current');
  }
  const panel=panels.get(current);
  if(panel.dataset.tool&&!tools.has(panel))loadTool(panel);
  tools.get(panel)?.();
 }
 navigation.addEventListener('click',event=>{
  const link=event.target.closest('a');
  if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;
  event.preventDefault();
  if(link.hash!==location.hash){
   if(window.SavageNavigation)window.SavageNavigation.commit(link.hash);
   else history.pushState({},'',link.hash);
  }
  render();
  navigation.scrollIntoView({block:'nearest'});
 });
 window.addEventListener('hashchange',render);
 window.addEventListener('popstate',render);
 render();
})();
