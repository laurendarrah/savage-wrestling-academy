(()=>{
 const key='savage-registration-return';
 function safe(value){if(typeof value!=='string'||value.length>1500||!value.startsWith('/')||value.startsWith('//')||/[\\\r\n]/.test(value))return '';try{const u=new URL(value,location.origin);return u.origin===location.origin&&['/register','/booking'].includes(u.pathname)?u.pathname+u.search:''}catch{return ''}}
 function peek(){try{return safe(sessionStorage.getItem(key))}catch{return ''}}
 function clear(){try{sessionStorage.removeItem(key)}catch{}}
 function remember(){const value=safe(new URLSearchParams(location.search).get('next'));if(value)try{sessionStorage.setItem(key,value)}catch{}}
 function take(){const value=peek();clear();return value}
 globalThis.SavageReturn={peek,clear,remember,take};remember();
})();
