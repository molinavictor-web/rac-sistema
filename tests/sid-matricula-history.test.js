const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'../src/routes/supervision.js'),'utf8');
test('matricula upsert keyed by school and period',()=>{
 assert.match(sql,/ON CONFLICT \(codigo_plantel, periodo_escolar\)/);
 assert.match(sql,/WHERE codigo_plantel = \$1::varchar AND periodo_escolar = \$2::varchar/);
});
