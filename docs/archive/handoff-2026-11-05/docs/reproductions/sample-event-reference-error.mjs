import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../../source/app/portal.html',import.meta.url),'utf8');
let code=html.match(/<script>([\s\S]*)<\/script>/)[1];
code=code.slice(0,code.indexOf("if(location.hash==='#policy')"));
const nodes=new Map();
const node=s=>{if(!nodes.has(s))nodes.set(s,{value:'',style:{},textContent:'',innerHTML:'',focus(){}});return nodes.get(s)};
const ctx=vm.createContext({console,structuredClone,crypto,URL,Intl,Date,JSON,Set,FormData,location:{hash:''},document:{querySelector:node,addEventListener(){}},window:{addEventListener(){}},setTimeout(){},confirm:()=>true});
vm.runInContext(code,ctx);
vm.runInContext(`hydratePrograms();data.events=[{id:'sample-camp',name:'Sample camp',type:'Camp',dates:[new Date(Date.now()+30*86400000).toISOString().slice(0,10),new Date(Date.now()+31*86400000).toISOString().slice(0,10)],price:160,day:60,slots:20}];`,ctx);
node('#eventKid').value='0';node('#campOption').value='Full camp';
try{vm.runInContext('finishEvent(0)',ctx);console.log('No error reproduced. Recheck source version.');process.exitCode=2}catch(error){console.log(error.name+': '+error.message);if(error.name!=='ReferenceError'||!error.message.includes('annual'))process.exitCode=1}
