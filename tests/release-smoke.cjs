const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const files = ['index.html', 'app-core-v4.9.7.html'];
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi)];
  assert(scripts.length, file + ': no inline JavaScript found');
  for (const [i, match] of scripts.entries()) new vm.Script(match[1], { filename: file + ':inline-' + i });
  console.log('PASS syntax:', file, '(' + scripts.length + ' inline scripts)');
}
for (const file of ['edit-history-v4.9.8.js', 'sw.js']) {
  new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
  console.log('PASS syntax:', file);
}
const html = fs.readFileSync('index.html', 'utf8');
assert(html.includes('app-core-v4.9.7.html'), 'index must load core');
assert(html.includes('edit-history-v4.9.8.js'), 'index must load edit-history patch');
assert(html.indexOf('app-core-v4.9.7.html') < html.indexOf('edit-history-v4.9.8.js'), 'core must load before patch');
const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
assert.equal(manifest.display, 'standalone');
for (const icon of manifest.icons) assert(fs.existsSync(icon.src.replace(/^\.\//, '')), 'missing icon ' + icon.src);
for (const filename of ['app-core-v4.9.7.html', 'edit-history-v4.9.8.js']) assert(fs.existsSync(filename), 'missing runtime ' + filename);
console.log('PASS asset references and PWA manifest');
console.log('NOTE: These are static smoke tests, not browser, Supabase, RLS, or notification delivery tests.');

const core = fs.readFileSync('app-core-v4.9.7.html','utf8');
assert.match(core, /<select id="eqType" onchange="suggestEquipmentTracking\(\)"><option value="">Select Equipment Type<\/option>/);
assert.match(core, /if\(!eqType\.value\)return formMessage\("equipment","Select an equipment type\."/);
assert.match(core, /eqType\.value="";eqTracking\.value="none"/);
for (const [kind, tracking] of Object.entries({Mower:'hours',Truck:'miles',Trailer:'none',Generator:'hours',Compressor:'hours',Tool:'none',Other:'none'})) {
  assert(core.includes(kind+':"'+tracking+'"'), kind + ' tracking suggestion missing');
}
const equipmentForm = core.split('<div id="equipmentModal"')[1].split('<div id="entryModal"')[0];
assert(!/placeholder="/.test(equipmentForm), 'new equipment form must not contain example placeholders');
console.log('PASS new equipment form defaults and equipment tracking suggestions');

const scannerCore = fs.readFileSync('app-core-v4.9.7.html','utf8');
const scannerStart = scannerCore.slice(scannerCore.indexOf('async function startVinScan()'),scannerCore.indexOf('async function onVinScanned('));
assert(scannerStart.indexOf('decodeFromStream') < scannerStart.indexOf('if(detector){'), 'ZXing should be preferred before native fallback');
assert(scannerStart.includes('if(detector){'), 'native barcode decoder missing');
assert(scannerStart.includes('Camera access was denied'), 'camera permission guidance missing');
console.log('PASS Android VIN ZXing priority, native fallback and camera errors');

const vinSource=fs.readFileSync('app-core-v4.9.7.html','utf8');
assert(vinSource.includes('function extractScannedVin(value)'), 'VIN payload extraction available');
assert(vinSource.includes('const raw=extractScannedVin(result?.getText?.());'), 'ZXing extracts VIN payload');
assert(vinSource.includes('codes.map(c=>extractScannedVin(c.rawValue))'), 'native scanner extracts VIN payload');
assert(vinSource.includes('if(detector){'), 'native detector runs alongside ZXing');
console.log('PASS multi-decoder Android VIN recognition paths');
