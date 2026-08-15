# ANTIGRAVITY TASK — FINALIZAÇÃO AUTÔNOMA DO MERCADOIMOBI

## MISSÃO

Assuma ESTE repositório existente (`RuanMarcos38/mercado-imobiliario`). Não recrie o projeto do zero.

Atue como arquiteto full-stack sênior, backend engineer, frontend engineer, Supabase/PostgreSQL engineer, especialista em segurança, UX/UI imobiliário, integrações, QA e DevOps.

O objetivo é revisar, corrigir, completar, testar e deixar o MercadoImobi pronto para produção como **ferramenta profissional de busca de imóveis**, e NÃO como CRM.

Domínio final: `https://mercadoimobi.rdmconsultoriaimobiliaria.com.br`

## EXECUÇÃO AUTÔNOMA

Trabalhe de ponta a ponta sem parar para pedir confirmação a cada etapa. Só peça informação quando houver bloqueio externo real que não possa ser resolvido a partir do repositório, ambiente, terminal ou navegador.

Fluxo obrigatório:

AUDITAR → CORRIGIR → IMPLEMENTAR → INTEGRAR → LIMPAR → TESTAR → CORRIGIR NOVAMENTE → BUILD DE PRODUÇÃO → TESTE FINAL.

Não entregue somente análise. Faça mudanças reais no código.

## REGRAS CRÍTICAS

1. Não transformar o produto em CRM.
2. Remover rotas, menus, telas e termos de CRM, funil, lead, prospecção, pipeline, follow-up, metas e gestão comercial.
3. Não expor termos técnicos para o usuário final: backend, frontend, API, endpoint, webhook, Supabase, PostgreSQL, N8N, Docker, Nginx, SSH, VPS, EasyPanel, Node.js, GitHub, RLS, Cron, Trigger, Service Role, variáveis de ambiente, stack traces e logs técnicos.
4. Mensagens ao usuário devem ser simples e amigáveis.
5. Não usar imóveis fictícios, preços inventados, fotos falsas, dados randômicos ou mocks em produção.
6. Preservar a integração real de Imóveis CAIXA já existente e validar seu funcionamento.
7. Não implementar scraping ilegal, bypass de CAPTCHA ou quebra de proteção de terceiros. Somente APIs, feeds, integrações ou métodos oficialmente permitidos.
8. Não alterar outros projetos Supabase do proprietário. Trabalhar SOMENTE com o Supabase vinculado a este projeto MercadoImobi/Casa Conectada. Não modificar `RM NEGOCIO IMOBILIARIO` nem `CRM R2 MARKETING DIGITAL`.
9. Nunca colocar `SUPABASE_SERVICE_ROLE_KEY` no frontend.
10. Não apagar banco, usuários ou dados válidos sem necessidade técnica comprovada.

## EXPERIÊNCIA DO PRODUTO

O usuário deve entrar e seguir este fluxo:

ENTRAR → PESQUISAR → FILTRAR → VER RESULTADOS REAIS → ABRIR DETALHES → COMPARAR → FAVORITAR → SALVAR PESQUISA → ABRIR ANÚNCIO ORIGINAL.

A interface precisa ser premium, minimalista, moderna, imobiliária e simples para corretores, compradores e investidores.

Hero principal deve priorizar a busca.

## BUSCA

Garantir filtros reais por:

- Estado
- Cidade
- Bairro
- Tipo do imóvel
- Finalidade
- Preço mínimo/máximo
- Quartos
- Banheiros
- Área mínima/máxima
- Verificado
- Fonte
- Ordenação

Ordenações:

- Mais recentes
- Menor preço
- Maior preço
- Maior área
- Melhores oportunidades somente quando houver dados suficientes para cálculo real

Adicionar `Limpar filtros`.

Não baixar milhares de registros externos a cada clique. Usar índice local + atualização de fonte quando tecnicamente viável + cache.

## RESULTADOS

Cada card mostra somente campos reais existentes:

- imagem, se a fonte fornecer
- tipo
- cidade/UF
- bairro
- preço
- quartos
- banheiros
- área
- fonte
- data de atualização
- indicador de origem verificada quando aplicável

Se um campo não existir, ocultá-lo. Não inventar valores.

## DETALHES DO IMÓVEL

Garantir página/modal de detalhes com título, preço, localização, características, descrição, modalidade de venda, financiamento, área, fonte e última atualização quando disponíveis.

Botão principal: `Ver anúncio original` usando `source_url`, com `target="_blank"` e `rel="noopener noreferrer"`.

## COMPARAÇÃO

Permitir comparar até 3 imóveis por preço, área, preço/m² quando calculável, quartos, banheiros, cidade, bairro, tipo e fonte.

## FAVORITOS

Implementar favoritos persistentes por usuário, com isolamento via RLS. Usuário A nunca pode visualizar favoritos de usuário B.

## PESQUISAS SALVAS

Permitir salvar, executar novamente, renomear e excluir pesquisas. Persistência por usuário autenticado.

## AUTENTICAÇÃO

Auditar e corrigir cadastro, login, logout, recuperação de senha, sessão, redirecionamentos e proteção de rotas. Não permitir loading infinito nem loops de login.

## SEGURANÇA / BANCO

Auditar RLS, tokens, variáveis, SQL injection, XSS, open redirect, CORS, rotas privadas e mensagens que vazem dados sensíveis.

Imóveis indexados podem ser públicos conforme a lógica da aplicação. Dados privados de usuário não podem usar política aberta indiscriminadamente.

Revisar tabelas necessárias, mantendo estrutura compatível com:

- `properties`
- `property_search_index`
- `favorites`
- `search_configurations`
- `profiles`

Criar migrations seguras quando necessário.

Adicionar/validar índices PostgreSQL úteis para pesquisa: `location_state`, `location_city`, `property_type`, `price`, `bedrooms`, `bathrooms`, `source_portal`, `scanned_at` e índices compostos quando fizer sentido.

## FONTES REAIS

Preservar e validar a integração já existente com Imóveis CAIXA:

- coleta por UF
- normalização
- indexação
- atualização
- `source_url`
- `source_portal`
- filtros
- deduplicação
- proteção contra snapshot incompleto

Se uma atualização retornar quantidade anormalmente baixa ou incompleta, NÃO apagar a base válida anterior.

Arquitetura deve permitir novas fontes autorizadas, como XML, JSON, APIs de construtoras, imobiliárias e parceiros.

## BACKEND REAL

Remover do fluxo principal qualquer uso de `Math.random`, `setTimeout` simulando processamento, fakeSuccess, fakeMetrics, mocks ou dados hardcoded de produção.

Toda funcionalidade principal deve usar banco real, autenticação real e dados reais.

## UX / DESIGN

Reformular o layout para parecer um buscador imobiliário premium, não ERP/CRM/admin.

Revisar desktop e mobile: 1920, 1440, 1366, 1024, 768, 430, 390 e 375 px.

Sem textos cortados, sobreposição, scroll horizontal desnecessário, botões escondidos ou cards quebrados.

Usar skeleton/loading elegante e estados vazios reais.

Se não houver resultado, mostrar mensagem amigável e opções para limpar filtros/alterar localização/faixa de preço.

Se uma fonte falhar, não derrubar toda a busca; usar índice disponível e mostrar mensagem não técnica.

## PRODUÇÃO

Manter compatibilidade com Node.js + Docker + EasyPanel.

Porta: `3000`
Host: `0.0.0.0`

Validar:

- `package.json`
- scripts `build` e `start`
- `Dockerfile`
- `.dockerignore`
- `.gitignore`
- ausência de `.env` e segredos no Git
- ausência de `localhost`, `127.0.0.1`, previews e URLs antigas hardcoded em produção

Manter healthcheck interno `/api/public/status`.

## SEO E ACESSIBILIDADE

Configurar title, description, canonical, Open Graph, favicon, robots e sitemap quando aplicável.

Título sugerido: `MercadoImobi | Busca Inteligente de Imóveis`.

Revisar labels, contraste, foco, teclado, aria-label, alt de imagens, botões e inputs.

## TESTES OBRIGATÓRIOS

Testar:

- cadastro
- login
- logout
- sessão
- recuperação de senha
- pesquisa sem filtros
- pesquisa por UF
- pesquisa por cidade
- pesquisa por preço
- pesquisa por quartos
- ordenação
- anúncio original
- favoritar/desfavoritar
- pesquisas salvas
- comparação
- responsividade
- erro de fonte
- estado vazio
- acesso não autenticado
- isolamento de usuários

Executar no terminal:

```bash
npm install
npm run lint
npm run test
npm run build
```

Corrigir qualquer erro encontrado. Não considerar warnings críticos como concluídos.

Depois do build, iniciar a aplicação quando o ambiente permitir e testar `GET /` e `GET /api/public/status`, login, busca e console do navegador.

## CRITÉRIO DE CONCLUSÃO

Não finalizar a tarefa até que:

- frontend compile
- backend compile
- autenticação funcione
- banco esteja conectado
- busca retorne dados reais
- filtros funcionem
- links dos imóveis funcionem
- favoritos persistam
- pesquisas salvas persistam
- comparação funcione
- RLS esteja correta
- não existam imóveis fictícios
- não existam mocks no fluxo principal
- não exista aparência de CRM
- não existam informações técnicas desnecessárias na interface
- desktop e mobile estejam revisados
- lint passe
- testes principais passem
- build passe
- Docker esteja válido
- projeto esteja pronto para publicação

## RELATÓRIO FINAL

Somente depois de executar tudo, apresentar:

- Status final
- Correções realizadas
- Funcionalidades implementadas
- Fontes reais ativas
- Banco
- Autenticação
- Busca
- Testes
- Build
- Deploy
- Pendências externas reais

Nunca declarar `100% funcionando` sem teste real e nunca declarar `deploy concluído` sem acesso real à infraestrutura.
