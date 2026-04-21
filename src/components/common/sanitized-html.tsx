"use client";

import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = ["p", "h2", "h3", "strong", "em", "a", "ul", "ol", "li", "br", "blockquote"];
const ALLOWED_ATTR = ["href", "rel", "target"];

export function SanitizedHtml({ html, className }: { html: string; className?: string }) {
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
  // The only place in the codebase that sets raw HTML via React's __html prop.
  // `clean` has already passed through DOMPurify above.
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}
