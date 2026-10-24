# Segurança do MercadoImobi

## Validação antes de publicar

- Instalar exclusivamente com `npm ci` e manter `package-lock.json` versionado.
- Executar formatação, lint, testes e `npm run audit:security`. A auditoria inclui dependências de execução, build e testes, e falha para qualquer severidade conhecida.
- Manter também a auditoria obrigatória de produção: `npm audit --omit=dev --audit-level=high`.
- Build, smoke test, validação real do banco e promoção para `production` devem passar no workflow obrigatório. Nunca publicar um SHA reprovado.
- Atualizações de segurança devem preservar compatibilidade e ser testadas. Não suprimir alertas, remover o gate ou usar `--force` para ignorar conflitos.

## Banco e credenciais

- Projeto exclusivo: `uwzfgksmnqgaxtscwxow`, RM NEGOCIO IMOBILIARIO.
- Toda tabela exposta precisa de RLS. As permissões de tabela e função também devem ser mínimas.
- Funções de automação e rotinas de manutenção são internas ao servidor e não devem ser executáveis por `PUBLIC`, `anon` ou `authenticated`.
- Funções legítimas de autoatendimento precisam validar `auth.uid()` e o tenant antes de consultar ou alterar dados. Funções agregadoras do catálogo público são exceções documentadas, sem acesso a contatos ou credenciais.
- `affiliate_network_stats` e `affiliate_set_sponsor` validam o próprio usuário; `get_my_tenant_user_capacity` deriva a organização de `auth.uid()`; `user_has_plan_feature` e `crm_ensure_default_pipeline` validam usuário/organização. As duas sobrecargas de `location_market_evidence` expõem agregados do catálogo imobiliário a usuários autenticados. `search_index_health` e `property_region_search_health` fornecem métricas agregadas públicas necessárias à operação. A presença dessas funções na regra genérica de `SECURITY DEFINER` deve ser avaliada pela validação efetiva, não removida indiscriminadamente.
- Tokens Meta, chaves privadas e credenciais do banco permanecem no servidor, protegidos pelo armazenamento existente. Nunca versionar `.env`, tokens ou o conteúdo do cofre de integrações.
- Verificar periodicamente os Advisors e a configuração de proteção de senhas no Supabase. Um relatório npm sem alertas não substitui a revisão de autenticação, permissões e infraestrutura.

## Templates e primeiro contato

- Somente administradores da organização podem gerenciar seus templates na WABA vinculada à conexão oficial existente.
- Submeter um template à Meta não envia mensagens a clientes. Aprovação não significa autorização do destinatário.
- O serviço de apresentação requer remetente validado, conteúdo aprovado, autorização registrada e reserva única por tenant, telefone normalizado e finalidade.
- Respostas incertas ou timeouts não liberam a reserva: não reenviar automaticamente. Preservar solicitações de interrupção e histórico.
- Campanhas e agendadores de envio não são ativados pela criação da tela de templates.

## Limite da auditoria

Nenhuma verificação permite garantir segurança absoluta. Registrar a data, versões e resultados observados, revisar novos avisos e manter os testes e o gate de publicação ativos.
