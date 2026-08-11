import { pathToFileURL } from 'node:url';

export function validateNodeRuntime(version) {
  const major = /^(\d+)\./.exec(version)?.[1];
  return major === '22'
    ? []
    : [`Node.js 22.x is required; received ${version}.`];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = validateNodeRuntime(process.versions.node);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  console.log(`Node.js ${process.versions.node} satisfies the required 22.x runtime.`);
}
