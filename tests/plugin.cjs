const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!doctype html><body></body>');
global.window=dom.window;global.document=dom.window.document;global.MutationObserver=dom.window.MutationObserver;
global.BdApi={DOM:{addStyle(){},removeStyle(){}}};
const Plugin=require('../MarkdownRender.plugin.js');
const p=new Plugin();const url='https://cdn.discordapp.com/attachments/1/2/file.md';
let calls=0, mode='ok';
global.fetch=async(u,options)=>{calls++;assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');if(mode==='403')return new Response('',{status:403});if(mode==='large')return new Response('x',{headers:{'content-length':'1048577'}});if(mode==='streamlarge')return new Response('x'.repeat(1048577));return new Response('# Full file\n\n| A | B |\n| - | - |\n| 1 | 2 |');};
(async()=>{
 assert.match(await p.download(url,new AbortController().signal),/# Full file/);
 for(const value of ['403','large','streamlarge']) {mode=value;await assert.rejects(p.download(url,new AbortController().signal),value==='403'?/403/:/1 MiB/);}
 mode='ok';calls=0;
 document.body.innerHTML=`<div class="attachment_test"><div class="textContainer_test"><pre><code># Already loaded</code></pre></div><a href="${url}">file.md</a></div>`;
 p.start();assert.equal(calls,0);assert.match(document.querySelector('.mda-toolbar').textContent,/Discord preview/);assert.match(document.querySelector('.mda-body').textContent,/Already loaded/);
 document.querySelectorAll('button')[1].click();await new Promise(r=>setTimeout(r,10));assert.equal(calls,1);assert.match(document.querySelector('.mda-toolbar').textContent,/full file/);assert.ok(document.querySelector('table'));p.stop();
 document.body.innerHTML=`<div class="attachment_test"><a href="${url}">file.md</a></div>`;
 p.start();await new Promise(r=>setTimeout(r,10));assert.equal(calls,2);assert.match(document.querySelector('.mda-toolbar').textContent,/full file/);p.stop();
 console.log('PASS: browser download, HTTP and size failures, no redundant preview download, explicit full download, completion status, download-only auto loading, Markdown tables, cleanup.');
})().catch(e=>{p.stop();console.error(e);process.exitCode=1;});
