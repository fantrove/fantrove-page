/**
 * copy-built.js
 * - copies built JS files from build/ (tsc outDir) to target asset paths
 * - preserves expected runtime paths: assets/js/header-modules/..., assets/js/header*.js, assets/js/header-index-worker.js
 *
 * Run after `tsc` (build:ts)
 */
const fs = require('fs-extra');
const path = require('path');

async function main() {
  const buildDir = path.resolve(__dirname, '..', 'build');
  const repoRoot = path.resolve(__dirname, '..');
  const assetsRoot = path.join(repoRoot, 'assets', 'js');
  
  try {
    // Ensure assets/js header-modules target exists
    const targetModulesDir = path.join(assetsRoot, 'header-modules');
    await fs.ensureDir(targetModulesDir);
    
    // Copy all compiled files from build/header-modules -> assets/js/header-modules
    const srcModulesDir = path.join(buildDir, 'header-modules');
    if (await fs.pathExists(srcModulesDir)) {
      await fs.copy(srcModulesDir, targetModulesDir, { overwrite: true, recursive: true });
      console.log(`Copied header-modules -> ${path.relative(repoRoot, targetModulesDir)}`);
    } else {
      console.warn('No built header-modules found at', srcModulesDir);
    }
    
    // Copy runtime files in build root like header.js, header-index-worker.js
    const simpleFiles = ['header.js', 'header-index-worker.js'];
    for (const f of simpleFiles) {
      const src = path.join(buildDir, f);
      if (await fs.pathExists(src)) {
        const dest = path.join(assetsRoot, f);
        await fs.ensureDir(path.dirname(dest));
        await fs.copyFile(src, dest);
        console.log(`Copied ${f} -> ${path.relative(repoRoot, dest)}`);
      } else {
        // also check build/header.js (if compiled under header.ts)
        const alt = path.join(buildDir, 'header', f);
        if (await fs.pathExists(alt)) {
          const dest = path.join(assetsRoot, f);
          await fs.copyFile(alt, dest);
          console.log(`Copied ${f} (alt) -> ${path.relative(repoRoot, dest)}`);
        } else {
          console.warn(`Built file not found: ${src}`);
        }
      }
    }
    
    // Copy service-worker and runtime folder if present
    const srcRuntime = path.join(buildDir, 'header-modules', 'runtime');
    if (await fs.pathExists(srcRuntime)) {
      const destRuntime = path.join(assetsRoot, 'header-modules', 'runtime');
      await fs.copy(srcRuntime, destRuntime, { overwrite: true, recursive: true });
      console.log(`Copied runtime -> ${path.relative(repoRoot, destRuntime)}`);
    }
    
    console.log('Copy step completed.');
  } catch (err) {
    console.error('Error during copy-built:', err);
    process.exit(1);
  }
}

main();