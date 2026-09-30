# Software Bill of Materials (SBOM)

Generated from `package-lock.json` for the installed dependency tree on
Linux/x64 (platform-specific optional binaries for other OSes/architectures
that npm did not install here are excluded). Regenerate by re-running the
extraction script described at the bottom of this file after any
`npm install`/`package.json` change.

## Summary

- **Runtime dependencies** (shipped in the browser bundle): 3 direct
  (`react`, `react-dom`, `reactflow`), 59 total including transitive
  (React Flow pulls in several `d3-*` modules and `zustand` for its internal
  state/zoom/drag handling). `@types/*` entries below are TypeScript type
  declarations only — no runtime code is shipped for them.
- **Development-only dependencies** (build/lint tooling, never shipped):
  167 total (Vite, esbuild, Rollup, TypeScript, ESLint and their
  transitive dependencies).
- **Licenses observed:** MIT, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause,
  BlueOak-1.0.0, Python-2.0, CC-BY-4.0. All are permissive open-source
  licenses; none are copyleft (e.g. no GPL/AGPL).

## Direct dependencies

| Package | Version | License | Role |
|---|---|---|---|
| react | 18.3.1 | MIT | Runtime — UI framework |
| react-dom | 18.3.1 | MIT | Runtime — DOM renderer |
| reactflow | 11.11.4 | MIT | Runtime — node/edge canvas |
| vite | 5.4.21 | MIT | Dev — build tool / dev server |
| typescript | 5.6.3 | Apache-2.0 | Dev — type checker/compiler |
| eslint | 9.39.5 | MIT | Dev — linter |
| @vitejs/plugin-react | 4.7.0 | MIT | Dev — Vite React plugin |
| esbuild | 0.21.5 (pinned) | MIT | Dev — bundler used internally by Vite |

## Runtime dependencies (full, incl. transitive)

Everything below is part of, or a transitive dependency of, `reactflow` —
this is what actually ships to the browser.

| Package | Version | License |
|---|---|---|
| @reactflow/background | 11.3.14 | MIT |
| @reactflow/controls | 11.2.14 | MIT |
| @reactflow/core | 11.11.4 | MIT |
| @reactflow/minimap | 11.7.14 | MIT |
| @reactflow/node-resizer | 2.2.14 | MIT |
| @reactflow/node-toolbar | 1.3.14 | MIT |
| @types/d3 | 7.4.3 | MIT |
| @types/d3-array | 3.2.2 | MIT |
| @types/d3-axis | 3.0.6 | MIT |
| @types/d3-brush | 3.0.6 | MIT |
| @types/d3-chord | 3.0.6 | MIT |
| @types/d3-color | 3.1.3 | MIT |
| @types/d3-contour | 3.0.6 | MIT |
| @types/d3-delaunay | 6.0.4 | MIT |
| @types/d3-dispatch | 3.0.7 | MIT |
| @types/d3-drag | 3.0.7 | MIT |
| @types/d3-dsv | 3.0.7 | MIT |
| @types/d3-ease | 3.0.2 | MIT |
| @types/d3-fetch | 3.0.7 | MIT |
| @types/d3-force | 3.0.10 | MIT |
| @types/d3-format | 3.0.4 | MIT |
| @types/d3-geo | 3.1.1 | MIT |
| @types/d3-hierarchy | 3.1.7 | MIT |
| @types/d3-interpolate | 3.0.4 | MIT |
| @types/d3-path | 3.1.1 | MIT |
| @types/d3-polygon | 3.0.2 | MIT |
| @types/d3-quadtree | 3.0.6 | MIT |
| @types/d3-random | 3.0.4 | MIT |
| @types/d3-scale | 4.0.9 | MIT |
| @types/d3-scale-chromatic | 3.1.0 | MIT |
| @types/d3-selection | 3.0.11 | MIT |
| @types/d3-shape | 3.2.0 | MIT |
| @types/d3-time | 3.0.4 | MIT |
| @types/d3-time-format | 4.0.3 | MIT |
| @types/d3-timer | 3.0.2 | MIT |
| @types/d3-transition | 3.0.9 | MIT |
| @types/d3-zoom | 3.0.8 | MIT |
| @types/geojson | 7946.0.16 | MIT |
| @types/prop-types | 15.7.15 | MIT |
| @types/react | 18.3.31 | MIT |
| classcat | 5.0.5 | MIT |
| csstype | 3.2.3 | MIT |
| d3-color | 3.1.0 | ISC |
| d3-dispatch | 3.0.1 | ISC |
| d3-drag | 3.0.0 | ISC |
| d3-ease | 3.0.1 | BSD-3-Clause |
| d3-interpolate | 3.0.1 | ISC |
| d3-selection | 3.0.0 | ISC |
| d3-timer | 3.0.1 | ISC |
| d3-transition | 3.0.1 | ISC |
| d3-zoom | 3.0.0 | ISC |
| js-tokens | 4.0.0 | MIT |
| loose-envify | 1.4.0 | MIT |
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| reactflow | 11.11.4 | MIT |
| scheduler | 0.23.2 | MIT |
| use-sync-external-store | 1.7.0 | MIT |
| zustand | 4.5.7 | MIT |

## Development dependencies (full, incl. transitive)

Build, type-check, and lint tooling only — never shipped to the browser.

| Package | Version | License |
|---|---|---|
| @babel/code-frame | 7.29.7 | MIT |
| @babel/compat-data | 7.29.7 | MIT |
| @babel/core | 7.29.7 | MIT |
| @babel/generator | 7.29.8 | MIT |
| @babel/helper-compilation-targets | 7.29.7 | MIT |
| @babel/helper-globals | 7.29.7 | MIT |
| @babel/helper-module-imports | 7.29.7 | MIT |
| @babel/helper-module-transforms | 7.29.7 | MIT |
| @babel/helper-plugin-utils | 7.29.7 | MIT |
| @babel/helper-string-parser | 7.29.7 | MIT |
| @babel/helper-validator-identifier | 7.29.7 | MIT |
| @babel/helper-validator-option | 7.29.7 | MIT |
| @babel/helpers | 7.29.7 | MIT |
| @babel/parser | 7.29.8 | MIT |
| @babel/plugin-transform-react-jsx-self | 7.29.7 | MIT |
| @babel/plugin-transform-react-jsx-source | 7.29.7 | MIT |
| @babel/template | 7.29.7 | MIT |
| @babel/traverse | 7.29.8 | MIT |
| @babel/types | 7.29.8 | MIT |
| @esbuild/linux-x64 | 0.21.5 | MIT |
| @eslint-community/eslint-utils | 4.10.1 | MIT |
| @eslint-community/regexpp | 4.12.2 | MIT |
| @eslint/config-array | 0.21.2 | Apache-2.0 |
| @eslint/config-helpers | 0.4.2 | Apache-2.0 |
| @eslint/core | 0.17.0 | Apache-2.0 |
| @eslint/eslintrc | 3.3.7 | MIT |
| @eslint/js | 9.39.5 | MIT |
| @eslint/object-schema | 2.1.7 | Apache-2.0 |
| @eslint/plugin-kit | 0.4.1 | Apache-2.0 |
| @humanfs/core | 0.19.2 | Apache-2.0 |
| @humanfs/node | 0.16.8 | Apache-2.0 |
| @humanfs/types | 0.15.0 | Apache-2.0 |
| @humanwhocodes/module-importer | 1.0.1 | Apache-2.0 |
| @humanwhocodes/retry | 0.4.3 | Apache-2.0 |
| @jridgewell/gen-mapping | 0.3.13 | MIT |
| @jridgewell/remapping | 2.3.5 | MIT |
| @jridgewell/resolve-uri | 3.1.2 | MIT |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT |
| @jridgewell/trace-mapping | 0.3.31 | MIT |
| @rolldown/pluginutils | 1.0.0-beta.27 | MIT |
| @rollup/rollup-linux-x64-gnu | 4.63.1 | MIT |
| @rollup/rollup-linux-x64-musl | 4.63.1 | MIT |
| @types/babel__core | 7.20.5 | MIT |
| @types/babel__generator | 7.27.0 | MIT |
| @types/babel__template | 7.4.4 | MIT |
| @types/babel__traverse | 7.28.0 | MIT |
| @types/estree | 1.0.9 | MIT |
| @types/json-schema | 7.0.15 | MIT |
| @types/react-dom | 18.3.7 | MIT |
| @typescript-eslint/eslint-plugin | 8.70.0 | MIT |
| @typescript-eslint/parser | 8.70.0 | MIT |
| @typescript-eslint/project-service | 8.70.0 | MIT |
| @typescript-eslint/scope-manager | 8.70.0 | MIT |
| @typescript-eslint/tsconfig-utils | 8.70.0 | MIT |
| @typescript-eslint/type-utils | 8.70.0 | MIT |
| @typescript-eslint/types | 8.70.0 | MIT |
| @typescript-eslint/typescript-estree | 8.70.0 | MIT |
| @typescript-eslint/utils | 8.70.0 | MIT |
| @typescript-eslint/visitor-keys | 8.70.0 | MIT |
| @vitejs/plugin-react | 4.7.0 | MIT |
| acorn | 8.18.0 | MIT |
| acorn-jsx | 5.3.2 | MIT |
| ajv | 6.15.0 | MIT |
| ansi-styles | 4.3.0 | MIT |
| argparse | 2.0.1 | Python-2.0 |
| balanced-match | 4.0.4 | MIT |
| balanced-match | 1.0.2 | MIT |
| baseline-browser-mapping | 2.11.22 | Apache-2.0 |
| brace-expansion | 5.0.9 | MIT |
| brace-expansion | 1.1.18 | MIT |
| browserslist | 4.28.9 | MIT |
| callsites | 3.1.0 | MIT |
| caniuse-lite | 1.0.30001810 | CC-BY-4.0 |
| chalk | 4.1.2 | MIT |
| color-convert | 2.0.1 | MIT |
| color-name | 1.1.4 | MIT |
| concat-map | 0.0.1 | MIT |
| convert-source-map | 2.0.0 | MIT |
| cross-spawn | 7.0.6 | MIT |
| debug | 4.4.3 | MIT |
| deep-is | 0.1.4 | MIT |
| electron-to-chromium | 1.5.426 | ISC |
| esbuild | 0.21.5 | MIT |
| escalade | 3.2.0 | MIT |
| escape-string-regexp | 4.0.0 | MIT |
| eslint | 9.39.5 | MIT |
| eslint-plugin-react-hooks | 5.2.0 | MIT |
| eslint-plugin-react-refresh | 0.4.26 | MIT |
| eslint-scope | 8.4.0 | BSD-2-Clause |
| eslint-visitor-keys | 3.4.3 | Apache-2.0 |
| eslint-visitor-keys | 5.0.1 | Apache-2.0 |
| eslint-visitor-keys | 4.2.1 | Apache-2.0 |
| espree | 10.4.0 | BSD-2-Clause |
| esquery | 1.7.0 | BSD-3-Clause |
| esrecurse | 4.3.0 | BSD-2-Clause |
| estraverse | 5.3.0 | BSD-2-Clause |
| esutils | 2.0.3 | BSD-2-Clause |
| fast-deep-equal | 3.1.3 | MIT |
| fast-json-stable-stringify | 2.1.0 | MIT |
| fast-levenshtein | 2.0.6 | MIT |
| fdir | 6.5.0 | MIT |
| file-entry-cache | 8.0.0 | MIT |
| find-up | 5.0.0 | MIT |
| flat-cache | 4.0.1 | MIT |
| flatted | 3.4.4 | ISC |
| gensync | 1.0.0-beta.2 | MIT |
| glob-parent | 6.0.2 | ISC |
| globals | 14.0.0 | MIT |
| globals | 15.15.0 | MIT |
| has-flag | 4.0.0 | MIT |
| ignore | 7.0.9 | MIT |
| ignore | 5.3.2 | MIT |
| import-fresh | 3.3.1 | MIT |
| imurmurhash | 0.1.4 | MIT |
| is-extglob | 2.1.1 | MIT |
| is-glob | 4.0.3 | MIT |
| isexe | 2.0.0 | ISC |
| js-yaml | 4.3.2 | MIT |
| jsesc | 3.1.0 | MIT |
| json-buffer | 3.0.1 | MIT |
| json-schema-traverse | 0.4.1 | MIT |
| json-stable-stringify-without-jsonify | 1.0.1 | MIT |
| json5 | 2.2.3 | MIT |
| keyv | 4.5.4 | MIT |
| levn | 0.4.1 | MIT |
| locate-path | 6.0.0 | MIT |
| lodash.merge | 4.6.2 | MIT |
| lru-cache | 5.1.1 | ISC |
| minimatch | 10.2.6 | BlueOak-1.0.0 |
| minimatch | 3.1.5 | ISC |
| ms | 2.1.3 | MIT |
| nanoid | 3.3.19 | MIT |
| natural-compare | 1.4.0 | MIT |
| node-releases | 2.0.55 | MIT |
| optionator | 0.9.4 | MIT |
| p-limit | 3.1.0 | MIT |
| p-locate | 5.0.0 | MIT |
| parent-module | 1.0.1 | MIT |
| path-exists | 4.0.0 | MIT |
| path-key | 3.1.1 | MIT |
| picocolors | 1.1.1 | ISC |
| picomatch | 4.0.7 | MIT |
| postcss | 8.5.28 | MIT |
| prelude-ls | 1.2.1 | MIT |
| punycode | 2.3.1 | MIT |
| react-refresh | 0.17.0 | MIT |
| resolve-from | 4.0.0 | MIT |
| rollup | 4.63.1 | MIT |
| semver | 7.8.5 | ISC |
| semver | 6.3.1 | ISC |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| source-map-js | 1.2.1 | BSD-3-Clause |
| strip-json-comments | 3.1.1 | MIT |
| supports-color | 7.2.0 | MIT |
| tinyglobby | 0.2.17 | MIT |
| ts-api-utils | 2.5.0 | MIT |
| type-check | 0.4.0 | MIT |
| typescript | 5.6.3 | Apache-2.0 |
| typescript-eslint | 8.70.0 | MIT |
| update-browserslist-db | 1.3.3 | MIT |
| uri-js | 4.4.1 | BSD-2-Clause |
| vite | 5.4.21 | MIT |
| which | 2.0.2 | ISC |
| word-wrap | 1.2.5 | MIT |
| yallist | 3.1.1 | ISC |
| yocto-queue | 0.1.0 | MIT |

## How this was generated

```
node -e "
const fs = require('fs');
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
// walk lock.packages, read each entry's license field (falling back to its
// node_modules/<name>/package.json license field), keep only packages
// actually present on disk, split runtime vs dev by the lockfile's dev flag
"
```

Re-run after any dependency change and diff against this file to catch new
or relicensed packages before merging.
