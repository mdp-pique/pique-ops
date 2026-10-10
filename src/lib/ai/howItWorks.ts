import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * "How does the software work today?" for Pique-a-choo, read from the repo's own docs, so a tech
 * request is scoped against what's really built (MDP 10-10). The files ship with the Slack events
 * route via outputFileTracingIncludes in next.config.ts. These are engineering docs: the prompt asks
 * the model to explain them in plain words and leave out ids.
 */
const DOCS = ["CLAUDE.md", "docs/pique-bot-notification-legend.md", "docs/zapier-migration.md"];

/** Characters returned per lookup (~4k tokens). */
const MAX_CHARS = 16_000;

type Section = { source: string; heading: string; text: string };

let cache: Promise<Section[]> | null = null;

async function sections(): Promise<Section[]> {
  cache ??= Promise.all(
    DOCS.map(async (file) => {
      try {
        return splitSections(file, await readFile(path.join(process.cwd(), file), "utf8"));
      } catch (e) {
        console.error(`How it works: can't read ${file}: ${(e as Error).message}`);
        return [];
      }
    }),
  ).then((all) => all.flat());
  return cache;
}

/** Splits a markdown file at its "## " headings (the intro before the first one is its own section). */
function splitSections(source: string, text: string): Section[] {
  const out: Section[] = [];
  let heading = source;
  let body: string[] = [];
  const flush = () => {
    const joined = body.join("\n").trim();
    if (joined) out.push({ source, heading, text: joined });
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      flush();
      heading = line.slice(3).trim();
      body = [];
    } else {
      body.push(line);
    }
  }
  flush();
  return out;
}

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "what", "when", "how", "does", "into", "are", "our", "can", "should"]);

function terms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9_#@-]+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
}

/** The doc sections that best match the query (heading matches count most), up to MAX_CHARS. */
export async function lookupHowItWorks(query: string): Promise<string> {
  const words = terms(query);
  if (!words.length) return "Give a few keywords (e.g. 'damage report slack post', 'parking 213', 'review QC').";
  const scored = (await sections())
    .map((s) => {
      const heading = s.heading.toLowerCase();
      const body = s.text.toLowerCase();
      let score = 0;
      for (const w of words) {
        if (heading.includes(w)) score += 5;
        score += Math.min(body.split(w).length - 1, 5);
      }
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return "Nothing in the docs matches that. Try other words, or say it isn't documented.";

  let out = "";
  for (const { s } of scored.slice(0, 4)) {
    const block = `### ${s.heading} (${s.source})\n${s.text}\n\n`;
    if (out && out.length + block.length > MAX_CHARS) break;
    out += block.slice(0, MAX_CHARS - out.length);
  }
  return out.trim();
}
