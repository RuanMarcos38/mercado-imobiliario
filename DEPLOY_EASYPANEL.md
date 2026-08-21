# Deploy — MercadoImobi no EasyPanel

## Arquitetura

GitHub → Docker build → EasyPanel/VPS → Node.js 22 → TanStack Start/Nitro → Supabase.

## 1. Repositório

Use `RuanMarcos38/mercado-imobiliario`, branch `production`.

O branch `main` é usado para correções e validação. Produção deve acompanhar
somente `production` para evitar publicar código antes dos gates passarem.

## 2. Serviço no EasyPanel

Crie um **App** a partir do GitHub e selecione o `Dockerfile` da raiz.

- Porta interna: `3000`
- Healthcheck: `GET /api/public/status`
- Restart policy: sempre/recommended

## 3. Supabase correto do MercadoImobi

O MercadoImobi usa exclusivamente o projeto **RM NEGOCIO IMOBILIARIO**:

- Project ID: `uwzfgksmnqgaxtscwxow`
- URL: `https://uwzfgksmnqgaxtscwxow.supabase.co`

Não usar o projeto antigo `rjlqylmwenhzkzmqwris` no EasyPanel, no build ou no runtime.
O frontend também está fixado no projeto correto para impedir que variáveis antigas de ambiente
redirecionem a autenticação para outro Supabase.

## 4. Build arguments

As variáveis `VITE_*`, quando configuradas no EasyPanel, devem apontar para o mesmo projeto:

- `VITE_SUPABASE_URL=https://uwzfgksmnqgaxtscwxow.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key do projeto uwzfgksmnqgaxtscwxow>`
- `VITE_SUPABASE_PROJECT_ID=uwzfgksmnqgaxtscwxow`

## 5. Runtime environment

Configure no serviço:

- `PORT=3000`
- `HOST=0.0.0.0`
- `NODE_ENV=production`
- `SUPABASE_URL=https://uwzfgksmnqgaxtscwxow.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY=<publishable key do projeto uwzfgksmnqgaxtscwxow>`
- `SUPABASE_PROJECT_ID=uwzfgksmnqgaxtscwxow`
- `SUPABASE_SERVICE_ROLE_KEY=<service role do projeto uwzfgksmnqgaxtscwxow>`

`SUPABASE_SERVICE_ROLE_KEY` é somente servidor e nunca pode usar prefixo `VITE_`.
Uma service-role key de outro projeto causa falhas nas rotinas administrativas mesmo quando o login do navegador funciona.

Integrações opcionais sem credencial devem aparecer como **não configurada** e não impedir login ou navegação principal.

## 6. Domínio e SSL

No EasyPanel, associe o domínio ao serviço na porta `3000` e habilite HTTPS/Let's Encrypt.
O DNS deve apontar para o IP público da VPS.

## 7. Validação

Após o deploy:

```bash
curl -fsS https://SEU-DOMINIO/api/public/status
```

Para considerar o backend principal pronto, confirme:

- `status: operational`;
- `database: ok`;
- `search: available`;
- `supabaseProjectId: uwzfgksmnqgaxtscwxow`;
- `indexedProperties >= 1000`;
- `coveredStates >= 27`.

Teste também:

1. Home pública.
2. Cadastro/login.
3. Dashboard autenticado.
4. Isolamento entre tenants.
5. Rotinas administrativas que dependem da service-role key.

## Segurança

- Nunca versionar `.env`.
- Nunca expor `SUPABASE_SERVICE_ROLE_KEY` no frontend.
- Nunca reutilizar service-role key de outro projeto Supabase.
- Rotacione imediatamente qualquer segredo que tenha sido exposto anteriormente.
