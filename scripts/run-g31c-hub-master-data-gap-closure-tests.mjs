#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function loadFunctions(relativePath, exportNames, env = {}) {
  const filePath = path.join(repoRoot, relativePath);
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  const serveIndex = source.indexOf('Deno.serve');
  if (serveIndex >= 0) source = source.slice(0, serveIndex);
  source += `\nglobalThis.__exports = { ${exportNames.join(', ')} };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response,
    Deno: { env: { get: key => env[key] || '' } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return context.globalThis.__exports;
}

const fns = loadFunctions('base44/functions/getProductionMasterDataParityForCustomerApp/entry.ts', [
  'normalizeKey',
  'aliasKeys',
  'candidateScore',
  'summarizeAliasCandidates',
  'summarizeBundle',
  'summarizeProduct',
  'summarizeYield',
  'summarizeInventoryItem',
]);

assert.equal(fns.normalizeKey('The NuVira Trio'), 'the nuvira trio');
assert.ok(fns.aliasKeys('The NuVira Trio').includes('nuvira trio'));
assert.ok(fns.aliasKeys('Black Salt').includes('kala namak'));
assert.ok(fns.aliasKeys('Beetroot').includes('beet'));
assert.ok(fns.candidateScore('The NuVira Trio', 'NuVira Trio') >= 0.88);
assert.ok(fns.candidateScore('Black Salt', 'Kala Namak') >= 0.88);
assert.ok(fns.candidateScore('Beetroot', 'Beet') >= 0.88);

const hubBundles = [
  { id: 'bundle_alias_trio', bundle_name: 'NuVira Trio', components: [{ product_name: 'Pineapple Juice', quantity: 1 }] },
];
const bundleAlias = fns.summarizeAliasCandidates(
  hubBundles,
  ['The NuVira Trio'],
  row => row.bundle_name,
  fns.summarizeBundle,
  'bundle',
  'bundle',
)[0];
assert.equal(bundleAlias.status, 'single_candidate');
assert.equal(bundleAlias.candidates[0].candidate.id, 'bundle_alias_trio');
assert.equal(bundleAlias.candidates[0].candidate.component_count, 1);

const hubProducts = [
  { id: 'product_trio', name: 'NuVira Trio', category: 'bundle', price: 18 },
];
const productAlias = fns.summarizeAliasCandidates(
  hubProducts,
  ['The NuVira Trio'],
  row => row.name || row.title,
  fns.summarizeProduct,
  'bundle',
  'product',
)[0];
assert.equal(productAlias.status, 'single_candidate');
assert.equal(productAlias.candidates[0].candidate_type, undefined);
assert.equal(productAlias.candidates[0].candidate.id, 'product_trio');
assert.equal(productAlias.candidates[0].candidate.field_compatibility_status, 'context_only');

const yields = [
  { id: 'yield_kala_namak', ingredient_name: 'Kala Namak', purchase_unit: 'bag', oz_per_purchase_unit: 16 },
  { id: 'yield_beet', ingredient_name: 'Beet', purchase_unit: 'case', oz_per_purchase_unit: 160 },
];
const yieldAliases = fns.summarizeAliasCandidates(
  yields,
  ['Black Salt', 'Beetroot'],
  row => row.ingredient_name,
  fns.summarizeYield,
  'yield',
  'yield',
);
assert.equal(yieldAliases[0].status, 'single_candidate');
assert.equal(yieldAliases[0].candidates[0].candidate.id, 'yield_kala_namak');
assert.equal(yieldAliases[1].status, 'single_candidate');
assert.equal(yieldAliases[1].candidates[0].candidate.id, 'yield_beet');

const inventoryAliases = fns.summarizeAliasCandidates(
  [{ id: 'inv_salt', ingredient: 'Salt', unit: 'lbs', stock: 0, reorder_point: 1 }],
  ['Black Salt'],
  row => row.ingredient,
  fns.summarizeInventoryItem,
  'inventory',
  'inventory',
)[0];
assert.equal(inventoryAliases.status, 'single_candidate');
assert.equal(inventoryAliases.candidates[0].candidate.stock_is_live_state, true);

const missingAlias = fns.summarizeAliasCandidates(
  [],
  ['The NuVira Trio'],
  row => row.bundle_name,
  fns.summarizeBundle,
  'bundle',
  'bundle',
)[0];
assert.equal(missingAlias.status, 'none');
assert.equal(missingAlias.count, 0);

console.log('G31C Hub master-data gap closure tests passed');
