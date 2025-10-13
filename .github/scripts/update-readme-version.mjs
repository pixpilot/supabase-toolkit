#!/usr/bin/env node

/**
 * Updates the version in README.md after a successful package release
 * Usage: node update-readme-version.mjs <package-name>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const filename = fileURLToPath(import.meta.url);
const directoryName = dirname(filename);

const packageName = process.argv[2];

if (!packageName) {
  console.error('Error: Package name is required');
  console.error('Usage: node update-readme-version.mjs <package-name>');
  process.exit(1);
}

const REPO_ROOT = join(directoryName, '..', '..');
const PACKAGE_DIR = join(REPO_ROOT, 'packages', packageName);
const PACKAGE_JSON_PATH = join(PACKAGE_DIR, 'package.json');
const README_PATH = join(PACKAGE_DIR, 'README.md');

try {
  // Read package.json to get the current version
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
  const newVersion = packageJson.version;

  console.log(`📦 Package: ${packageName}`);
  console.log(`🔖 New version: ${newVersion}`);

  // Read README.md
  const readmeContent = readFileSync(README_PATH, 'utf-8');

  // Update the version in the README
  // Pattern: "package-name": "npm:package-name@x.x.x"
  const versionPattern = new RegExp(
    `"${packageName}":\\s*"npm:${packageName}@([^"]+)`,
    'gu',
  );

  // Extract current version from README
  const match = readmeContent.match(versionPattern);

  if (!match) {
    console.log('⚠️  Version pattern not found in README.md - skipping update');
    process.exit(0);
  }

  // Extract the version number from the match
  const currentVersionMatch = match[0].match(/@(?<version>[^"]+)$/u);
  const currentVersion = currentVersionMatch?.groups?.version ?? null;

  // Check if version already matches
  if (currentVersion === newVersion) {
    console.log(`✅ README.md already has version ${newVersion} - no update needed`);
    process.exit(0);
  }

  console.log(`📝 Updating README.md from version ${currentVersion} to ${newVersion}`);

  const replacement = `"${packageName}": "npm:${packageName}@${newVersion}`;
  const updatedContent = readmeContent.replace(versionPattern, replacement);

  // Write updated README
  writeFileSync(README_PATH, updatedContent, 'utf-8');

  console.log('✅ Successfully updated README.md with new version');
  console.log(`   Updated: "${packageName}": "npm:${packageName}@${newVersion}"`);
} catch (error) {
  console.error('❌ Error updating README:', error.message);
  process.exit(1);
}
