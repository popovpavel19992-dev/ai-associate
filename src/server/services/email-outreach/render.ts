// src/server/services/email-outreach/render.ts
// Pipeline: variable substitution -> markdown -> DOMPurify sanitize.
// Shared between send path and previewRender tRPC endpoint so preview == sent.

import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = ["p", "h2", "h3", "strong", "em", "a", "ul", "ol", "li", "br", "blockquote"];
const ALLOWED_ATTR = ["href", "rel", "target"];

export function substituteVariables(src: string, variables: Record<string, string>): string {
  return src.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (full, name) => {
    return Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : full;
  });
}

export function renderMarkdownToHtml(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}

export function renderEmail({
  subject,
  bodyMarkdown,
  variables,
}: {
  subject: string;
  bodyMarkdown: string;
  variables: Record<string, string>;
}): { subject: string; bodyMarkdown: string; bodyHtml: string } {
  const finalSubject = substituteVariables(subject, variables);
  const finalMarkdown = substituteVariables(bodyMarkdown, variables);
  const bodyHtml = renderMarkdownToHtml(finalMarkdown);
  return { subject: finalSubject, bodyMarkdown: finalMarkdown, bodyHtml };
}
