const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),{webcrypto}=require('crypto');
const s=fs.readFileSync('persona-forge.plugin.js','utf8');
const code=s.slice(s.indexOf('const RELEASE_VERSION'),s.indexOf('const MARK'));
let response,downloads=0;
const context={crypto:webcrypto,Uint8Array,TextDecoder,Blob,URL,Date,Number,Error,Promise,setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t;},Risuai:{nativeFetch:async()=>response},document:{createElement:()=>({click(){downloads++},remove(){}}),body:{appendChild(){}}}};
vm.createContext(context);vm.runInContext(code+';globalThis.api={checkRelease,downloadRelease,newerVersion};',context);
(async()=>{
 const m=JSON.parse(fs.readFileSync('update/latest.json'));let checks=0;
 const ok=(v)=>{assert(v);checks++};
 ok(context.api.newerVersion('0.10.0','0.9.9'));ok(!context.api.newerVersion('0.2.0','0.3.0'));
 response={ok:true,json:async()=>m};ok((await context.api.checkRelease()).version===m.version);
 for(const bad of [{...m,url:'https://example.org/code.js'},{...m,version:'oops'},{...m,sha256:'bad'},{...m,bytes:9000000}]){response={ok:true,json:async()=>bad};await assert.rejects(context.api.checkRelease());checks++;}
 const bytes=fs.readFileSync('persona-forge.plugin.js');response={ok:true,arrayBuffer:async()=>bytes};await context.api.downloadRelease(m);ok(downloads===1);
 response={ok:true,arrayBuffer:async()=>Buffer.from('wrong')};await assert.rejects(context.api.downloadRelease(m));ok(downloads===1);
 response={ok:false};await assert.rejects(context.api.checkRelease());checks++;
 console.log(JSON.stringify({passed:true,checks}));
})();
