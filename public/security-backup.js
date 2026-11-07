const FORMAT='savage-encrypted-backup-v1',FORMAT2='savage-encrypted-backup-v2',PROJECT='appgprj_6ad13665e8c881918c12b096132b4cae';
function base64(bytes){let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value)}
function unbase64(value){if(typeof value!=='string'||value.length>9000000)throw Error('Invalid encrypted backup.');return Uint8Array.from(atob(value),c=>c.charCodeAt(0))}
async function keyFor(password,salt){if(typeof password!=='string'||password.length<12||password.length>256)throw Error('Use a backup passphrase between 12 and 256 characters.');const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:600000},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
// Version 1 files (savage-encrypted-backup-v1): the whole backup object as JSON, encrypted, in a JSON envelope. Made
// until issue #221 and still restored; the page no longer writes them.
export async function encryptBackup(backup,password){const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await keyFor(password,salt);const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(FORMAT+PROJECT)},key,new TextEncoder().encode(JSON.stringify(backup)));return {format:FORMAT,project:PROJECT,iterations:600000,salt:base64(salt),iv:base64(iv),data:base64(new Uint8Array(encrypted))}}
export async function decryptBackup(envelope,password){if(envelope?.format!==FORMAT||envelope.project!==PROJECT||envelope.iterations!==600000)throw Error('This encrypted backup format is not supported.');const salt=unbase64(envelope.salt),iv=unbase64(envelope.iv);if(salt.length!==16||iv.length!==12)throw Error('Invalid encrypted backup.');try{const key=await keyFor(password,salt),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(FORMAT+PROJECT)},key,unbase64(envelope.data));return JSON.parse(new TextDecoder().decode(plain))}catch{throw Error('The passphrase is incorrect or the backup file is damaged.')}}

// ---------- Version 2 files (issue #221) ----------
// A file is one line of JSON naming the format, then the encrypted data:
//   {"format":"savage-encrypted-backup-v2","project":...,"cipher":"AES-256-GCM","kdf":"PBKDF2-SHA256","iterations":600000,
//    "salt":<16 bytes, base64>,"iv":<12 bytes, base64>,"compression":"gzip"}\n<AES-256-GCM ciphertext and tag>
// The same passphrase scheme as version 1 (PBKDF2-SHA256, 600,000 iterations, a random salt and IV for every file,
// AES-256-GCM), with the whole first line as the authenticated data, so no part of it can be changed. The plaintext is
// gzip-compressed lines of JSON (lib/backup-records.ts backupLines): a header, sections of rows, and an end line with
// every section's row count. The passphrase never leaves the browser; the server only ever sees rows it already holds.
const MAX_V1=9000000,MAX_V2=512*1024*1024,STAGE_CHARS=4000000;
const UNSUPPORTED='This encrypted backup format is not supported.',WRONG='The passphrase is incorrect or the backup file is damaged.',DAMAGED='This backup file is incomplete or damaged.';
const encoder=new TextEncoder();
// Lines of JSON from a stream of bytes, parsed one at a time.
export async function* readLines(stream){
 const reader=stream.pipeThrough(new TextDecoderStream()).getReader();let parts=[];
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   let start=0,i;
   while((i=value.indexOf('\n',start))>=0){parts.push(value.slice(start,i));const line=parts.join('');parts=[];start=i+1;if(line.trim())yield JSON.parse(line)}
   parts.push(value.slice(start));
  }
  const last=parts.join('');if(last.trim())yield JSON.parse(last);
 }finally{reader.releaseLock()}
}
// Passes backup lines through in order, checking them: a header for this academy first, then sections of rows, then an end
// line whose counts match the rows that came before it. An {"error"} line from the server stops with its message; lines
// that stop early stop with `incomplete`.
export async function* checkedLines(lines,incomplete=DAMAGED){
 let header=null,end=null;const seen={};
 for await(const line of lines){
  if(line&&typeof line.error==='string')throw Error(line.error);
  if(end||!line||typeof line!=='object')throw Error(DAMAGED);
  if(!header){if(![1,2,3].includes(line.version)||line.project!==PROJECT||!('academy' in line))throw Error('This is not a supported backup for this academy.');header=line}
  else if(line.end===true){
   if(!line.rows||typeof line.rows!=='object'||Object.keys(seen).some(t=>!(t in line.rows))||Object.entries(line.rows).some(([t,n])=>(seen[t]||0)!==n))throw Error(DAMAGED);
   end=line;
  }else{if(typeof line.table!=='string'||!Array.isArray(line.rows))throw Error(DAMAGED);seen[line.table]=(seen[line.table]||0)+line.rows.length}
  yield line;
 }
 if(!end)throw Error(incomplete);
}
// Lines from a backup object: a version 1, 2 or 3 file, or a recovery snapshot.
export function* linesOf(backup){
 if(!backup||typeof backup!=='object')throw Error('Unsupported backup contents.');
 yield {version:backup.version,project:backup.project,createdAt:backup.createdAt,academy:backup.academy};
 const later=backup.version>=2,sections=[['families',backup.families],['openings',backup.openings],...(later?Object.entries(backup.records||{}):[]),...(later?[['security_events',backup.archive&&backup.archive.security_events]]:[])],rows={};
 for(const [table,list] of sections){if(!Array.isArray(list))throw Error('Unsupported backup contents.');rows[table]=list.length;for(let i=0;i<list.length;i+=1000)yield {table,rows:list.slice(i,i+1000)}}
 yield {end:true,rows,truncated:!!(backup.archive&&backup.archive.truncated)};
}
// Writes checked lines into a version 2 file. `lines` is the Backups download (readLines of /api/backups?mode=lines) or
// linesOf a snapshot. Nothing is returned unless every line arrived, so a download cut short never becomes a file.
export async function encryptLines(lines,password){
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await keyFor(password,salt);
 const gzip=new CompressionStream('gzip'),writer=gzip.writable.getWriter(),compressed=new Response(gzip.readable).arrayBuffer();
 let header=null,end=null;
 try{
  for await(const line of checkedLines(lines,'The backup download did not finish. No file was saved. Try again.')){header??=line;if(line.end===true)end=line;await writer.ready;writer.write(encoder.encode(JSON.stringify(line)+'\n')).catch(()=>{})}
  await writer.close();
 }catch(e){writer.abort(e).catch(()=>{});compressed.catch(()=>{});throw e}
 const plain=new Uint8Array(await compressed);
 const head=JSON.stringify({format:FORMAT2,project:PROJECT,cipher:'AES-256-GCM',kdf:'PBKDF2-SHA256',iterations:600000,salt:base64(salt),iv:base64(iv),compression:'gzip'});
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(head)},key,plain);
 return {blob:new Blob([head+'\n',data],{type:'application/octet-stream'}),header,end,compressedBytes:plain.length};
}
// Opens a backup file of either version: decrypts it, reads every line once to check it, and returns the header, every
// section's row count and a way to read the lines again for the restore. Only the compressed data stays in memory.
export async function openBackup(file,password){
 const first=new Uint8Array(await file.slice(0,4096).arrayBuffer()),newline=first.indexOf(10);
 let head=null;if(newline>0){try{head=JSON.parse(new TextDecoder().decode(first.subarray(0,newline)))}catch{}}
 let lines;
 if(head&&head.format===FORMAT2){
  if(head.project!==PROJECT||head.cipher!=='AES-256-GCM'||head.kdf!=='PBKDF2-SHA256'||head.iterations!==600000||head.compression!=='gzip')throw Error(UNSUPPORTED);
  if(file.size>MAX_V2)throw Error('Choose an encrypted backup smaller than 512 MB.');
  const salt=unbase64(head.salt),iv=unbase64(head.iv);if(salt.length!==16||iv.length!==12)throw Error('Invalid encrypted backup.');
  let plain;try{const key=await keyFor(password,salt);plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:first.subarray(0,newline)},key,await file.slice(newline+1).arrayBuffer())}catch{throw Error(WRONG)}
  lines=()=>checkedLines(readLines(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))));
 }else{
  if(file.size>MAX_V1)throw Error('Choose an encrypted backup smaller than 9 MB.');
  let envelope;try{envelope=JSON.parse(await file.text())}catch{throw Error(UNSUPPORTED)}
  const backup=await decryptBackup(envelope,password);
  lines=()=>checkedLines(linesOf(backup));
 }
 let header=null,end=null;
 // Messages from checkedLines pass through; a line that is not JSON or data that does not decompress is damage.
 try{for await(const line of lines()){header??=line;if(line.end===true)end=line}}catch(e){throw Error(e&&e.name==='Error'?e.message:DAMAGED)}
 return {header,rows:end.rows,truncated:end.truncated,lines};
}
// Restores an opened backup through the server in parts (POST /api/backups: begin, stage, commit). `send` posts one JSON
// body and returns the reply, throwing on an error. `progress(sent,total)` is told how many rows have been uploaded.
export async function restoreLines(opened,fingerprint,send,progress=()=>{}){
 const {upload}=await send({action:'begin'}),total=Object.values(opened.rows).reduce((a,b)=>a+b,0);
 let batch=[],chars=0,sent=0;
 const flush=async()=>{if(!batch.length)return;await send({action:'stage',upload,sections:batch});sent+=batch.reduce((n,s)=>n+s.rows.length,0);batch=[];chars=0;progress(sent,total)};
 for await(const line of opened.lines()){
  if(typeof line.table!=='string')continue;
  for(const row of line.rows){
   const n=JSON.stringify(row).length+1;if(chars&&chars+n>STAGE_CHARS)await flush();
   let section=batch[batch.length-1];if(!section||section.table!==line.table){section={table:line.table,rows:[]};batch.push(section)}
   section.rows.push(row);chars+=n;
  }
 }
 await flush();
 return send({action:'commit',upload,fingerprint,header:opened.header,rows:opened.rows,truncated:opened.truncated});
}
