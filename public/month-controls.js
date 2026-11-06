(()=>{
 const valid=k=>typeof k==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(k)&&k>='1900-01'&&k<='9999-12';
 const label=k=>valid(k)?new Date(k+'-01T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',month:'long',year:'numeric'}):'';
 function move(k,n){if(!valid(k)||!Number.isInteger(n))return '';const [y,m]=k.split('-').map(Number),i=y*12+m-1+n,year=Math.floor(i/12),month=i%12+1;const next=String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0');return valid(next)?next:''}
 function options(k,min='1900-01',max='9999-12'){return Array.from({length:25},(_,i)=>move(k,i-12)).filter(v=>v&&v>=min&&v<=max).map(v=>`<option value="${v}"${v===k?' selected':''}>${label(v)}</option>`).join('')}
 function today(){const a=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(t=>a.find(p=>p.type===t).value).join('-')}
 function set(control,k){control.innerHTML=options(k);control.value=k}
 globalThis.SwaMonths={valid,label,move,options,today,set};
})();
