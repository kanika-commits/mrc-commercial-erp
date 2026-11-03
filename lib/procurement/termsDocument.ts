export type ParsedTermsClause = { heading: string; clause_body: string; sort_order: number; status: "active"; uncertain?: boolean };

const numberedClause = /^\s*(?:clause\s+)?(\d+(?:\.\d+)*|[A-Z](?:\.\d+)?)\s*(?:[.)\-:]\s*|\s+)(.+?)\s*$/i;

function htmlLines(html: string) {
  return String(html || "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/p\s*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").split(/\n+/).map((line) => line.trim()).filter(Boolean);
}

export function parseTermsDocument(input: string, richTextHtml = ""): { clauses: ParsedTermsClause[]; uncertain: boolean } {
  const text = String(input || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return { clauses: [], uncertain: false };
  const richLines = htmlLines(richTextHtml);
  const lines = text.split("\n");
  const boldHeadings = new Set((richLines.length ? String(richTextHtml).match(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi) || [] : []).map((value) => value.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim()));
  const starts = lines.map((line, index) => ({ index, line, match: line.match(numberedClause) })).filter((row) => row.match);
  const boldLines = richLines.filter((line) => boldHeadings.has(line));
  if (!starts.length && boldLines.length) {
    const boldIndexes = lines.map((line, index) => ({ index, line: line.trim() })).filter((row) => boldLines.some((bold) => bold === row.line));
    if (boldIndexes.length) return { clauses: boldIndexes.map((start, index) => ({ heading: start.line, clause_body: lines.slice(start.index + 1, boldIndexes[index + 1]?.index ?? lines.length).join("\n").trim(), sort_order: index, status: "active" as const, uncertain: false })), uncertain: false };
  }
  if (!starts.length || starts[0].index > 1) return { clauses: [{ heading: "Pasted Terms", clause_body: text, sort_order: 0, status: "active", uncertain: true }], uncertain: true };
  const clauses = starts.map((start, index) => { const next = starts[index + 1]?.index ?? lines.length; const heading = start.match![2].trim(); const body = lines.slice(start.index + 1, next).join("\n").trim(); return { heading, clause_body: body, sort_order: index, status: "active" as const, uncertain: !boldHeadings.size || !Array.from(boldHeadings).some((value) => value.includes(heading)) }; });
  return { clauses, uncertain: starts.length < 2 && lines.length > 2 };
}
