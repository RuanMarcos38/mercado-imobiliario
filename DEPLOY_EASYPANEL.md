# Deploy — MercadoImobi no EasyPanel

## Arquitetura
GitHub → Docker build → EasyPanel/VPS → Node.js 22 → TanStack Start/Nitro → Supabase/Lovable Cloud.

## 1. Repositório
Use `RuanMarcos38/mercado-imobiliario`, branch `production`.

O branch `main` é usado para correções e validação. Produção deve acompanhar
somente `production` para evitar publicar código antes dos gates passarem.

## 2. Serviço no EasyPanel
Crie um **App** a partir do GitHub e selecione o `Dockerfile` da raiz.
- Porta interna: `3000`
- Healthcheck: `GET /api/public/status`
- Restart policy: sempre/recommended

## 3. Build arguments obrigatórios
As variáveis `VITE_*` entram no bundle do navegador durante o build:
- `VITE_SUPABASE_URL=https://rjlqylmwenhzkzmqwris.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key do projeto rjlqylmwenhzkzmqwris>`
- `VITE_SUPABASE_PROJECT_ID=rjlqylmwenhzkzmqwris`

## 4. Runtime environment
Configure no serviço (não no GitHub):
- `PORT=3000`
- `HOST=0.0.0.0`
- `NODE_ENV=production`
- `SUPABASE_URL=https://rjlqylmwenhzkzmqwris.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY=<publishable key do projeto rjlqylmwenhzkzmqwris>`
- `SUPABASE_PROJECT_ID=rjlqylmwenhzkzmqwris`
- `SUPABASE_SERVICE_ROLE_KEY` (somente servidor; nunca usar prefixo VITE_)

Integrações opcionais:
- `N8N_WEBHOOK_SECRET`
- `OLX_API_KEY`
- `GOOGLE_ADS_API_KEY`
- `LOVABLE_API_KEY`
- `SLACK_WEBHOOK_URL`

Quando uma integração não tiver credencial, a plataforma deve mostrar **não configurada** e continuar funcionando.

## 5. Domínio e SSL
No EasyPanel, associe o domínio ao serviço na porta `3000` e habilite HTTPS/Let's Encrypt. O DNS deve apontar para o IP público da VPS.

## 6. Validação
Após o deploy:
```bash
curl -fsS https://SEU-DOMINIO/api/public/status
```
O endpoint deve responder HTTP 200. Para considerar produção pronta:
- `status` precisa ficar `operational`;
- `database` precisa ficar `ok`;
- `search` precisa ficar `available`;
- `indexedProperties` precisa ser maior ou igual a 1000;
- `coveredStates` precisa ser `27`.

Integrações opcionais sem chave podem aparecer como `not_configured`.

Teste também:
1. Home pública.
2. Cadastro/login.
3. Dashboard autenticado.
4. Isolamento entre tenants.
5. Importação n8n somente com `x-n8n-api-key` igual a `N8N_WEBHOOK_SECRET`.

## Segurança
- Nunca versionar `.env`.
- Nunca expor `SUPABASE_SERVICE_ROLE_KEY` no frontend.
- Rotacione imediatamente qualquer segredo que tenha sido exposto anteriormente.
