import fs from 'node:fs';
import path from 'node:path';

const PROPERTY_REGISTRATION = /@property --tw-[^{]+\{[^}]*\}/g;

/**
 * Tailwind's registrations improve interpolation of animated custom
 * properties, but they are optional at runtime. The declarations in its
 * properties layer remain, so utility defaults and behavior are preserved.
 */
export function stripTailwindPropertyRegistrations(css) {
  return css.replace(PROPERTY_REGISTRATION, '');
}

export function stripDistCssPropertyRegistrations(distDirectory = path.resolve('dist')) {
  const assetsDirectory = path.join(distDirectory, 'assets');
  if (!fs.existsSync(assetsDirectory)) return 0;

  let changedFiles = 0;
  for (const file of fs.readdirSync(assetsDirectory)) {
    if (!file.endsWith('.css')) continue;
    const filePath = path.join(assetsDirectory, file);
    const source = fs.readFileSync(filePath, 'utf8');
    const stripped = stripTailwindPropertyRegistrations(source);
    if (stripped === source) continue;
    fs.writeFileSync(filePath, stripped);
    changedFiles += 1;
  }
  return changedFiles;
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  const changedFiles = stripDistCssPropertyRegistrations();
  console.log(`Removed Tailwind property registrations from ${changedFiles} CSS asset(s).`);
}
