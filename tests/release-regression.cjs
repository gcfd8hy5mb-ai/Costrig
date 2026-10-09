const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('app-core-v4.9.7.html', 'utf8');
function section(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert(a >= 0 && b > a, 'runtime section not found: ' + start);
  return html.slice(a, b);
}
const token = (exp, sub = 'test-a') => 'header.' + Buffer.from(JSON.stringify({ exp, sub })).toString('base64url') + '.signature';
function context(sessionValue, fetch) {
  const c = vm.createContext({ fetch, FormData, atob, Date, JSON, Number, Error, console, sessionValue });
  vm.runInContext('let session=sessionValue; const SB_URL="https://example.invalid"; const SB_KEY="public-test-key"; let saved=0; function saveSession(){saved++}', c);
  vm.runInContext(section('function authHeaders(', 'function saveSession('), c);
  vm.runInContext(section('let sessionRefreshPromise=', 'async function init('), c);
  return c;
}
function response(data, status = 200) {
  return { ok: status < 400, status, headers: {}, json: async () => data, text: async () => JSON.stringify(data) };
}
let count = 0;
async function check(name, action) {
  if(process.argv[2]&&!name.includes(process.argv[2]))return;
  await action(); count++; console.log('PASS', name);
}
(async () => {
  const now = Math.floor(Date.now() / 1000);
  await check('Free report gate does not render Pro equipment rankings', async () => {
    const c = vm.createContext({});
    vm.runInContext('const workspace={id:"test"}; const reportsContent={innerHTML:""}; function isPro(){return false}', c);
    vm.runInContext(section('function renderReports(', 'function isPro('), c);
    vm.runInContext('renderReports()', c);
    assert.match(vm.runInContext('reportsContent.innerHTML', c), /Advanced reports are a Pro feature/);
    assert.match(vm.runInContext('reportsContent.innerHTML', c), /View Pro/);
  });
  await check('save completion preserves newer navigation and otherwise opens saved details', async () => {
    const c = vm.createContext({});
    vm.runInContext('let navigationRevision=3; let opened=0;', c);
    vm.runInContext(section('function restoreAfterSave(', 'function show('), c);
    vm.runInContext('restoreAfterSave(3,()=>opened++)', c);
    assert.equal(vm.runInContext('opened', c), 1);
    vm.runInContext('navigationRevision++; restoreAfterSave(3,()=>opened++)', c);
    assert.equal(vm.runInContext('opened', c), 1);
  });
  await check('currency displays cents instead of rounding recorded expenses to dollars', async () => {
    const c = vm.createContext({ Intl, Number });
    vm.runInContext(section('function money(', 'function localDate('), c);
    assert.equal(vm.runInContext('money(10.50)', c), '$10.50');
    assert.equal(vm.runInContext('money(0.25)', c), '$0.25');
    assert.equal(vm.runInContext('money(36.75)', c), '$36.75');
    assert.equal(vm.runInContext('money(0)', c), '$0.00');
  });
  await check('unexpired sessions do not refresh', async () => {
    let calls = 0;
    const c = context({ access_token: token(now + 3600), refresh_token: 'refresh-a' }, async url => {
      calls++; assert(!url.includes('grant_type')); return response([]);
    });
    await vm.runInContext('sb("/rest/v1/assets")', c); assert.equal(calls, 1);
  });
  await check('concurrent expired requests share one refresh and use the new token', async () => {
    let refreshes = 0, writes = 0;
    const fresh = token(now + 3600);
    const c = context({ access_token: token(now - 1), refresh_token: 'refresh-a' }, async (url, opts) => {
      if (url.includes('grant_type')) { refreshes++; await new Promise(r => setImmediate(r)); return response({ access_token: fresh, refresh_token: 'refresh-b' }); }
      assert.equal(opts.headers.Authorization, 'Bearer ' + fresh); writes++; return response([]);
    });
    await vm.runInContext('Promise.all([sb("/rest/v1/assets"),sb("/rest/v1/repairs"),sb("/rest/v1/expenses")])', c);
    assert.equal(refreshes, 1); assert.equal(writes, 3); assert.equal(vm.runInContext('saved', c), 1);
  });
  await check('failed refresh prevents writes and a later refresh can recover', async () => {
    let calls = 0, writes = 0;
    const c = context({ access_token: token(now - 1), refresh_token: 'refresh-a' }, async url => {
      if (url.includes('grant_type')) return ++calls === 1 ? response({ message: 'Expired' }, 400) : response({ access_token: token(now + 3600), refresh_token: 'refresh-b' });
      writes++; return response([]);
    });
    await assert.rejects(vm.runInContext('sb("/rest/v1/assets",{method:"POST",body:"{}"})', c), /could not be refreshed/);
    assert.equal(writes, 0);
    await vm.runInContext('sb("/rest/v1/assets")', c); assert.equal(writes, 1); assert.equal(calls, 2);
  });
  await check('sign-out during refresh cannot resurrect the old session', async () => {
    let resolve;
    const c = context({ access_token: token(now - 1), refresh_token: 'refresh-a' }, () => new Promise(r => { resolve = r; }));
    const pending = vm.runInContext('refreshSessionIfNeeded()', c);
    vm.runInContext('session=null', c);
    resolve(response({ access_token: token(now + 3600), refresh_token: 'refresh-b' }));
    assert.equal(await pending, false); assert.equal(vm.runInContext('session', c), null);
  });
  await check('account change during refresh preserves the new account', async () => {
    let resolve;
    const c = context({ access_token: token(now - 1), refresh_token: 'refresh-a' }, () => new Promise(r => { resolve = r; }));
    const pending = vm.runInContext('refreshSessionIfNeeded()', c);
    vm.runInContext('session={access_token:"account-b",refresh_token:"refresh-b"}', c);
    resolve(response({ access_token: token(now + 3600), refresh_token: 'refresh-a-new' }));
    assert.equal(await pending, false); assert.equal(vm.runInContext('session.access_token', c), 'account-b');
  });
  await check('API errors do not automatically replay a write', async () => {
    let calls = 0;
    const c = context({ access_token: token(now + 3600), refresh_token: 'refresh-a' }, async () => { calls++; return response({ message: 'Permission denied' }, 403); });
    await assert.rejects(vm.runInContext('sb("/rest/v1/assets",{method:"POST",body:"{}"})', c), /Permission denied/);
    assert.equal(calls, 1);
  });
  await check('cost totals remain equipment-specific and accept database numeric strings', async () => {
    const c = vm.createContext({});
    vm.runInContext('const maintenance=[{asset_id:"a",cost:"10.50"},{asset_id:"b",cost:900}]; const repairs=[{asset_id:"a",cost:"20.25"}]; const expenses=[{asset_id:"a",amount:"5.25"}]', c);
    vm.runInContext(section('function assetCosts(', 'function statusText('), c);
    const actual = JSON.parse(JSON.stringify(vm.runInContext('assetCosts("a")', c)));
    assert.deepEqual(actual, { m: 10.5, r: 20.25, e: 5.25 });
  });
  await check('mileage and hour schedules report due and overdue boundaries', async () => {
    const c = vm.createContext({ Date });
    vm.runInContext('const assets=[{id:"a",current_mileage:1000},{id:"b",current_hours:100}]', c);
    vm.runInContext(section('function scheduleState(', 'function scheduleCard('), c);
    assert.equal(vm.runInContext('scheduleState({asset_id:"a",next_due_mileage:999}).state', c), 'overdue');
    assert.equal(vm.runInContext('scheduleState({asset_id:"a",next_due_mileage:1000}).state', c), 'soon');
    assert.equal(vm.runInContext('scheduleState({asset_id:"a",next_due_mileage:1501}).state', c), 'ok');
    assert.equal(vm.runInContext('scheduleState({asset_id:"b",next_due_hours:99}).state', c), 'overdue');
    assert.equal(vm.runInContext('scheduleState({asset_id:"b",next_due_hours:126}).state', c), 'ok');
  });
  console.log(`${count} local regression checks passed. Live auth, RLS, camera, and push delivery remain separate.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
