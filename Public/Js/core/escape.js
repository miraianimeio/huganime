 

























const ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, character => ESCAPE_MAP[character]);
}

 




export class SafeHtml {
  constructor(value) {
    this.value = String(value ?? "");
  }
  toString() {
    return this.value;
  }
}

export const isSafeHtml = value => value instanceof SafeHtml;

 



export function raw(markup) {
  return new SafeHtml(markup);
}

function interpolate(value) {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof SafeHtml) return value.value;
   
   
  if (Array.isArray(value)) return value.map(interpolate).join("");
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let output = strings[0];
  for (let index = 0; index < values.length; index += 1) {
    output += interpolate(values[index]) + strings[index + 1];
  }
  return new SafeHtml(output);
}

 



export function joinHtml(parts, separator = "") {
  return new SafeHtml((parts || []).map(interpolate).join(separator));
}

 



export function safeUrl(value) {
  const url = String(value ?? "").trim();
  if (!url) return "";
  if (/^(https?:|data:image\/|\/|\.\/|assets\/)/i.test(url)) return url;
  return "";
}
