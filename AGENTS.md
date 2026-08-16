# MercadoImobi — Regras Obrigatórias de Engenharia

Estas regras são obrigatórias para qualquer agente, chatbot, IDE, automação ou desenvolvedor que altere este repositório.

## Produto

- O MercadoImobi é uma ferramenta de busca imobiliária para corretores e clientes.
- Não é CRM, ERP, funil de vendas, gestor de leads ou painel de infraestrutura.
- Não reintroduzir leads, pipeline, prospecção, exportação de leads, métricas comerciais ou funções de VPS na experiência do produto.
- Não gerar imóveis, preços, endereços, fotos, disponibilidade ou métricas fictícias.
- Todo anúncio exibido deve apontar para uma fonte real quando `source_url` estiver disponível.

## Banco de dados

- Trabalhar somente com o Supabase do MercadoImobi/Casa Conectada, projeto `rjlqylmwenhzkzmqwris`.
- Nunca modificar os projetos `uwzfgksmnqgaxtscwxow` (RM NEGOCIO IMOBILIARIO) ou `iqrnytsgwaiegddfxfjs` (CRM R2 MARKETING DIGITAL).
- Toda tabela com dados privados de usuário deve manter RLS habilitada.
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
2. `npm run lint`
3. `npm run test -- --passWithNoTests`
4. build de produção sem depender de variáveis Supabase do EasyPanel
5. iniciar `.output/server/index.mjs`
6. consultar `GET /api/public/status`
7. exigir HTTP 200, `status=operational`, `search=available`, índice com registros reais e cobertura válida
8. confirmar que nenhum `.env` privado está versionado

Se qualquer etapa falhar, corrigir e repetir todo o ciclo. Não declarar a solução pronta com etapa obrigatória falhando.

## GitHub

- `main` é a referência de produção.
- Toda alteração em código deve disparar o workflow de validação.
- Não manter scripts/workflows temporários após a correção.
- Não commitar builds, `node_modules`, `.env` ou segredos.

## EasyPanel

- Produção deve usar o `Dockerfile` da raiz, porta interna `3000` e healthcheck `/api/public/status`.
- O serviço deve acompanhar o branch `main` por Auto Deploy do GitHub ou por webhook de deploy configurado como segredo `EASYPANEL_DEPLOY_WEBHOOK`.
- Após cada deploy, validar publicamente `/api/public/status` antes de considerar a atualização concluída.
- Se o ambiente de execução não tiver acesso autenticado ao EasyPanel, não alegar que o redeploy ocorreu; deixar o código e o pipeline prontos e reportar somente essa limitação externa.

## Segurança

- Não expor stack traces, nomes de segredos, credenciais ou informações internas na interface.
- Não usar mocks/fakes em fluxos de produção.
- Erros ao usuário devem ser amigáveis; detalhes técnicos ficam apenas nos logs internos.

## Regra de conclusão

AUDITAR → CORRIGIR → TESTAR → BUILD → SMOKE TEST → VALIDAR BANCO → DEPLOY → VALIDAR PRODUÇÃO.

A etapa seguinte só pode ser considerada concluída quando a anterior estiver verde.
