# MercadoImobi

MercadoImobi é uma plataforma de pesquisa imobiliária para clientes e corretores encontrarem, filtrarem, compararem e salvarem imóveis reais em uma experiência simples e organizada.

## Funcionalidades principais

- pesquisa por cidade, bairro, estado e tipo de imóvel;
- filtros de preço, quartos, banheiros e área;
- filtro por fonte e imóveis verificados;
- ordenação por atualização, preço e área;
- comparação de imóveis;
- favoritos persistentes por usuário;
- pesquisas salvas, com opção de renomear e excluir;
- visualização detalhada antes de abrir a fonte original;
- autenticação, recuperação de senha e verificação em duas etapas;
- suporte a contas de clientes e corretores;
- integração com fontes imobiliárias autorizadas.

## Dados imobiliários

A integração ativa utiliza os anúncios oficiais de Imóveis CAIXA. A aplicação normaliza os registros, mantém um índice nacional e preserva a URL original de cada imóvel.

Novas fontes devem utilizar apenas APIs, feeds ou integrações oficialmente autorizadas. Não devem ser adicionados imóveis, preços ou disponibilidade fictícios.

## Desenvolvimento

Requisitos: Node.js 22+ e npm.

```bash
npm install
npm run dev
```

Validação de produção:

```bash
npm run lint
npm run test
npm run build
```

## Produção

A aplicação possui build Node compatível com Docker e EasyPanel.

```bash
npm run build
npm run start
```

Porta padrão: `3000`.

As credenciais e configurações privadas devem ser cadastradas no ambiente de hospedagem e nunca commitadas no repositório. Consulte `.env.example` e `DEPLOY_EASYPANEL.md`.

## Domínio previsto

`https://mercadoimobi.rdmconsultoriaimobiliaria.com.br`
