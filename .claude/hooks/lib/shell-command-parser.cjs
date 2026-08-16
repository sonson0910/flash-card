function shellSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  let escaped = false;
  let substitutionDepth = 0;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '$' && next === '(') {
      substitutionDepth += 1;
      current += '$(';
      index += 1;
      continue;
    }
    if (char === ')' && substitutionDepth > 0) {
      substitutionDepth -= 1;
      current += char;
      continue;
    }
    if (substitutionDepth === 0 && char === '#' && !current.trim()) {
      while (index < command.length && command[index] !== '\n') index += 1;
    }
    const separator = char === ';' || char === '\n' || char === '|'
      || (char === '&' && next === '&');
    if (substitutionDepth === 0 && separator) {
      if (current.trim()) segments.push(current.trim());
      current = '';
      if ((char === '|' || char === '&') && next === char) index += 1;
      continue;
    }
    current += char;
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

function shellWords(segment) {
  const words = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (const char of segment) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) words.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) words.push(current);
  return words.slice(0, 512);
}

function dollarSubstitution(command, start) {
  let depth = 1;
  let quote = null;
  let escaped = false;
  for (let index = start + 2; index < command.length; index += 1) {
    const char = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')' && --depth === 0) {
      return { content: command.slice(start + 2, index), end: index };
    }
  }
  return null;
}

function backtickSubstitution(command, start) {
  let escaped = false;
  for (let index = start + 1; index < command.length; index += 1) {
    const char = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '`') return { content: command.slice(start + 1, index), end: index };
  }
  return null;
}

function nestedCommands(command) {
  const nested = [];
  let quote = null;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (char === "'") {
      if (!quote) quote = "'";
      else if (quote === "'") quote = null;
      continue;
    }
    if (char === '"') {
      if (!quote) quote = '"';
      else if (quote === '"') quote = null;
      continue;
    }
    if (quote === "'") continue;
    const parenthesized = (char === '$' || (!quote && ['<', '>'].includes(char)))
      && command[index + 1] === '(';
    const match = parenthesized
      ? dollarSubstitution(command, index)
      : char === '`' ? backtickSubstitution(command, index) : null;
    if (match) {
      nested.push(match.content);
      index = match.end;
    }
  }
  return nested;
}

module.exports = { nestedCommands, shellSegments, shellWords };
