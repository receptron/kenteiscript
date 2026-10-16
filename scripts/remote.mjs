// Runs a wrangler command against Cloudflare, with the D1 id from .env.
//   yarn deploy                                   (= node scripts/remote.mjs deploy)
//   yarn remote d1 execute mulmo-kentei --remote --command "SELECT COUNT(*) FROM plays"
import { wranglerRemote } from "./env.mjs";

const args = process.argv.slice(2);
if (!args.length) {
  console.error("usage: yarn remote <wrangler command>");
  process.exit(1);
}
try {
  wranglerRemote(args, { stdio: "inherit" });
} catch (e) {
  if (e.status == null) console.error(e.message);
  process.exit(e.status ?? 1);
}
