# Diagnóstico de Publicação — MercadoImobi

Atualizado em 17/08/2026.

## Código

- `main` deve ser promovido para `production` somente pelo workflow obrigatório após lint, testes, auditoria, build e smoke test.
- A navegação visível permanece focada em pesquisa imobiliária, alertas, atendimento, fluxos, assistente IA, diagnóstico e fontes de imóveis.
- CRM, Facebook/Instagram, E-mail/CCA e Discador podem permanecer como rotas internas de compatibilidade, mas não fazem parte da navegação principal do MercadoImobi.
- Dashboard e Buscar imóveis usam o modo `all`; Leilões CAIXA usam exclusivamente o modo `auction`.
- A interface destaca oportunidades com desconto comprovado pela fonte e imóveis com preço por m² abaixo de comparáveis da mesma região/tipo.
- Subsídios permanecem separados e nunca compõem o preço exibido do imóvel.

## Banco / sincronização

- O índice imobiliário é a base canônica da pesquisa nacional e possui paginação para navegar por todo o inventário.
- A sincronização CAIXA registra o horário real de atualização e mantém leilões como modalidade separada.
- Fontes públicas e conectadas entram na pesquisa geral quando existem dados reais indexados.

## Validação

A versão somente é considerada pronta quando o workflow obrigatório concluir com sucesso:

- instalação limpa das dependências;
- verificação de arquivos privados;
- formatação e lint;
- suíte completa de testes, incluindo chatbot e botões críticos;
- auditoria de dependências de produção;
- build Nitro/Node;
- smoke test de `/api/public/status` e índice imobiliário real;
- promoção de `main` para `production`.

## Publicação

A aplicação publicada deve expor `/api/public/status` com JSON e `status: operational`. O domínio definitivo e o host EasyPanel precisam apontar para o serviço Node/Docker atual, sem redirecionamento para o projeto Lovable antigo.
