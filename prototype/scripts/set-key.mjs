// Stores a MultiHopper key in prototype/.env without ever printing it, then checks it against the API.
//   node scripts/set-key.mjs [--clipboard]           devnet key (mh_test_) -> MH_API_KEY
//   node scripts/set-key.mjs --live [--clipboard]    production key (mh_live_) -> MH_LIVE_KEY
// With --clipboard the key is read from the clipboard and the clipboard is cleared afterwards.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const live = process.argv.includes("--live");
const fromClipboard = process.argv.includes("--clipboard");
const prefix = live ? "mh_live_" : "mh_test_";
const envName = live ? "MH_LIVE_KEY" : "MH_API_KEY";
const apiBase = live ? "https://multihopper.com/api/v1" : "https://devnet.multihopper.com/api/v1";

function askHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    stdin.on("data", function onData(chunk) {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value.trim());
        }
        if (ch === "\u0003") process.exit(1);
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    });
  });
}

const powershell = (cmd) => execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8" });
const key = fromClipboard
  ? powershell("Get-Clipboard -Raw").trim()
  : await askHidden(`Paste the ${prefix} key (input is hidden), then press Enter: `);
if (fromClipboard) powershell("Set-Clipboard -Value ' '");

if (!key.startsWith(prefix)) {
  console.error(`Rejected: the key must start with ${prefix}. Nothing was written.`);
  process.exitCode = 1;
} else {
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : [];
  const kept = lines.filter((l) => !l.startsWith(`${envName}=`));
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  kept.push(`${envName}=${key}`, "");
  writeFileSync(envPath, kept.join("\n"));
  console.log(`Saved ${envName} to ${envPath} (${key.length} characters).${fromClipboard ? " Clipboard cleared." : ""}`);

  const res = await fetch(`${apiBase}/usage`, { headers: { "x-api-key": key } });
  console.log(res.ok ? `${live ? "Production" : "Devnet"} API accepted the key (HTTP ${res.status}).` : `API rejected the key (HTTP ${res.status}). Create a new one in the dashboard and run this again.`);
}
