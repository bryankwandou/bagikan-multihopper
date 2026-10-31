// Prompts for the MultiHopper devnet key with hidden input, writes it to prototype/.env,
// then checks it against the devnet API. The key is never printed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));

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

import { execFileSync } from "node:child_process";

const fromClipboard = process.argv.includes("--clipboard");
const key = fromClipboard
  ? execFileSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" }).trim()
  : await askHidden("Paste the mh_test_ key (input is hidden), then press Enter: ");
if (!key.startsWith("mh_test_")) {
  console.error("Rejected: the key must start with mh_test_ (devnet). Nothing was written.");
  process.exit(1);
}

const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : [];
const kept = lines.filter((l) => !l.startsWith("MH_API_KEY="));
while (kept.length && kept[kept.length - 1] === "") kept.pop();
kept.push(`MH_API_KEY=${key}`, "");
writeFileSync(envPath, kept.join("\n"));
console.log(`Saved to ${envPath} (${key.length} characters).`);

const res = await fetch("https://devnet.multihopper.com/api/v1/usage", { headers: { "x-api-key": key } });
console.log(res.ok ? `Devnet API accepted the key (HTTP ${res.status}).` : `Devnet API rejected the key (HTTP ${res.status}). Create a new one in the dashboard and run this again.`);
