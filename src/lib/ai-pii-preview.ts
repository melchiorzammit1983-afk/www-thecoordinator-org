/**
 * Client-side preview of PII redaction. Mirrors the server regex sweep
 * only (no LLM pass). Used purely to show users what will be stripped
 * before they submit; the server always re-runs the authoritative pass.
 */
const RX = {
  email: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
  phone: /(?:\+?\d[\s().-]?){7,}\d/g,
  iban: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
  cc: /\b(?:\d[ -]*?){13,19}\b/g,
  flight: /\b[A-Z]{2}\d{1,4}[A-Z]?\b/g,
  plate: /\b[A-Z]{2,3}[- ]?\d{2,4}\b/g,
  url: /https?:\/\/\S+/gi,
};

export function redactPii(input: string) {
  const stripped: Record<string, number> = {};
  let text = input;
  const swap = (key: string, rx: RegExp, token: string) => {
    let n = 0;
    text = text.replace(rx, () => { n++; return token; });
    if (n) stripped[key] = n;
  };
  swap("email", RX.email, "<EMAIL>");
  swap("phone", RX.phone, "<PHONE>");
  swap("iban", RX.iban, "<IBAN>");
  swap("cc", RX.cc, "<CARD>");
  swap("url", RX.url, "<URL>");
  swap("flight", RX.flight, "<FLIGHT>");
  swap("plate", RX.plate, "<PLATE>");
  return { text, stripped };
}
