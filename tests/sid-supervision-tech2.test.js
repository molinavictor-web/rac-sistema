const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const names = ['login','resumen','estadisticas','alertas','planteles','consolidado','municipales','circuitales','circuitos','directores','mi-plantel'];
for (const name of names) {
  test('Tech 2.0 is enabled on Supervisión '+name, () => {
    const html = read('public/supervision/'+name+'.html');
    assert.match(html, /href="\/css\/sid-supervision-tech\.css"/);
    assert.match(html, /<body[^>]*class="[^"]*sid-tech-supervision/);
  });
}
test('Login preserves the authentication contract', () => {
  const html = read('public/supervision/login.html');
  for (const id of ['formLogin','email','password','btnEntrar','loginError']) {
    assert.ok(html.includes('id="'+id+'"'), 'Missing '+id);
  }
  assert.match(html, /\/js\/supervision-login\.js/);
  const js = read('public/js/supervision-login.js');
  assert.match(js, /\/api\/auth\/login/);
  assert.match(js, /"director"/);
});
test('Theme remains scoped and assets exist', () => {
  const css = read('public/css/sid-supervision-tech.css');
  assert.match(css, /body\.sid-tech-supervision/);
  assert.ok(fs.existsSync(path.join(__dirname,'../public/classroom.svg')));
  const nav = read('public/js/nav.js');
  assert.match(nav, /const sidSupervision = window\.location\.pathname\.startsWith\("\/supervision\/"\)/);
  assert.match(nav, /sidSupervision \?/);
});
