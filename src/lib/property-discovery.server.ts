type OpenAIResponse = {
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{ type?: string; url?: string; title?: string }>;
    }>;
  }>;
};

export interface DiscoveryCandidate {
  url: string;
  domain: string;
  title: string | null;
}

function validPublicUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) return null;
    if (/^(10|127|169\.254|192\.168)\./.test(hostname)) return null;
    return { url: url.toString(), hostname };
  } catch {
    return null;
  }
}

export async function discoverPublicPropertySources(input: {
  city?: string;
  state?: string;
  query?: string;
}): Promise<{ configured: boolean; candidates: DiscoveryCandidate[]; summary: string }> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) return { configured: false, candidates: [], summary: '' };
  const model = process.env['OPENAI_MODEL'] || 'gpt-5.6';
  const location = [input.city, input.state].filter(Boolean).join(' - ') || 'Brasil';
  const focus = input.query?.trim() || 'imóveis à venda e para locação';

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      tools: [{ type: 'web_search' }],
      input: [
        {
          role: 'user',
          content:
            `Pesquise na web fontes públicas e atuais de ${focus} em ${location}. ` +
            'Priorize sites oficiais de imobiliárias, construtoras e portais imobiliários. ' +
            'Não tente contornar login, CAPTCHA, bloqueio, paywall ou área privada. ' +
            'Liste somente fontes públicas relevantes que poderiam ser conectadas por API, XML, JSON, webhook ou parceria autorizada.',
        },
      ],
      store: false,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) throw new Error(`DISCOVERY_REQUEST_FAILED_${response.status}`);
  const payload = (await response.json()) as OpenAIResponse;
  const candidates = new Map<string, DiscoveryCandidate>();
  const textParts: string[] = [];

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) textParts.push(content.text.trim());
      for (const annotation of content.annotations ?? []) {
        if (annotation.type !== 'url_citation' || !annotation.url) continue;
        const publicUrl = validPublicUrl(annotation.url);
        if (!publicUrl) continue;
        const key = `${publicUrl.hostname}|${publicUrl.url}`;
        if (!candidates.has(key)) {
          candidates.set(key, {
            url: publicUrl.url,
            domain: publicUrl.hostname,
            title: annotation.title?.trim() || null,
          });
        }
      }
    }
  }

  return {
    configured: true,
    candidates: Array.from(candidates.values()).slice(0, 100),
    summary: textParts.join('\n').slice(0, 8000),
  };
}
