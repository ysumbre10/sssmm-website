// Run: node test-auth.js
// Runs donation-api.gs against stubbed Apps Script services and asserts the
// authorization matrix. Catches an auth regression without a deploy.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

const HEADERS = ['Timestamp','तारीख :','पावती क्रमांक :','नाव :','रक्कम :','मोबाईल क्रमांक :',
                 'स्वीकर्त्याचे नाव :','भरणा स्थिती :','देणगी देण्याची तारीख :','नोंद :'];
const ROWS = [HEADERS,
  ['1/1/2026','8/16/2026','52','Asha Patil','501','9876543210','यज्ञेश सुंबरे','बाकी','9/10/2026','note A'],
  ['1/2/2026','8/17/2026','53','Bhau Shinde','1001','9123456780','गौरव शेटे','जमा','9/11/2026','note B']];

let cache = {};
const sandbox = {
  Logger: { log: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => k === 'ACCESS_CODE' ? 'correct-horse-battery' : null }) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k], put: (k, v) => { cache[k] = v; } }) },
  ContentService: { MimeType: { JSON: 'json' },
    createTextOutput: s => ({ setMimeType: () => ({ _json: JSON.parse(s) }) }) },
  SpreadsheetApp: { openById: () => ({ getSheets: () => [{
      getSheetId: () => 1341717664, getName: () => 'Form Responses 1',
      getFormUrl: () => null,
      getDataRange: () => ({ getDisplayValues: () => ROWS, getValues: () => ROWS }) }] }) },
  FormApp: { openByUrl: () => ({ getResponses: () => [] }) },
};
vm.createContext(sandbox);
new vm.Script(fs.readFileSync('donation-api.gs','utf8')).runInContext(sandbox);
const call = p => sandbox.doGet({ parameter: p })._json;

let pass = 0;
const check = (name, fn) => { fn(); console.log('  ok  ' + name); pass++; };

check('no code + exact receipt -> public record only', () => {
  const r = call({ receipt: '52' });
  assert(Array.isArray(r) && r.length === 1, 'expected one record');
  assert.strictEqual(r[0].Name, 'Asha Patil');
  assert.strictEqual(r[0].Mobile, undefined, 'mobile must NOT be public');
  assert.strictEqual(r[0].EditLink, undefined, 'edit link must NOT be public');
  assert.strictEqual(r[0].Remark, undefined, 'remark must NOT be public');
});
check('no code + name search -> unauthorized', () =>
  assert.strictEqual(call({ name: 'Asha' }).error, 'unauthorized'));
check('no code + mobile search -> unauthorized', () =>
  assert.strictEqual(call({ mobile: '9' }).error, 'unauthorized'));
check('no code + single digit mobile (the leak I found) -> unauthorized', () =>
  assert.strictEqual(call({ mobile: '9876543210' }).error, 'unauthorized'));
check('no code + headers debug -> unauthorized', () =>
  assert.strictEqual(call({ headers: '1' }).error, 'unauthorized'));
check('no code + no args -> unauthorized', () =>
  assert.strictEqual(call({}).error, 'unauthorized'));
check('wrong code -> unauthorized', () =>
  assert.strictEqual(call({ code: 'nope', validate: '1' }).error, 'unauthorized'));
check('right code + validate -> ok', () =>
  assert.strictEqual(call({ code: 'correct-horse-battery', validate: '1' }).ok, true));
check('right code + name search -> full record incl. mobile', () => {
  const r = call({ code: 'correct-horse-battery', name: 'asha' });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].Mobile, '9876543210');
  assert.strictEqual(r[0].Remark, 'note A');
  assert.strictEqual(r[0].DonationDate, '9/10/2026');
});
check('right code + mobile search matches partial', () => {
  const r = call({ code: 'correct-horse-battery', mobile: '912345' });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].Name, 'Bhau Shinde');
});
check('brute force throttles after 30 wrong tries', () => {
  cache = {};
  for (let i = 0; i < 30; i++) call({ code: 'x' + i, validate: '1' });
  assert(/Too many/.test(call({ code: 'y', validate: '1' }).error), 'should be throttled');
  // and a correct code is also refused while throttled — deliberate, documented trade-off
  assert(/Too many/.test(call({ code: 'correct-horse-battery', validate: '1' }).error));
});
check('unset ACCESS_CODE fails closed', () => {
  cache = {};
  const saved = sandbox.PropertiesService.getScriptProperties;
  sandbox.PropertiesService.getScriptProperties = () => ({ getProperty: () => null });
  assert(/not configured/.test(call({ receipt: '52' }).error), 'must refuse when unconfigured');
  sandbox.PropertiesService.getScriptProperties = saved;
});
console.log('\n' + pass + '/' + pass + ' auth checks passed');
