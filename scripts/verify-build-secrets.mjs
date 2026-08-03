import fs from 'node:fs';
import path from 'node:path';

const distDirectory = path.resolve('dist');
const configuredSecrets = [
  process.env.GEMINI_API_KEY,
  process.env.VITE_PEXELS_API_KEY,
  process.env.VITE_UNSPLASH_API_KEY,
].filter(value => typeof value === 'string' && value.trim().length >= 8);

const PRIVATE_CREDENTIAL_PATTERNS = [
  { label: 'OpenAI API key', expression: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g },
  { label: 'GitHub token', expression: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { label: 'AWS access key', expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { label: 'Google API key', expression: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: 'Stripe secret key', expression: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{20,}\b/g },
  {
    label: 'private key',
    expression: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
];

const publicFirebaseWebApiKeys = new Set();
const firebaseConfigPath = path.resolve('firebase-applet-config.json');
if (fs.existsSync(firebaseConfigPath)) {
  const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
  if (typeof firebaseConfig.apiKey === 'string' && firebaseConfig.apiKey.length > 0) {
    publicFirebaseWebApiKeys.add(firebaseConfig.apiKey);
  }
}

const files = [];
const visit = directory => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(absolutePath);
    else files.push(absolutePath);
  }
};

if (!fs.existsSync(distDirectory)) {
  throw new Error('dist/ does not exist. Run the production build first.');
}

visit(distDirectory);
for (const file of files) {
  const content = fs.readFileSync(file);
  for (const secret of configuredSecrets) {
    if (content.includes(Buffer.from(secret))) {
      throw new Error(`Production artifact contains a configured provider secret: ${path.relative(distDirectory, file)}`);
    }
  }
  const text = content.toString('utf8');
  for (const pattern of PRIVATE_CREDENTIAL_PATTERNS) {
    for (const match of text.matchAll(pattern.expression)) {
      const candidate = match[0];
      if (pattern.label === 'Google API key' && publicFirebaseWebApiKeys.has(candidate)) continue;
      throw new Error(
        `Production artifact contains a possible ${pattern.label}: ${path.relative(distDirectory, file)}`,
      );
    }
  }
}

console.log(
  `Verified ${files.length} production files: no provider secrets or private credential patterns found.`,
);
