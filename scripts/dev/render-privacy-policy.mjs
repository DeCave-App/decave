// Writes docs/legal/PRIVACY-POLICY.md from website/src/privacy-policy.ts, the
// single source of the policy text. Run after editing the policy:
//
//   node --experimental-strip-types scripts/dev/render-privacy-policy.mjs
//
// `--check` exits non-zero when the Markdown is out of date (used by tests).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..", "..");
const target = path.join(root, "docs", "legal", "PRIVACY-POLICY.md");

export async function renderPrivacyPolicyMarkdown() {
  const { PRIVACY_POLICY: policy } = await import(
    pathToFileURL(path.join(root, "website", "src", "privacy-policy.ts")).href
  );
  const lines = [
    `# ${policy.title}`,
    "",
    `**Effective date:** ${policy.effective}`,
    "",
    "<!-- Generated from website/src/privacy-policy.ts by scripts/dev/render-privacy-policy.mjs. Edit the source, not this file. -->",
    "",
    `> ${policy.draftNote}`,
    "",
    ...policy.intro.flatMap((paragraph) => [paragraph, ""]),
  ];
  for (const section of policy.sections) {
    lines.push(`## ${section.title}`, "");
    for (const block of section.blocks) {
      if ("p" in block) lines.push(block.p, "");
      else if ("list" in block) lines.push(...block.list.map((item) => `- ${item}`), "");
      else {
        lines.push(`| ${block.table.head[0]} | ${block.table.head[1]} |`, "| --- | --- |");
        lines.push(...block.table.rows.map(([label, value]) => `| ${label} | ${value} |`), "");
      }
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const markdown = await renderPrivacyPolicyMarkdown();
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(target, "utf8") !== markdown) {
      console.error("docs/legal/PRIVACY-POLICY.md is out of date. Run scripts/dev/render-privacy-policy.mjs.");
      process.exit(1);
    }
  } else {
    fs.writeFileSync(target, markdown);
    console.log("Wrote", path.relative(root, target));
  }
}
