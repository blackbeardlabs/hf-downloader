const expected = process.argv[2];
const label = process.argv[3] || expected;

if (!expected) {
  console.error('Usage: node scripts/guard-platform.js <platform> [label]');
  process.exit(1);
}

if (process.platform !== expected) {
  console.error(`This package must be built on ${label}.`);
  console.error(`Current platform is ${process.platform}. Native better-sqlite3 binaries cannot be safely cross-built here.`);
  console.error('Use the GitHub Actions release workflow or run this script on the target OS.');
  process.exit(1);
}
