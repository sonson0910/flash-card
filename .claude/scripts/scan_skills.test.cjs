#!/usr/bin/env node
/**
 * Regression tests for scan_skills.py catalog generation.
 */

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT_PATH = path.join(__dirname, 'scan_skills.py');
const PYTHON_PATH = path.join(REPO_ROOT, '.claude', 'skills', '.venv', 'bin', 'python3');

const MAIN_HARNESS = String.raw`
from pathlib import Path
import importlib.util
import sys

script = Path(sys.argv[1]).resolve()
spec = importlib.util.spec_from_file_location("scan_skills_under_test", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
expected_base = script.parents[1] / "skills"
captured_bases = []
original_scan = module.scan_skills

def capture_scan(base_path):
    captured_bases.append(base_path)
    return original_scan(base_path)

module.scan_skills = capture_scan
module.write_generated_catalogs = lambda skills, repo_root: (
    repo_root / ".claude" / "scripts" / "skills_data.yaml",
    repo_root / "guide" / "SKILLS.yaml",
    repo_root / "guide" / "SKILLS.md",
)
module.main()
if captured_bases != [expected_base]:
    raise SystemExit(f"Unexpected skill root: {captured_bases!r}")
`;

const WRITER_HARNESS = String.raw`
from pathlib import Path
import importlib.util
import sys

script = Path(sys.argv[1]).resolve()
repo_root = Path(sys.argv[2]).resolve()
spec = importlib.util.spec_from_file_location("scan_skills_under_test", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
target = module.write_skills_registry([{
    "name": "sample-skill",
    "path": ".claude/skills/sample-skill/SKILL.md",
    "description": "Sample skill",
    "category": "development",
    "has_scripts": False,
    "has_references": False,
}], repo_root)
expected = repo_root / ".claude" / "scripts" / "skills_data.yaml"
if target != expected or not expected.exists():
    raise SystemExit(f"Unexpected registry target: {target}")
`;

const ATOMIC_FAILURE_HARNESS = String.raw`
from pathlib import Path
import importlib.util
import sys

script = Path(sys.argv[1]).resolve()
repo_root = Path(sys.argv[2]).resolve()
spec = importlib.util.spec_from_file_location("scan_skills_under_test", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.write_generated_catalogs([{
    "name": "replacement-skill",
    "display_name": "replacement-skill",
    "path": "replacement-skill/SKILL.md",
    "description": "Replacement skill",
    "category": "other",
    "has_scripts": False,
    "has_references": False,
}], repo_root)
`;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
  }
}

console.log('\n📚 scan_skills.py Regression Tests');

test('main scans .claude/skills without writing generated registries', () => {
  assert.ok(fs.existsSync(PYTHON_PATH), `Missing skills Python environment: ${PYTHON_PATH}`);
  const output = execFileSync(PYTHON_PATH, ['-c', MAIN_HARNESS, SCRIPT_PATH], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(output, /Found \d+ skills/);
  assert.match(output, /worktree/);
});

test('registry writer targets the project .claude scripts directory', () => {
  const temporaryRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-skills-writer-'));
  try {
    fs.mkdirSync(path.join(temporaryRepo, '.claude', 'scripts'), { recursive: true });
    execFileSync(PYTHON_PATH, ['-c', WRITER_HARNESS, SCRIPT_PATH, temporaryRepo], {
      cwd: temporaryRepo,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const registry = path.join(temporaryRepo, '.claude', 'scripts', 'skills_data.yaml');
    assert.ok(fs.existsSync(registry), `Missing registry: ${registry}`);
    assert.match(fs.readFileSync(registry, 'utf8'), /sample-skill/);
    assert.ok(!fs.existsSync(path.join(temporaryRepo, 'claude', 'scripts', 'skills_data.yaml')));
  } finally {
    fs.rmSync(temporaryRepo, { recursive: true, force: true });
  }
});

test('catalog generation leaves existing outputs unchanged when a destination cannot be prepared', () => {
  const temporaryRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-skills-atomic-'));
  try {
    const scriptsDirectory = path.join(temporaryRepo, '.claude', 'scripts');
    const registry = path.join(scriptsDirectory, 'skills_data.yaml');
    fs.mkdirSync(scriptsDirectory, { recursive: true });
    fs.writeFileSync(registry, 'original registry\n');
    fs.writeFileSync(path.join(temporaryRepo, 'guide'), 'not a directory\n');

    assert.throws(() => execFileSync(
      PYTHON_PATH,
      ['-c', ATOMIC_FAILURE_HARNESS, SCRIPT_PATH, temporaryRepo],
      {
        cwd: temporaryRepo,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ));
    assert.equal(fs.readFileSync(registry, 'utf8'), 'original registry\n');
  } finally {
    fs.rmSync(temporaryRepo, { recursive: true, force: true });
  }
});

if (failed > 0) {
  console.log(`\n❌ Test Results: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`\n✅ Test Results: ${passed} passed, ${failed} failed`);
