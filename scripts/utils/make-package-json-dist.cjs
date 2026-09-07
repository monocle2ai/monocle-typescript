const pkgJson = require(process.env['PKG_JSON_PATH'] || '../../package.json');

// function processExportMap(m) {
//   for (const key in m) {
//     const value = m[key];
//     if (typeof value === 'string') m[key] = value.replace(/^\.\/dist\//, './');
//     else processExportMap(value);
//   }
// }
// processExportMap(pkgJson.exports);

// for (const key of ['types', 'main', 'module']) {
//   if (typeof pkgJson[key] === 'string') pkgJson[key] = pkgJson[key].replace(/^(\.\/)?dist\//, './');
// }

delete pkgJson.devDependencies;
delete pkgJson.scripts
pkgJson.main = './index.cjs';
// Without an `exports` map, ESM `import "monocle2ai"` falls back to `main`
// (index.cjs) — whose registerModule() is stripped, so the IITM loader never
// registers and ESM instrumentation no-ops. Route ESM consumers to index.mjs.
pkgJson.exports = {
  '.': {
    import: { types: './index.d.ts', default: './index.mjs' },
    require: { types: './index.d.ts', default: './index.cjs' },
  },
  // Preload entry: `--import monocle2ai/register` (or NODE_OPTIONS).
  './register': {
    import: { types: './register.d.ts', default: './register.mjs' },
    require: { types: './register.d.ts', default: './register.cjs' },
  },
  // Next.js config helper.
  './next': {
    import: { types: './next.d.ts', default: './next.mjs' },
    require: { types: './next.d.ts', default: './next.cjs' },
  },
  './package.json': './package.json',
};
// `npx monocle2ai run <file>` — preloads tracing, then runs the target.
pkgJson.bin = { monocle2ai: './bin/cli' };
// delete pkgJson.scripts.prepack;
// delete pkgJson.scripts.prepublishOnly;
// delete pkgJson.scripts.prepare;

console.log(JSON.stringify(pkgJson, null, 2));