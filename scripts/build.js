#!/usr/bin/env node
/**
 * Cross-platform build script
 * Transpiles TypeScript via esbuild and adds shebang to the output file
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '../build');
const INDEX_FILE = path.join(BUILD_DIR, 'index.js');
const SHEBANG = '#!/usr/bin/env node\n';

function findSourceFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__') {
      results.push(...findSourceFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      results.push(full);
    }
  }
  return results;
}

console.log('🔨 Building project...\n');

try {
  // Step 1: Transpile TypeScript with esbuild (fast, low memory)
  console.log('📦 Transpiling TypeScript...');
  const srcDir = path.join(__dirname, '..', 'src');
  const entryPoints = findSourceFiles(srcDir);
  const esbuild = require('esbuild');
  esbuild.buildSync({
    entryPoints,
    outdir: BUILD_DIR,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
  });
  console.log('✅ TypeScript transpilation successful\n');

  // Step 2: Add shebang to index.js
  console.log('🔧 Adding shebang to index.js...');
  if (fs.existsSync(INDEX_FILE)) {
    const content = fs.readFileSync(INDEX_FILE, 'utf8');

    // Only add shebang if it doesn't already exist
    if (!content.startsWith('#!')) {
      fs.writeFileSync(INDEX_FILE, SHEBANG + content, 'utf8');
      console.log('✅ Shebang added successfully\n');
    } else {
      console.log('ℹ️  Shebang already exists\n');
    }

    // Step 3: Make file executable (Unix-like systems only)
    try {
      fs.chmodSync(INDEX_FILE, '755');
      console.log('✅ File permissions set (Unix/Linux/macOS)\n');
    } catch (error) {
      // chmod fails on Windows, which is expected and fine
      console.log('ℹ️  Skipping chmod (Windows environment)\n');
    }
  } else {
    throw new Error(`Build file not found: ${INDEX_FILE}`);
  }

  console.log('🎉 Build completed successfully!\n');
  process.exit(0);
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}
