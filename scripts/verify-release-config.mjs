import fs from 'node:fs';
import { validateFirebaseAppCheckTargets, validateProductionEnvironment } from './release-config.mjs';

const firebaseConfig = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
const errors = [
  ...validateProductionEnvironment(process.env),
  ...validateFirebaseAppCheckTargets(firebaseConfig),
];
if (errors.length > 0) {
  throw new Error(`Production release configuration is invalid:\n- ${errors.join('\n- ')}`);
}
console.log('Production release configuration is valid: App Check is configured and browser secrets are absent.');
