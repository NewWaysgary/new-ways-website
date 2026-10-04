// Test support: makes this Node behave like Node before 24.7.0 (nodejs/node#59340), whose built-in SQLite treated
// numbered parameters (?1, ?2) as named ones, so values passed by position failed with "column index out of range".
// Used to prove the local D1 stand-in works whichever Node version runs it.
import sqlite from 'node:sqlite';

// true when the SQL has a real ?NNN parameter (ignoring text in quotes and comments)
function hasNumberedParameter(sql) {
  const bare = sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
  return /\?\d/.test(bare);
}

const prepare = sqlite.DatabaseSync.prototype.prepare;
sqlite.DatabaseSync.prototype.prepare = function (sql) {
  const stmt = prepare.call(this, sql);
  if (hasNumberedParameter(sql)) {
    for (const m of ['run', 'get', 'all', 'iterate']) {
      const original = stmt[m].bind(stmt);
      stmt[m] = (...args) => {
        if (args.length && (args[0] === null || typeof args[0] !== 'object')) throw new Error('column index out of range');
        return original(...args);
      };
    }
  }
  return stmt;
};
