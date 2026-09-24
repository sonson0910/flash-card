import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';

const root = process.cwd();
const script = path.join(root, 'scripts/prepare-staging-target.mjs');

describe('staging target preparation', () => {
  it('writes a hook-free config bound to the staging database', () => {
    execFileSync(process.execPath, [script], { cwd: root, stdio: 'pipe' });
    const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.staging.json'), 'utf8'));
    assert.equal(config.firestore[0].database, 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
    assert.equal(config.firestore[0].rules, 'firestore.rules');
    assert.equal(config.firestore[0].indexes, 'firestore.indexes.json');
    assert.equal(config.functions.source, 'functions');
    assert.equal(config.hosting.public, 'dist');
    assert.equal(fs.readFileSync(path.join(root, 'functions/.env.sonflash-staging-20260906'), 'utf8'), 'ENFORCE_APP_CHECK=true\n');
    assert.equal(config.functions.predeploy, undefined);
    assert.equal(config.hosting.predeploy, undefined);
    const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
    assert.match(scripts['staging:deploy:functions'], /staging:deploy:functions:existing.*staging:deploy:functions:pilot/);
    assert.doesNotMatch(scripts['staging:deploy:functions:existing'], /--only functions --/);
    assert.doesNotMatch(scripts['staging:deploy:functions:pilot'], /--only functions --/);
  });

  it('rejects a production project override before writing a deploy config', () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, FIREBASE_PROJECT_ID: 'encoded-hangout-433912-h2' },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not match the sealed staging project/);
  });
});
