#!/usr/bin/env node
// Checks that GEMINI_API_KEY works and that the models this app asks for actually exist.
//
//   node scripts/check-gemini.mjs                  # the models this app uses
//   node scripts/check-gemini.mjs gemini-3.8-flash # any other model as well
//
// The key is read from GEMINI_API_KEY, or from a .env file beside package.json.
// It is never printed: only the first and last few characters are shown.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://generativelanguage.googleapis.com/v1beta";

// The models this app requests. Keep in step with server.ts.
const DEFAULT_MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];

function readKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  try {
    const line = readFileSync(join(ROOT, ".env"), "utf8")
      .split("\n")
      .find((l) => l.trim().startsWith("GEMINI_API_KEY"));
    if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  } catch {
    /* no .env, which is fine */
  }
  return "";
}

const mask = (k) => (k.length < 12 ? "(too short to be a key)" : `${k.slice(0, 6)}…${k.slice(-4)}`);
// An API error can echo the request URL back, key and all. Never let that reach the screen.
const scrub = (s) => String(s).replace(/key=[\w-]+/g, "key=REDACTED").replace(/AIza[\w-]{10,}/g, "AIza…REDACTED");

const key = readKey();
if (!key || key === "MY_GEMINI_API_KEY") {
  console.error("No API key. Set GEMINI_API_KEY in the environment, or put it in .env beside package.json.");
  console.error("Without one this app still runs: it falls back to local moderation.");
  process.exit(1);
}
console.log(`Key ${mask(key)} (${key.length} characters)\n`);

// 1. Does the key work at all?
let available;
try {
  const res = await fetch(`${BASE}/models?key=${encodeURIComponent(key)}&pageSize=200`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = scrub(body?.error?.message || `HTTP ${res.status}`);
    console.error(`The key was refused: ${msg}\n`);
    if (res.status === 400) console.error("A 400 here usually means the key is malformed or from a different service.");
    if (res.status === 403) console.error("A 403 usually means the Generative Language API is not enabled for that\nproject, or the key is restricted to other APIs, referrers or IP addresses.");
    if (res.status === 429) console.error("A 429 means the key works but its quota is spent.");
    process.exit(1);
  }
  available = new Set((body.models || []).map((m) => String(m.name).replace(/^models\//, "")));
  console.log(`The key works. ${available.size} models are visible to it.\n`);
} catch (err) {
  console.error(`Could not reach ${BASE}: ${scrub(err.message)}`);
  process.exit(1);
}

// 2. Does each model this app asks for exist, and answer?
const models = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_MODELS;
let failed = 0;

for (const model of models) {
  if (!available.has(model)) {
    const near = [...available].filter((m) => m.startsWith(model.split("-").slice(0, 2).join("-"))).slice(0, 4);
    console.log(`FAIL  ${model} — this key cannot see that model.`);
    if (near.length) console.log(`      Close matches: ${near.join(", ")}`);
    failed++;
    continue;
  }
  try {
    const res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Reply with the single word: ok" }] }],
        generationConfig: { maxOutputTokens: 5, temperature: 0 },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log(`FAIL  ${model} — ${scrub(body?.error?.message || `HTTP ${res.status}`)}`);
      failed++;
    } else {
      const text = body?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "(no text)";
      console.log(`OK    ${model} — answered ${JSON.stringify(text.slice(0, 20))}`);
    }
  } catch (err) {
    console.log(`FAIL  ${model} — ${scrub(err.message)}`);
    failed++;
  }
}

console.log();
if (failed) {
  console.error(`${failed} of ${models.length} models failed. Until that is fixed this app quietly uses its local`);
  console.error("fallback instead of Gemini, which still works but is much blunter.");
  console.error("Change the model names in server.ts to ones listed above as visible to the key.");
  process.exit(1);
}
console.log(`All ${models.length} models work with this key.`);
