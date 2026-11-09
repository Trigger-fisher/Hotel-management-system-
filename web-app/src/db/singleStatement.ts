import "server-only";
// One statement per query. The app's SQL is written as constant text with $1, $2 parameters, so a second statement can only appear through
// an injection bug. This guard refuses it in the app, before it reaches the server (node-postgres sends a query without parameters as a
// "simple query", which PostgreSQL would run as stacked statements, for example `...; SET ROLE another_hotel`).
//
// It removes what may legitimately contain a semicolon (string literals, quoted identifiers, dollar-quoted text, comments) and then refuses a
// semicolon that is followed by anything but whitespace.

const STRIP = /'(?:[^']|'')*'|"(?:[^"]|"")*"|\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$|--[^\n]*|\/\*[\s\S]*?\*\//g;

export function hasStackedStatements(text: string): boolean {
  return /;\s*\S/.test(text.replace(STRIP, " "));
}

