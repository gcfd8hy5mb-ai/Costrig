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
