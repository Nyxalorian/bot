# Zeca e Mimo

Bot minimo dedicado ao canal de Bom dia.

## Funcoes

- Envia diariamente, as 06:00 no fuso configurado, a mensagem `Dia N dando Bom dia Zeca e Mimo` com a imagem.
- Se estiver offline as 06:00, recupera o envio do dia assim que voltar.
- Mantem a contagem pela data inicial, portanto amanha, 22/08/2026, sera o Dia 41.
- No canal configurado, aceita somente `Bom dia Zeca e Mimo`, tolerando maiusculas, espacos extras e pontuacao simples.
- Apaga mensagens invalidas e aplica timeout de 5 minutos ao autor.

## Configuracao

Copie `.env.example` para `.env` e informe o token. Na hospedagem, configure as mesmas variaveis:

```env
DISCORD_TOKEN=coloque_o_token_aqui
GOOD_MORNING_CHANNEL_ID=1526051855480918128
GOOD_MORNING_TIME_ZONE=America/Sao_Paulo
GOOD_MORNING_START_DATE=2026-07-13
```

Ative somente o intent privilegiado **Message Content** no Discord Developer Portal. O bot precisa das permissoes **View Channel**, **Send Messages**, **Attach Files**, **Read Message History**, **Manage Messages** e **Moderate Members**.

## Execucao

```bash
npm install
npm start
```
