/**
 * HTML to JSX conversion utilities
 */

/** Convert a kebab-case string to PascalCase */
export const toPascalCase = (str: string): string =>
  str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");

/** HTML attribute to JSX attribute mapping */
const HTML_TO_JSX_ATTRS: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  readonly: "readOnly",
  maxlength: "maxLength",
  minlength: "minLength",
  colspan: "colSpan",
  rowspan: "rowSpan",
  cellpadding: "cellPadding",
  cellspacing: "cellSpacing",
  frameborder: "frameBorder",
  allowfullscreen: "allowFullScreen",
  autocomplete: "autoComplete",
  autofocus: "autoFocus",
  autoplay: "autoPlay",
  enctype: "encType",
  formaction: "formAction",
  formenctype: "formEncType",
  formmethod: "formMethod",
  formnovalidate: "formNoValidate",
  formtarget: "formTarget",
  inputmode: "inputMode",
  novalidate: "noValidate",
  srcdoc: "srcDoc",
  srcset: "srcSet",
  usemap: "useMap",
  datetime: "dateTime",
  crossorigin: "crossOrigin",
};

/** Convert HTML attribute name to JSX equivalent */
export const htmlAttrToJsx = (attr: string): string => {
  return HTML_TO_JSX_ATTRS[attr.toLowerCase()] || attr;
};

/** Void elements that should be self-closing in JSX */
const VOID_ELEMENTS = [
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
];

/** Boolean attributes in HTML */
const BOOLEAN_ATTRS = [
  "checked",
  "disabled",
  "selected",
  "required",
  "hidden",
  "multiple",
  "autoplay",
  "controls",
  "loop",
  "muted",
  "playsinline",
];

export interface ClassAttribute {
  fullMatch: string;
  classes: string;
  startIndex: number;
  endIndex: number;
}

/** Extract all class attributes from HTML and their positions */
export function extractClassAttributes(html: string): ClassAttribute[] {
  const results: ClassAttribute[] = [];

  // Handle both single and double quoted class attributes
  // Use a more robust approach that handles nested brackets and quotes in arbitrary values
  const doubleQuoteRegex = /class\s*=\s*"([^"]*)"/gi;
  const singleQuoteRegex = /class\s*=\s*'([^']*)'/gi;

  let match: RegExpExecArray | null;

  // First pass: double-quoted class attributes
  while ((match = doubleQuoteRegex.exec(html)) !== null) {
    results.push({
      fullMatch: match[0],
      classes: match[1] ?? "",
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  // Second pass: single-quoted class attributes (less common)
  while ((match = singleQuoteRegex.exec(html)) !== null) {
    // Avoid duplicates if somehow both match
    const exists = results.some((r) => r.startIndex === match?.index);
    if (!exists) {
      results.push({
        fullMatch: match[0],
        classes: match[1] ?? "",
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }
  }

  // Sort by position
  results.sort((a, b) => a.startIndex - b.startIndex);

  return results;
}

/** Convert HTML to JSX with proper attribute handling */
export function htmlToJsx(html: string): string {
  let jsx = html;

  // Convert HTML comments to JSX comments
  jsx = jsx.replace(/<!--([\s\S]*?)-->/g, "{/*$1*/}");

  // Self-closing tags for void elements
  VOID_ELEMENTS.forEach((tag) => {
    const regex = new RegExp(`<${tag}([^>]*)(?<!/)>`, "gi");
    jsx = jsx.replace(regex, `<${tag}$1 />`);
  });

  // Convert common HTML attributes to JSX
  jsx = jsx.replace(/\s(for|tabindex|readonly|maxlength|minlength)=/gi, (_, attr) => {
    return ` ${htmlAttrToJsx(attr)}=`;
  });

  // Convert style string to object (basic handling)
  jsx = jsx.replace(/style="([^"]*)"/g, (_, styleStr: string) => {
    const styles = styleStr.split(";").filter(Boolean);
    const styleObj = styles
      .map((style) => {
        const [prop, val] = style.split(":").map((s) => s.trim());
        if (!prop || !val) return null;
        // Convert kebab-case to camelCase
        const camelProp = prop.replace(/-([a-z])/g, (__, letter: string) => letter.toUpperCase());
        return `${camelProp}: "${val}"`;
      })
      .filter(Boolean)
      .join(", ");
    return `style={{ ${styleObj} }}`;
  });

  // Convert boolean attributes
  const booleanPattern = new RegExp(`\\s(${BOOLEAN_ATTRS.join("|")})\\s*(?==|\\/?>|\\s)`, "gi");
  jsx = jsx.replace(booleanPattern, (match, attr) => {
    if (match.includes("=")) return match;
    return ` ${attr}={true}`;
  });

  // Convert iconify-icon to JSX-compatible format
  jsx = jsx.replace(/<iconify-icon([^>]*)><\/iconify-icon>/g, "<IconifyIcon$1 />");
  jsx = jsx.replace(/<iconify-icon([^>]*)\/>/g, "<IconifyIcon$1 />");

  return jsx;
}

export interface ExtractedBody {
  content: string;
  styles: string;
}

/** Remove DOCTYPE, html, head, body wrappers and extract main content */
export function extractBodyContent(html: string): ExtractedBody {
  // Extract inline styles from <style> tags
  const styleMatches = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  const styles = styleMatches?.map((match) => match.replace(/<\/?style[^>]*>/gi, "").trim()).join("\n") ?? "";

  // Remove DOCTYPE
  let content = html.replace(/<!DOCTYPE[^>]*>/gi, "");

  // Remove html, head, body tags but keep body content
  content = content.replace(/<html[^>]*>/gi, "").replace(/<\/html>/gi, "");
  content = content.replace(/<head>[\s\S]*?<\/head>/gi, "");
  content = content.replace(/<body[^>]*>/gi, "").replace(/<\/body>/gi, "");

  // Remove script tags
  content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");

  // Remove link tags (external stylesheets)
  content = content.replace(/<link[^>]*>/gi, "");

  // Remove style tags (we already extracted the content)
  content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  return { content: content.trim(), styles };
}
