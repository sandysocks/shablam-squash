// Optional Windows browser smoke test. No browser automation package required.
// Run with Node 22+ and Microsoft Edge installed. Outputs stay in test-results/.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../',import.meta.url));
const edge = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9333;
await mkdir(new URL('../.tools/edge-profile/',import.meta.url),{recursive:true});
await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
const server = spawn(process.execPath,[fileURLToPath(new URL('./serve.mjs',import.meta.url))],{cwd:root,env:process.env,windowsHide:true,stdio:'ignore'});
const browser = spawn(edge,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${port}`,`--user-data-dir=${fileURLToPath(new URL('../.tools/edge-profile/',import.meta.url))}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let socket, client;
async function eventually(fn, description, timeout = 12000) {
  const start = Date.now();
  while (Date.now()-start < timeout) { try { const result = await fn(); if (result) return result; } catch {} await delay(100); }
  throw new Error(`Timed out: ${description}`);
}
const exceptions = [];
try {
  await eventually(async () => (await fetch('http://127.0.0.1:4173',{signal:AbortSignal.timeout(1000)})).ok,'local server');
  const page = await eventually(async () => (await (await fetch(`http://127.0.0.1:${port}/json`,{signal:AbortSignal.timeout(1000)})).json()).find(t => t.type === 'page'),'Edge debugging connection');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{once:true}); socket.addEventListener('error',reject,{once:true}); });
  let counter = 0; const pending = new Map();
  socket.addEventListener('message',event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    if (message.id && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result); }
  });
  client = (method,params = {}) => new Promise((resolve,reject) => { const id = ++counter; pending.set(id,{resolve,reject}); socket.send(JSON.stringify({id,method,params})); });
  const evaluate = async expression => {
    const response = await client('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector,value) => evaluate(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)}`);
  const submit = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
  const state = () => evaluate("JSON.parse(localStorage.getItem('shablam-squash-demo-v1'))");
  const wait = (expression,description) => eventually(() => evaluate(expression),description);
  await client('Runtime.enable'); await client('Page.enable');
  await client('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await client('Page.navigate',{url:'http://127.0.0.1:4173'});
  await wait("document.querySelectorAll('.ladder-table tbody tr').length===8",'initial ladder');
  await evaluate("localStorage.removeItem('shablam-squash-demo-v1'); localStorage.removeItem('shablam-squash-demo-player')");
  await client('Page.reload');
  await wait("document.querySelectorAll('.ladder-table tbody tr').length===8",'fresh demo');
  assert.equal(await evaluate('document.title'),'Shablam Squash · The Cambridge Ladder');

  await click('.table-challenge[data-player="demo-7"]');
  await wait("!!document.querySelector('#challenge-form')",'challenge form');
  await fill('#note','Browser check: Friday evening?'); await submit('#challenge-form');
  await wait("!document.querySelector('#modal').open && document.querySelector('#board-heading').textContent.includes('challenge')",'new challenge');
  let saved = await state();
  const c = saved.challenges.find(c => c.note === 'Browser check: Friday evening?');
  assert.ok(c);
  async function switchTo(id) {
    await click('#member-button'); await fill('#demo-player',id); await submit('#switch-form');
    await wait(`!document.querySelector('#modal').open && localStorage.getItem('shablam-squash-demo-player')===${JSON.stringify(id)}`,'member switch');
  }
  await switchTo('demo-7');
  await click(`[data-action="respond"][data-id="${c.id}"][data-response="accepted"]`);
  await wait(`JSON.parse(localStorage.getItem('shablam-squash-demo-v1')).challenges.find(c=>c.id===${JSON.stringify(c.id)}).status==='accepted'`,'accepted challenge');
  await click(`[data-action="result"][data-id="${c.id}"]`);
  await fill('#score-a','3'); await fill('#score-b','3'); await submit('#result-form');
  await wait("!document.querySelector('#result-form .form-message').hidden",'invalid score rejected');
  await fill('#score-a','0'); await fill('#score-b','3'); await submit('#result-form');
  await wait("!document.querySelector('#modal').open && document.querySelector('#board-heading').textContent.includes('ledger')",'submitted result');
  saved = await state(); const match = saved.matches.find(m => m.challenge_id === c.id);
  assert.equal(match.status,'pending');
  assert.equal(await evaluate(`!!document.querySelector('[data-action="review"][data-id="${match.id}"]')`),false);
  await switchTo('demo-4');
  await click(`[data-action="review"][data-id="${match.id}"]`);
  await wait(`JSON.parse(localStorage.getItem('shablam-squash-demo-v1')).matches.find(m=>m.id===${JSON.stringify(match.id)}).status==='confirmed'`,'result confirmed');
  saved = await state(); assert.equal(saved.challenges.find(x => x.id === c.id).status,'completed');
  console.log('PASS: issue → switch identity → accept → reject invalid score → submit → other player confirms');

  await click('[data-view="ladder"]');
  await fill('#search','Freddie');
  await evaluate("document.querySelector('#search').dispatchEvent(new Event('input',{bubbles:true}))");
  assert.equal(await evaluate("document.querySelectorAll('.ladder-table tbody tr').length"),1);
  console.log('PASS: player search');
  await click('#member-button'); await click('[data-action="reset"]'); await click('[data-action="confirm-reset"]');
  await wait("!document.querySelector('#modal').open",'reset demonstration');
  await click('[data-view="ladder"]');
  await wait("document.querySelectorAll('.ladder-table tbody tr').length===8",'reset ladder');

  for (const [label,width,height,mobile] of [['desktop',1440,1100,false],['mobile',390,844,true]]) {
    await client('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
    await evaluate("document.activeElement?.blur(); document.querySelector('#toast').hidden=true; document.documentElement.style.scrollBehavior='auto'; window.scrollTo(0,0)");
    await delay(450);
    const dimensions = await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');
    assert.ok(dimensions.scroll <= dimensions.width,`${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
    const shot = await client('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    await writeFile(new URL(`../test-results/${label}.png`,import.meta.url),Buffer.from(shot.data,'base64'));
    console.log(`PASS: ${label} layout (${width}px), no horizontal overflow`);
  }
  assert.equal(exceptions.length,0,`Browser errors: ${exceptions.join(', ')}`);
  console.log('PASS: no unhandled browser exceptions');
} finally {
  if (client) { try { await client('Browser.close'); } catch {} }
  socket?.close(); browser.kill(); server.kill();
}
