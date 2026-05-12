#!/usr/bin/env node
/**
 * OpenAI-powered translation script for the BC Arcade i18n workflow.
 *
 * Usage:
 *   node scripts/translate.js --locale fr-CA --namespace common [--model gpt-4o] [--dry-run] [--force]
 *
 * Flags:
 *   --locale     Target locale code (fr-CA | es | hi | ar | zh | ja | ko | pt | he | de | nl | ru)
 *   --namespace  Translation namespace (common | yacht | cascade | errors)
 *   --model      OpenAI model to use (default: gpt-4o)
 *   --dry-run    Preview what would be sent; do not call API or write files
 *   --force      Re-translate ALL keys, not just __NEEDS_TRANSLATION__ ones
 *
 * Requires:
 *   OPENAI_API_KEY environment variable
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { glossary, doNotTranslateTerms } from "../src/i18n/glossary.js";
import { LOCALES } from "../src/i18n/locales.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, "../src/i18n/locales");
const PLACEHOLDER = "__NEEDS_TRANSLATION__";
const BATCH_SIZE = 20;

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
  };
  const has = (flag) => args.includes(flag);

  const locale = get("--locale");
  const ns = get("--namespace");
  const model = get("--model") ?? "gpt-4o-2024-11-20";
  const dryRun = has("--dry-run");
  const force = has("--force");

  if (!locale || !ns) {
    console.error(
      "Usage: node scripts/translate.js --locale <code> --namespace <ns> [--model gpt-4o] [--dry-run] [--force]"
    );
    console.error(
      `  Locales:     ${LOCALES.filter((l) => l.code !== "en")
        .map((l) => l.code)
        .join(" | ")}`
    );
    console.error("  Namespaces:  common | yacht | cascade | errors | blackjack | twenty48");
    process.exit(1);
  }

  return { locale, ns, model, dryRun, force };
}

// ─── File helpers ─────────────────────────────────────────────────────────────

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildGlossaryBlock() {
  const lines = ["PROTECTED TERMS — do not translate, modify, or transliterate these:"];
  for (const [term, meta] of Object.entries(glossary)) {
    if (!meta.doNotTranslate) continue;
    const note = meta.notes ? ` (${meta.notes})` : "";
    lines.push(`  • "${term}" — ${meta.reason}${note}`);
  }
  return lines.join("\n");
}

function buildContextBlock(keys, metaMap) {
  const lines = ["PER-KEY CONTEXT (use this to guide tone and constraints):"];
  for (const key of keys) {
    const m = metaMap[key];
    if (!m) continue;
    const parts = [`  Key "${key}"`];
    if (m.description) parts.push(`desc: ${m.description}`);
    if (m.tone) parts.push(`tone: ${m.tone}`);
    if (m.characterLimit) parts.push(`charLimit: ${m.characterLimit}`);
    if (m.placeholders?.length)
      parts.push(`placeholders (preserve exactly): ${m.placeholders.join(", ")}`);
    if (m.doNotTranslate?.length) parts.push(`do not translate: ${m.doNotTranslate.join(", ")}`);
    if (m.notes) parts.push(`notes: ${m.notes}`);
    lines.push(parts.join(" | "));
  }
  return lines.join("\n");
}

function buildSystemPrompt(localeConfig) {
  return `You are a localization expert for a casual gaming app. Your job is NOT to translate literally — it is to adapt English UI strings so they feel natural, fun, and idiomatic to native ${localeConfig.nativeLabel} speakers who play mobile games.

Target locale: ${localeConfig.code} — ${localeConfig.nativeLabel} (${localeConfig.label})

ABOUT THE APP: A gaming app containing two games — Yacht (a classic dice game) and Cascade (a physics-based fruit dropping game). The tone is casual, fun, and encouraging. UI strings should feel like they belong in a polished mobile game, not a corporate app.

ADAPTATION GUIDELINES:
- Do NOT translate literally — adapt so it feels natural in ${localeConfig.nativeLabel} gaming contexts
- Keep strings short and punchy — mobile UI has limited space
- Game mechanics terms (category names, score labels) should match how gamers in that locale talk about games
- Accessibility labels should be functional and clear
- Preserve numbers and point values exactly (e.g. "25", "40", "+35")
- For RTL locales, ensure strings read naturally in RTL context

${buildGlossaryBlock()}

TRANSLATION RULES:
1. Translate only the VALUES in the JSON object — never the keys.
2. Preserve all {{placeholder}} variables exactly as they appear (e.g. {{score}}, {{round}}).
3. Respect the tone and character limit specified per key.
4. Respond ONLY with a valid JSON object — no markdown fences, no commentary.
5. Every key in the input must appear in the output.`;
}

// ─── OpenAI call ─────────────────────────────────────────────────────────────

async function callOpenAI(systemPrompt, userPrompt, model) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY environment variable is not set.\n" +
        "Export it before running: export OPENAI_API_KEY=sk-..."
    );
  }

  const MAX_RETRIES = 5;
  let lastError = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_completion_tokens: 4096,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    // Retry on 429 RateLimitError with exponential backoff
    if (response.status === 429) {
      const backoff = Math.pow(2, attempt + 1) * 1000;
      console.warn(
        `Rate limit hit (429). Retrying in ${backoff / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`
      );
      await new Promise((resolve) => setTimeout(resolve, backoff));
      lastError = new Error(`OpenAI RateLimitError after ${MAX_RETRIES} retries`);
      continue;
    }

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  }
  throw lastError ?? new Error(`OpenAI RateLimitError: exceeded ${MAX_RETRIES} retry attempts`);
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(source, translated) {
  const warnings = [];
  const placeholderRe = /\{\{[^}]+\}\}/g;

  for (const [key, srcVal] of Object.entries(source)) {
    const tVal = translated[key];
    if (!tVal) {
      warnings.push(`  ⚠  Key "${key}" is missing from translation output.`);
      continue;
    }

    // Check protected terms
    for (const term of doNotTranslateTerms) {
      if (srcVal.includes(term) && !tVal.includes(term)) {
        warnings.push(`  ⚠  Key "${key}": protected term "${term}" missing in translation.`);
      }
    }

    // Check placeholders
    const srcPhs = srcVal.match(placeholderRe) ?? [];
    const tPhs = tVal.match(placeholderRe) ?? [];
    for (const ph of srcPhs) {
      if (!tPhs.includes(ph)) {
        warnings.push(`  ⚠  Key "${key}": placeholder "${ph}" missing in translation.`);
      }
    }
  }

  return warnings;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { locale, ns, model, dryRun, force } = parseArgs();

  const localeConfig = LOCALES.find((l) => l.code === locale);
  if (!localeConfig || locale === "en") {
    console.error(
      `Invalid locale "${locale}". Choose from: ${LOCALES.filter((l) => l.code !== "en")
        .map((l) => l.code)
        .join(", ")}`
    );
    process.exit(1);
  }

  const enPath = join(LOCALES_DIR, "en", `${ns}.json`);
  const targetPath = join(LOCALES_DIR, locale, `${ns}.json`);
  const metaPath = join(LOCALES_DIR, "_meta", `${ns}.meta.json`);

  const enStrings = loadJson(enPath);
  const targetStrings = loadJson(targetPath);
  const metaMap = loadJson(metaPath);

  const keysToTranslate = Object.keys(enStrings).filter((k) => {
    const cur = targetStrings[k];
    return force ? true : cur === PLACEHOLDER || cur === undefined;
  });

  if (keysToTranslate.length === 0) {
    console.log(`✓ Nothing to translate for ${locale}/${ns}.json`);
    return;
  }

  const tag = dryRun ? " [DRY RUN]" : "";
  console.log(
    `Translating ${keysToTranslate.length} key(s) → ${locale}/${ns}.json  (model: ${model})${tag}`
  );

  const systemPrompt = buildSystemPrompt(localeConfig);
  const result = { ...targetStrings };
  let translated = 0;

  for (let i = 0; i < keysToTranslate.length; i += BATCH_SIZE) {
    const batch = keysToTranslate.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`  Batch ${batchNum}: ${batch.length} key(s)…`);

    if (dryRun) {
      console.log(`  [DRY RUN] Keys: ${batch.join(", ")}`);
      continue;
    }

    const batchSource = Object.fromEntries(batch.map((k) => [k, enStrings[k]]));
    const contextBlock = buildContextBlock(batch, metaMap);

    const userPrompt = `${contextBlock}

Translate these values from English to ${localeConfig.nativeLabel} (${locale}):

${JSON.stringify(batchSource, null, 2)}`;

    const raw = await callOpenAI(systemPrompt, userPrompt, model);

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Model returned non-JSON output:\n${raw}`);
    }
    const translations = JSON.parse(jsonMatch[0]);

    const warnings = validate(batchSource, translations);
    if (warnings.length > 0) {
      console.warn("  Validation warnings:");
      warnings.forEach((w) => console.warn(w));
    }

    Object.assign(result, translations);
    translated += batch.length;
  }

  if (!dryRun) {
    writeFileSync(targetPath, JSON.stringify(result, null, 2) + "\n", "utf8");
    console.log(`✓ Wrote ${translated} translation(s) to ${locale}/${ns}.json`);
  }
}

main().catch((err) => {
  console.error("Translation failed:", err.message);
  process.exit(1);
});
