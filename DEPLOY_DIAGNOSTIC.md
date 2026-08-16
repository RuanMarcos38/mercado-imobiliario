# Diagnóstico de Publicação — MercadoImobi

Atualizado em 16/08/2026.

## Código

- `main` e `production` foram validados e promovidos pelo workflow obrigatório.
- Build Nitro/Node concluído com sucesso.
- Smoke test retornou `status=operational`.
- Índice: 25.407 imóveis em 27 UFs.
- Release do backend validado: `2026.08.16-search-platform-r2`.

## Banco / sincronização

- A sincronização CAIXA foi corrigida para registrar o horário real de atualização.
- O cron executa `public.refresh_caixa_property_index_tracked()` a cada hora.
- A execução atual foi registrada em `property_scan_runs`.

## Bloqueio atual de publicação

O diagnóstico externo do GitHub Actions confirmou:

1. `https://mercadoimobi.rdmconsultoriaimobiliaria.com.br/api/public/status` não está entregando o backend Node do MercadoImobi. O conteúdo retornado corresponde ao bridge estático antigo da Hostinger e contém redirecionamento para `https://mercado-imobiliario-r2r.lovable.app/`.
2. O host testado a partir da identificação visível do serviço EasyPanel, `https://r2rmarketingdigital-mercadoimobi.ke4n49.easypanel.host/api/public/status`, respondeu com página HTML `Not Found`, não com o JSON do backend MercadoImobi.
3. Portanto, os commits do GitHub estão corretos, mas a rota pública ainda não está ligada ao serviço Node/Docker atualizado.

## Configuração necessária no EasyPanel/Hostinger

- EasyPanel Source: GitHub `RuanMarcos38/mercado-imobiliario`.
- Branch: `production` (ou `main`, desde que seja a branch configurada no Auto Deploy).
- Build: `Dockerfile` na raiz.
- Porta interna: `3000`.
- Healthcheck: `/api/public/status`.
- Ativar Auto Deploy do GitHub ou usar o Deployment Trigger URL do serviço.
- Associar o domínio `mercadoimobi.rdmconsultoriaimobiliaria.com.br` ao serviço App do EasyPanel.
- Remover o arquivo/bridge estático da Hostinger que redireciona para o Lovable, ou remover o domínio dessa hospedagem antiga para que ele não intercepte o tráfego.

A aplicação só deve ser considerada publicada quando `/api/public/status` no domínio definitivo retornar JSON com `status: operational` e o marcador de release atual.
