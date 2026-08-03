import { validateProductionEnvironment } from './release-config.mjs';

const errors = validateProductionEnvironment(process.env);
if (errors.length > 0) {
  throw new Error(`Production release configuration is invalid:\n- ${errors.join('\n- ')}`);
}
console.log('Production release configuration is valid: App Check is configured and browser secrets are absent.');
