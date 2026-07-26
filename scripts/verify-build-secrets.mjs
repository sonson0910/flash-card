import fs from 'node:fs';
import path from 'node:path';

const distDirectory = path.resolve('dist');
const configuredSecrets = [
  process.env.GEMINI_API_KEY,
  process.env.VITE_PEXELS_API_KEY,
  process.env.VITE_UNSPLASH_API_KEY,
].filter(value => typeof value === 'string' && value.trim().length >= 8);

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
}

console.log(`Verified ${files.length} production files: no configured provider secrets found.`);
