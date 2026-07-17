/**
 * PII redaction for lessons submitted to the shared brain.
 * Two stages: regex sweep, then optional LLM pass. Preserves pattern shape.
 */

export type RedactionResult = {
  text: string;
  stripped: Record<string, number>;
  safe: boolean;
  reason?: string;
};

const RX = {
  email: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
  phone: /(?:\+?\d[\s().-]?){7,}\d/g,
  iban: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
  cc: /\b(?:\d[ -]*?){13,19}\b/g,
  flight: /\b[A-Z]{2}\d{1,4}[A-Z]?\b/g,
  plate: /\b[A-Z]{2,3}[- ]?\d{2,4}\b/g,
  url: /https?:\/\/\S+/gi,
};

export function redactPii(input: string): RedactionResult {
  if (!input) return { text: "", stripped: {}, safe: true };
  const stripped: Record<string, number> = {};
  let text = input;

  const swap = (key: string, rx: RegExp, token: string) => {
    let count = 0;
    text = text.replace(rx, () => { count++; return token; });
    if (count) stripped[key] = count;
  };
  swap("email", RX.email, "<EMAIL>");
  swap("phone", RX.phone, "<PHONE>");
  swap("iban", RX.iban, "<IBAN>");
  swap("cc", RX.cc, "<CARD>");
  swap("url", RX.url, "<URL>");
  swap("flight", RX.flight, "<FLIGHT>");
  swap("plate", RX.plate, "<PLATE>");

  // Reject if long digit runs remain (5+ consecutive digits not part of a time/date).
  const suspicious = text.match(/\b\d{5,}\b/g);
  if (suspicious && suspicious.length > 0) {
    return {
      text,
      stripped,
      safe: false,
      reason: "Contains long numeric sequences that may be personal data. Please remove them and try again.",
    };
  }
  return { text, stripped, safe: true };
}

export async function logPiiAudit(params: {
  companyId: string | null;
  userId: string;
  source: string;
  stripped: Record<string, number>;
  inputLength: number;
  outputLength: number;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("ai_pii_audit").insert({
    company_id: params.companyId,
    user_id: params.userId,
    source: params.source,
    stripped_types: params.stripped,
    input_length: params.inputLength,
    output_length: params.outputLength,
  });
}
