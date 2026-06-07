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
  'parseNames',
  'buildIndex',
  'findMatches',
  'summarizeRecipe',
  'summarizeBundle',
  'summarizeInventoryItem',
  'summarizeYield',
  'summarizeMatches',
]);

assert.equal(JSON.stringify(fns.parseNames('["Pineapple Juice","The NuVira Trio"]')), JSON.stringify(['Pineapple Juice', 'The NuVira Trio']));
assert.equal(JSON.stringify(fns.parseNames('Reset Shot,Radiance Shot')), JSON.stringify(['Reset Shot', 'Radiance Shot']));

const recipes = [
  { id: 'recipe_pineapple', product_name: 'Pineapple Juice', product_sku: 'PINE-16', ingredients: [{ ingredient_name: 'Pineapple', quantity_oz: 10, unit: 'oz' }], is_active: true },
  { id: 'recipe_reset', product_name: 'Reset Shot', ingredients: [{ ingredient_name: 'Ginger', quantity_oz: 1, unit: 'oz' }], is_active: true },
];
const recipeIndex = fns.buildIndex(recipes, row => row.product_name);
assert.equal(fns.findMatches(recipeIndex, 'Pineapple Juice').length, 1);
assert.equal(fns.findMatches(recipeIndex, 'pineapples juice').length, 1);

const recipeSummary = fns.summarizeRecipe(recipes[0]);
assert.equal(recipeSummary.id, 'recipe_pineapple');
assert.equal(recipeSummary.name, 'Pineapple Juice');
assert.equal(recipeSummary.ingredient_count, 1);
assert.equal(recipeSummary.field_compatibility_status, 'compatible');
assert.equal(recipeSummary.ingredients[0].ingredient_name, 'Pineapple');

const badRecipe = fns.summarizeRecipe({ id: 'bad_recipe', ingredients: 'not-array' });
assert.equal(badRecipe.field_compatibility_status, 'schema_gap');
assert.ok(badRecipe.incompatibilities.includes('missing_product_name'));
assert.ok(badRecipe.incompatibilities.includes('ingredients_not_array'));

const bundleSummary = fns.summarizeBundle({ id: 'bundle_trio', bundle_name: 'The NuVira Trio', components: [{ product_name: 'Pineapple Juice', quantity: 1 }, { product_name: 'Reset Shot', quantity: 1 }] });
assert.equal(bundleSummary.component_count, 2);
assert.equal(bundleSummary.field_compatibility_status, 'compatible');

const inventorySummary = fns.summarizeInventoryItem({ id: 'inv_pineapple', ingredient: 'Pineapple', unit: 'lbs', stock: 0, reorder_point: 2, category: 'Produce', supplier: 'Produce Supplier' });
assert.equal(inventorySummary.field_compatibility_status, 'compatible');
assert.equal(inventorySummary.stock_is_live_state, true);
assert.equal(inventorySummary.status, 'out_of_stock');

const yieldSummary = fns.summarizeYield({ id: 'yield_pineapple', ingredient_name: 'Pineapple', purchase_unit: 'case', oz_per_purchase_unit: 160 });
assert.equal(yieldSummary.field_compatibility_status, 'compatible');
assert.equal(yieldSummary.oz_per_purchase_unit, 160);

const recipeMatches = fns.summarizeMatches(recipeIndex, ['Pineapple Juice', 'Missing Juice'], fns.summarizeRecipe);
assert.equal(recipeMatches[0].status, 'matched');
assert.equal(recipeMatches[1].status, 'missing');

console.log('G31B Hub production master-data parity tests passed');
