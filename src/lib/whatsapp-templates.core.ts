import { z } from "zod";

export const JOINVILLE_PRESENTATION =
  "Olá, {{primeiro_nome}}! Sou Ruan Marcos de Oliveira, Corretor Imobiliário, CRECI-SC 68129F. Tenho oportunidades de imóveis em Joinville pelo programa Minha Casa, Minha Vida. Você gostaria de receber mais informações? Estou à disposição!\nSe preferir não receber mensagens, é só me avisar.";

export const templateInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^[a-z0-9_]+$/),
    body: z.string().trim().min(1).max(1024),
    exampleName: z.string().trim().min(1).max(80),
  })
  .superRefine((value, ctx) => {
    const remaining = value.body.replaceAll("{{primeiro_nome}}", "");
    if (/[{}]/.test(remaining))
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: "Use apenas a variável {{primeiro_nome}}.",
      });
  });

export function templateSubmission(input: z.infer<typeof templateInputSchema>) {
  const parsed = templateInputSchema.parse(input);
  const hasName = parsed.body.includes("{{primeiro_nome}}");
  return {
    name: parsed.name,
    language: "pt_BR",
    category: "MARKETING",
    components: [
      {
        type: "BODY",
        text: parsed.body.replaceAll("{{primeiro_nome}}", "{{1}}"),
        ...(hasName ? { example: { body_text: [[parsed.exampleName]] } } : {}),
      },
    ],
  };
}
