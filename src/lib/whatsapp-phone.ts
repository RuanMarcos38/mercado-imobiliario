export function normalizeWhatsAppPhone(value: string): string | null {
  const raw = value.trim();
  const digits = raw.replace(/\D/g, "");

  if (!digits) return null;

  // Explicit international format: preserve the country code supplied by the user.
  if (raw.startsWith("+")) {
    return digits.length >= 10 && digits.length <= 15 ? digits : null;
  }

  // Brazilian numbers already carrying DDI 55.
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }

  // The MercadoImobi operation is Brazil-first. If the user enters DDD + number,
  // add the Brazilian country code automatically.
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  // Other international E.164 numbers are accepted when the country code is present.
  if (digits.length >= 12 && digits.length <= 15) {
    return digits;
  }

  return null;
}

export function whatsappPhoneErrorMessage(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 8 || digits.length === 9) {
    return "Número incompleto. Informe DDD + número ou DDI + DDD + número (ex.: 5547999999999).";
  }
  return "Informe um número de WhatsApp válido com DDD e número (ex.: 47999999999) ou com DDI (ex.: 5547999999999).";
}
