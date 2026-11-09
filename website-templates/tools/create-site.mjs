// Copies one template into a hotel's own site folder: templates/<template>  ->  sites/<hotel>/  (the "Create hotel site" job runs this; HMS asks for it when a hotel picks a design).
// Usage (from anywhere):  node website-templates/tools/create-site.mjs --hotel <slug> --template <template-folder> [--root <website-templates folder>]
// The old folder of that hotel is replaced (its history stays in Git). Both names are checked against a strict pattern and the result must stay inside sites/, so a hotel
// slug or template name can never reach another folder. Prints one line of JSON on success; exits 1 with a plain sentence on stderr otherwise.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOTEL = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TEMPLATE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])));
const hotel = args.hotel ?? '';
const template = args.template ?? '';
const root = resolve(args.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'));

if (!HOTEL.test(hotel) || hotel.length > 63) fail('The hotel name must be a slug: lower-case letters, digits and single dashes, at most 63 characters.');
if (!TEMPLATE.test(template)) fail('The template name must be a folder name like template-3.');

const from = join(root, 'templates', template);
const sites = join(root, 'sites');
const to = join(sites, hotel);
const inside = (parent, child) => relative(parent, child) !== '' && !relative(parent, child).startsWith('..') && !relative(parent, child).split(sep).includes('..');
if (!inside(join(root, 'templates'), from) || !inside(sites, to)) fail('That name points outside the website folders.');
if (!existsSync(from) || !statSync(from).isDirectory()) fail(`There is no template called ${template}.`);
if (!existsSync(join(from, 'index.php'))) fail(`The template ${template} has no index.php yet.`);

mkdirSync(sites, { recursive: true });
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
writeFileSync(join(to, 'site.json'), `${JSON.stringify({ hotel, template, createdBy: 'create-site.mjs' }, null, 2)}\n`);
// the template's own README describes the template; the hotel's folder gets a short CUSTOM.md for what is changed for this hotel only
if (!existsSync(join(to, 'CUSTOM.md'))) writeFileSync(join(to, 'CUSTOM.md'), `# ${hotel}\n\nCopied from ${template}. List here what differs from the template, so anyone can see it.\n`);
// the same file read back proves what was written (and keeps a bad copy from being reported as done)
const written = JSON.parse(readFileSync(join(to, 'site.json'), 'utf8'));
if (written.hotel !== hotel || written.template !== template) fail('The copy could not be checked.');
console.log(JSON.stringify({ ok: true, hotel, template, folder: `sites/${hotel}` }));
