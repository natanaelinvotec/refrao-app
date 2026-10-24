# Refrão — música personalizada com o nome no refrão + clipe automático

Sistema completo, versão clara. **Sem dependências npm**: só Node 22+ e ffmpeg.

```
server/           API + worker (Node, sem framework externo)
  index.js        servidor HTTP, rotas, estáticos, página /m/:slug com OG tags
  lib/http.js     mini-framework (rotas, JSON, multipart, cookies, Range)
  db.js           SQLite embutido (node:sqlite) → data/refrao.db
  routes/api.js   rotas públicas (letra, músicas, prévia, fotos, clipe, checkout, webhooks, OTP, mural)
  routes/admin.js rotas da operação (login por senha)
  services/
    lyrics.js     letra por LLM (Gemini ou OpenAI-compatível) com fallback de modelo
    suno.js       geração de música (sunoapi.org / kie.ai — mesmo formato) + mock
    media.js      ffmpeg: marca d'água da prévia, clipe 9:16 com fotos e legenda, capa
    pix.js        PIX (Mercado Pago, conta PF) + webhook confirmado no provedor + mock
    whatsapp.js   Evolution API + mock
    songs.js      ciclo de vida: criação → polling → prévia → pagamento → clipe → recuperação
public/           front (HTML/CSS/JS puro, tema claro)
scripts/gen-samples.js  gera as amostras de ritmo (public/samples/*.mp3) uma vez
data/             banco, faixas, prévias, fotos, clipes (criado sozinho; faça backup desta pasta)
```

## Rodar em 1 minuto (modo teste, sem chaves)
```bash
cp .env.example .env          # edite SECRET e ADMIN_PASSWORD
MOCK_PROVIDERS=1 node --no-warnings server/index.js
# abre http://localhost:3000  — admin em /#/admin
```
Em mock: a "música" são acordes sintetizados de 40 s, o PIX tem botão "simular pagamento", o código do WhatsApp aparece no log/na tela.

## Produção
1. `.env`: `BASE_URL` (https público), `SECRET` longo, `ADMIN_PASSWORD`, `SUNO_API_KEY` (+ `SUNO_BASE_URL`), `GEMINI_API_KEY` **ou** `OPENAI_API_KEY`, `MP_ACCESS_TOKEN` (+ `MP_WEBHOOK_SECRET`), `EVOLUTION_URL/INSTANCE/API_KEY`, `SUPPORT_WHATSAPP`. Deixe `MOCK_PROVIDERS=0`.
2. Webhook do Mercado Pago → `POST {BASE_URL}/api/webhooks/pix` (evento "Pagamentos"); o servidor confirma cada aviso com GET /v1/payments antes de liberar. Callback opcional do Suno já vai em `callBackUrl`.
3. Amostras de ritmo: `npm run samples` (gera 1 música por ritmo no provedor e corta 12 s — custo único).
4. `node --no-warnings server/index.js` atrás de um proxy (Caddy/Nginx) com HTTPS, ou `docker compose up -d`.

### Docker
```bash
docker compose up -d --build     # porta 3000, dados em ./data
```

### systemd (VPS)
```
[Service]
WorkingDirectory=/opt/refrao
ExecStart=/usr/bin/node --no-warnings server/index.js
Restart=always
EnvironmentFile=/opt/refrao/.env
```

## Regras de negócio (onde mudar)
- Preços: `.env` (`PRICE_*`, `BUMP_*`), em centavos.
- Prévias grátis por WhatsApp/dispositivo: `FREE_PREVIEWS`.
- Ritmos e tags de estilo enviadas ao modelo: `server/util.js` → `RITMOS`; visual no front: `public/js/data.js` → `RITMO_UI`.
- Prompt da letra: `server/services/lyrics.js`.
- Marca d'água (intervalo/duração da prévia): `WATERMARK_EVERY`, `PREVIEW_SECONDS`.
- Plano Studio: libera 3 créditos + 30 dias (`services/songs.js` → `onPaid`). Cobrança recorrente mensal ainda não é automática — renove via novo checkout ou use assinatura no gateway.
- Recuperação de carrinho: WhatsApp 1 h depois da prévia sem pagamento (`services/songs.js` → `recovery`).

## API (resumo)
| método | rota | o que faz |
|---|---|---|
| GET | /api/config | marca, ritmos, planos, preços |
| POST | /api/lyrics | escreve a letra (LLM) |
| POST | /api/songs | cria a música (402 `PREVIEW_LIMIT` se passou do grátis) |
| GET | /api/songs/:id | status, faixas, prévia, clipe, liberação |
| GET | /api/songs/:id/preview?track=n | MP3 com marca d'água |
| GET | /api/songs/:id/download?track=n&t=token | MP3 limpo (pago) |
| POST | /api/songs/:id/photos | até 8 fotos (multipart `photos`) |
| POST | /api/songs/:id/clip · GET /clip | pedir / baixar o clipe |
| POST | /api/songs/:id/whatsapp | guardar prévia no WhatsApp (lead) |
| POST | /api/checkout · GET /api/orders/:id | PIX e situação do pedido (token de download quando pago) |
| POST | /api/webhooks/pix | aviso do Mercado Pago (confirmado no provedor) |
| POST | /api/auth/otp · /verify · GET /api/me | login por código no WhatsApp e painel |
| GET | /api/public/:slug · /api/mural | página pública e mural |
| /api/admin/* | stats, músicas, pedidos, mural, liberar, refazer |

## Segurança
Tokens de download e sessão assinados (HMAC com `SECRET`); download e clipe só com pagamento confirmado; limite de requisições nas rotas caras; uploads só JPG/PNG/WebP até 12 MB; `/api/me` só da própria sessão (não dá pra listar músicas de outro número).


## Promoção e cupom "siga e ganhe"

- **Preço de/por**: `PRICE_MUSICA` / `PRICE_CLIPE` são os valores cobrados; `PRICE_MUSICA_DE` / `PRICE_CLIPE_DE` aparecem riscados na landing e no checkout (0 desliga a promoção). Padrão: Música de R$ 14,90 por R$ 9,90; Música + clipe de R$ 24,90 por R$ 14,90; Studio R$ 49,90.
- **Cupom de seguidor** (`CUPOM_SEGUIDOR_PCT`, padrão 10%): desconta só o plano (Música e Música + clipe), nunca os extras nem o Studio; 1 uso por código; vence em `CUPOM_SEGUIDOR_DIAS`. O uso é consumido quando o PIX é confirmado.
- **Instagram (automático)**: a pessoa segue `@IG_HANDLE` e manda "CUPOM" no direct. A Meta chama `POST /api/webhooks/instagram`; o servidor consulta o perfil do remetente (`is_user_follow_business`) e responde no direct com o código. Configure no Meta for Developers: produto Instagram → Messaging, token com `instagram_basic` + `instagram_manage_messages`, webhook `messages` em `{BASE_URL}/api/webhooks/instagram` com `IG_VERIFY_TOKEN`; opcional `IG_APP_SECRET` para validar a assinatura. Quem já usou o cupom recebe um aviso em vez de outro código.
- **WhatsApp**: não há como conferir quem segue pelo WhatsApp. O bot (`POST /api/webhooks/whatsapp?token=EVOLUTION_WEBHOOK_SECRET`, evento `MESSAGES_UPSERT`) responde "cupom"/"desconto" com o passo a passo do Instagram; se a pessoa mandar um print seguindo, o admin libera o cupom no painel (aba **cupons**) e ele é enviado no WhatsApp dela.
- Rotas: `POST /api/cupom {code, plan}` valida; `POST /api/checkout` aceita `cupom`; `GET/POST /api/admin/cupons` lista e gera.

## Entrega por e-mail (lead), salvar e compartilhar

- No checkout o e-mail é obrigatório (`EMAIL_REQUIRED=1`; 0 torna opcional). Quem chega ao PIX entra na tabela `leads` (e-mail, WhatsApp, nome, música, pagou?) — painel admin → aba **leads**, com **baixar CSV** para Meta Ads / Mailchimp.
- Ao confirmar o PIX, o servidor envia o e-mail de entrega: links assinados (1 ano) + os MP3 em anexo quando cabem (`EMAIL_DELIVERY=attach|link|off`). Provedor: Resend (`RESEND_API_KEY`, domínio verificado) ou Brevo (`BREVO_API_KEY`); sem chave = mock no log. `EMAIL_FROM` define o remetente.
- Página de entrega: "Também mandamos pro seu e-mail" (cadastrar/reenviar: `POST /api/songs/:id/email`, só o dono, só música paga), "Salvar no aparelho" (download), "Compartilhar nas redes" (Instagram, TikTok e Status via compartilhamento nativo do celular com o MP4/MP3; no desktop abre o app e orienta) e os botões de link.
