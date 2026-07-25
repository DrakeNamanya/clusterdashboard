// Local dev only. The Hyperdrive binding needs a local Postgres connection
// string so `wrangler pages dev` can emulate it in the sandbox. We read it from
// ORACLE_DATABASE_URL in .dev.vars (NOT committed) so no secret lives in git.
const fs = require('fs');
const path = require('path');
function localHyperdriveConn() {
  try {
    const dv = fs.readFileSync(path.join(__dirname, '.dev.vars'), 'utf8');
    const m = dv.match(/^ORACLE_DATABASE_URL=(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* no .dev.vars — leave unset */ }
  return process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE || '';
}

module.exports = {
  apps: [
    {
      name: 'webapp',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=DB --ip 0.0.0.0 --port 3000',
      cwd: '/home/user/webapp',
      env: {
        NODE_ENV: 'development',
        CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: localHyperdriveConn(),
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
    },
  ],
};
