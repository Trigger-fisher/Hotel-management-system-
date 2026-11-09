// pallav:css: writes public/pallav/pallav-base.css and pallav-last.css, the base and the last Pallav sheets concatenated in their order (the lists are
// src/dashboards/pallav/assets.ts BASE_SOURCES and LAST_SOURCES: the sheet text is the same, two requests instead of twenty-one). Plain Node, no library.
// Each part is preceded by one comment line naming its source file. A sheet in a sub-folder (vendor/) has its relative url(...) references pointed into that
// folder, since the bundle sits one level up; a url the script does not understand stops the build rather than ship a broken icon or picture.
// tests/pallavBundle.test.ts builds the same two bundles in memory and fails when the committed files differ.   Usage: npm run pallav:css
import { readFileSync, writeFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALLAV_BUNDLES } from '../src/dashboards/pallav/assets.ts';

export const PALLAV_DIR = join(import.meta.dirname, '..', 'public', 'pallav');

// url(...) in double quotes, in single quotes, or bare (then no quote, bracket or space inside)
const URL_REF = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'"()\s]+))\s*\)/g;
const ANY_URL = /url\(/g;
/** A reference the browser resolves against the sheet's own address: not data:, not a scheme, not the site root, not a fragment. */
const relative = (ref) => !/^(?:data:|[a-z][a-z0-9+.-]*:|\/|#)/i.test(ref.trim());

/** Points every relative url(...) of a sheet that lives in `folder` (e.g. "vendor/") into that folder. Throws when a url( is not understood. */
export function rewriteUrls(css, folder) {
  let seen = 0;
  const out = css.replace(URL_REF, (whole, dq, sq, bare) => {
    seen += 1;
    const ref = dq ?? sq ?? bare;
    const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : '';
    return relative(ref) ? `url(${quote}${folder}${ref.trim()}${quote})` : whole;
  });
  const all = (css.match(ANY_URL) ?? []).length;
  if (all !== seen) throw new Error(`${all - seen} url( reference(s) in a ${folder} sheet could not be read: the bundle would break them`);
  return out;
}

/** The bundle text for `names` (paths under public/pallav, in order); `read` gives a sheet's text. Line endings are LF whatever the checkout's are. */
export function bundle(names, read) {
  let charset = '';
  const parts = names.map((name) => {
    let css = read(name).replace(/^﻿/, '').replace(/\r\n/g, '\n');
    // @charset counts only at the very start of a sheet: one, hoisted to the top of the bundle
    css = css.replace(/^@charset\s+"[^"]*";/i, (m) => {
      charset = m;
      return '';
    });
    const folder = posix.dirname(name);
    if (folder !== '.') css = rewriteUrls(css, `${folder}/`);
    return `/* ${name} */\n${css}${css.endsWith('\n') ? '' : '\n'}`;
  });
  return `${charset ? `${charset}\n` : ''}${parts.join('')}`;
}

const readSheet = (name) => readFileSync(join(PALLAV_DIR, name), 'utf8');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [out, sources] of Object.entries(PALLAV_BUNDLES)) {
    const text = bundle(sources, readSheet);
    writeFileSync(join(PALLAV_DIR, out), text);
    console.log(`${out}: ${sources.length} sheets, ${text.length} characters`);
  }
}
