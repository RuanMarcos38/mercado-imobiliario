# MercadoImobi — Regras Obrigatórias de Engenharia

Estas regras são obrigatórias para qualquer agente, chatbot, IDE, automação ou desenvolvedor que altere este repositório.

## Produto

- O MercadoImobi é uma ferramenta de busca imobiliária para corretores e clientes.
- Não é CRM, ERP, funil de vendas, gestor de leads ou painel de infraestrutura.
- Não reintroduzir leads, pipeline, prospecção, exportação de leads, métricas comerciais ou funções de VPS na experiência do produto.
- Não gerar imóveis, preços, endereços, fotos, disponibilidade ou métricas fictícias.
- Todo anúncio exibido deve apontar para uma fonte real quando `source_url` estiver disponível.

## Banco de dados

- Trabalhar somente com o Supabase RM NEGOCIO IMOBILIARIO, projeto `uwzfgksmnqgaxtscwxow`, que é o banco correto do MercadoImobi.
- Nunca modificar o projeto `iqrnytsgwaiegddfxfjs` (CRM R2 MARKETING DIGITAL) nem usar o projeto antigo `rjlqylmwenhzkzmqwris` para autenticação ou dados do MercadoImobi.
- Toda tabela pública deve manter RLS habilitada; catálogos públicos podem ter policy SELECT explícita e nunca escrita anônima.
- Favoritos e pesquisas salvas devem permanecer isolados por `auth.uid()`.
- Alterações de schema/funções/políticas devem ser registradas em `supabase/migrations`.
- Não usar `SUPABASE_SERVICE_ROLE_KEY` em código de navegador ou em arquivos versionados.

## Dados imobiliários

- `property_search_index` é o índice principal de busca.
- A integração oficial de Imóveis CAIXA deve continuar deduplicada por `source_url` e protegida contra snapshots incompletos.
- Uma atualização externa anormalmente pequena nunca pode apagar a base válida anterior.
- O healthcheck deve refletir o estado real do índice, sem métricas hardcoded.

## Verificação obrigatória antes de considerar qualquer alteração pronta

Executar, nesta ordem:

1. `npm ci`
2. confirmar que nenhum `.env` privado está versionado
3. `npm run lint`
4. `npm run test -- --passWithNoTests`
5. `npm audit --omit=dev --audit-level=high`
6. build de produção sem depender de variáveis Supabase incorretas do EasyPanel
7. iniciar `.output/server/index.mjs`
8. consultar `GET /api/public/status`
9. exigir HTTP 200, `status=operational`, `search=available`, pelo menos 1.000 imóveis indexados e cobertura das 27 UFs

Se qualquer etapa falhar, corrigir e repetir todo o ciclo. Não declarar a solução pronta com etapa obrigatória falhando.

## GitHub

- `main` recebe desenvolvimento e correções.
- `production` é a única referência liberada para produção.
- Toda alteração em `main` deve disparar o workflow obrigatório.
- O workflow só promove o SHA validado de `main` para `production` depois que todas as etapas passam.
- Uma versão com gate vermelho nunca deve avançar para `production`.
- Não manter scripts/workflows temporários após a correção.
- Não commitar builds, `node_modules`, `.env` ou segredos.

## EasyPanel

- Produção deve usar o `Dockerfile` da raiz, porta interna `3000` e healthcheck `/api/public/status`.
- O serviço deve acompanhar exclusivamente o branch `production` com Auto Deploy do GitHub.
- Não configurar o EasyPanel para deploy automático direto do `main`, porque `main` ainda pode estar em validação.
- Após cada deploy, validar publicamente `/api/public/status` antes de considerar a atualização concluída.
- Se o ambiente de execução não tiver acesso autenticado ao EasyPanel, não alegar que o redeploy ocorreu; deixar `production` pronto e reportar somente essa limitação externa.

## Segurança

- Não expor stack traces, nomes de segredos, credenciais ou informações internas na interface.
- Não usar mocks/fakes em fluxos de produção.
- Funções `SECURITY DEFINER` que escrevem, apagam ou expõem dados não podem permanecer executáveis por `anon` ou `authenticated` salvo necessidade comprovada e testada.
- Erros ao usuário devem ser amigáveis; detalhes técnicos ficam apenas nos logs internos.

## Regra de conclusão

AUDITAR → CORRIGIR → TESTAR → BUILD → SMOKE TEST → VALIDAR BANCO → PROMOVER PARA `production` → DEPLOY → VALIDAR PRODUÇÃO.

A etapa seguinte só pode ser considerada concluída quando a anterior estiver verde.
