# Zeca e Mimo

Base para o bot de Discord **Zeca e Mimo**, criada com Node.js e discord.js.

## Requisitos

- Node.js 20 ou superior
- Uma aplicacao criada no Discord Developer Portal
- Token do bot e Client ID da aplicacao

## Como configurar

1. Instale as dependencias:

```bash
npm install
```

2. Copie `.env.example` para `.env` e preencha:

```bash
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
GOOD_MORNING_CHANNEL_ID=1526051855480918128
GOOD_MORNING_TIME_ZONE=America/Sao_Paulo
HARD_BAN_MANAGER_ROLE_ID=1520801193033470083
DM_MANAGER_ROLE_ID=1520801193033470083
UNNAME_MANAGER_ROLE_ID=1520801193033470083
MESSAGE_COOLDOWN_MANAGER_ROLE_ID=1520801193033470083
MEETING_CATEGORY_ID=1519817688354914367
GUARDIAN_USER_IDS=1505932546242773162,764227139029041192
GUARDIAN_ROLE_ID=1520801193033470083
SPECIAL_ROLE_MANAGER_USER_ID=1505932546242773162
SPECIAL_ROLE_LIMIT_ROLE_ID=1526051649423147011
MEMORY_DEBUG=false
MEMORY_DEBUG_INTERVAL_MS=60000
```

Nunca coloque o token direto no codigo. No Railway, configure `DISCORD_TOKEN` e `DISCORD_CLIENT_ID` na aba **Variables** do servico.

O bot tambem aceita `BOT_TOKEN` ou `TOKEN` no lugar de `DISCORD_TOKEN`, e `DISCORD_APPLICATION_ID`, `APPLICATION_ID` ou `CLIENT_ID` no lugar de `DISCORD_CLIENT_ID`. Mesmo assim, os nomes recomendados sao `DISCORD_TOKEN` e `DISCORD_CLIENT_ID`.

3. Registre os slash commands:

```bash
npm run deploy
```

4. Inicie o bot:

```bash
npm start
```

## Railway

No Railway, o erro `Variavel de ambiente obrigatoria ausente: DISCORD_TOKEN` significa que o token do bot nao foi configurado nas variaveis do servico. Abra o projeto no Railway, entre no servico do bot, va em **Variables** e adicione:

```bash
DISCORD_TOKEN=token_do_bot
DISCORD_CLIENT_ID=id_da_aplicacao
```

Depois salve e faca um redeploy/restart do servico.

Durante desenvolvimento, preencha `DISCORD_GUILD_ID` para os comandos aparecerem rapido no servidor de teste. Quando quiser registrar globalmente, deixe esse campo vazio e rode `npm run deploy` novamente.

## Estrutura

```text
src/
  commands/          Slash commands do bot
  events/            Eventos do client do Discord
  utils/             Funcoes auxiliares
  config.js          Leitura e validacao do .env
  deploy-commands.js Registro dos slash commands
  index.js           Entrada principal do bot
```

## Comandos iniciais

- `/ping`: responde com latencia basica do bot.
- `/sobre`: mostra uma mensagem curta sobre o Zeca e Mimo.
- `!rg Zeca`: envia a imagem do RG do Zeca no canal.
- `!rg Mimo`: envia a imagem do RG do Mimo no canal.
- `!hardban @usuario`: bane o usuario e salva seus nomes como padroes de hardban. Apenas o cargo `1520801193033470083` pode usar.
- `!hardban nome`: salva um padrao e bane membros atuais com esse texto no nome. Apenas o cargo `1520801193033470083` pode usar.
- `!unhardban @usuario`: remove os padroes salvos a partir daquele usuario. Apenas o cargo `1520801193033470083` pode usar.
- `!unhardban nome`: remove um padrao de hardban. Apenas o cargo `1520801193033470083` pode usar.
- `!hardbans`: lista os padroes salvos. Qualquer pessoa pode usar.
- `!reuniao @usuario` ou `!reuniao id`: cria uma call temporaria `reuniao` na categoria `1519817688354914367`, liberada para quem chamou e para o usuario indicado.
- `!addreuniao @usuario`, `!addreuniao id` ou varios usuarios: adiciona pessoas na reuniao temporaria ativa.
- `!removereuniao @usuario`, `!removereuniao id` ou varios usuarios: remove pessoas da reuniao temporaria ativa e desconecta quem estiver na call.
- `!surge`: envia a planilha do Surge.
- `!sol`: envia a planilha do Sol.
- `!vak`: envia o link de suspensoes da Vaktovia.
- `!vultar`: envia o link de suspensoes da Vultar.
- `!dm @usuario texto` ou `!dm id texto`: envia uma unica DM anonima para o usuario indicado. Apenas o cargo `1520801193033470083` pode usar.
- `!unname @usuario` ou `!unname id`: trava o apelido atual da pessoa. Se ela mudar, o bot restaura. Apenas o cargo `1520801193033470083` pode usar.
- `!allowname @usuario` ou `!allowname id`: remove o travamento de apelido. Apenas o cargo `1520801193033470083` pode usar.
- `!message @usuario 30s` ou `!message id 30s`: limita a pessoa a mandar uma mensagem a cada 30 segundos. Apenas o cargo `1520801193033470083` pode usar.
- `!unmessage @usuario` ou `!unmessage id`: remove o cooldown de mensagens da pessoa. Apenas o cargo `1520801193033470083` pode usar.
- `!add @usuario roleId` ou respondendo uma mensagem com `!add roleId`: adiciona um cargo. Apenas `1505932546242773162` pode usar.
- `!remove @usuario roleId` ou respondendo uma mensagem com `!remove roleId`: remove um cargo. Apenas `1505932546242773162` pode usar.

Para comandos com `!`, ative o intent **Message Content** no Discord Developer Portal em **Bot > Privileged Gateway Intents**.

Para o hardban automatico, ative tambem o intent **Server Members** no Developer Portal. O bot precisa da permissao **Ban Members**, e o cargo dele deve ficar acima dos cargos que ele precisa banir.

Para as reunioes temporarias, o bot precisa das permissoes **Manage Channels** e **Move Members**. A call e apagada se ninguem entrar em 30 segundos, ou se ficar vazia por 30 segundos depois. Se alguem entrar sem permissao explicita na reuniao, inclusive administrador furando as permissoes do canal, o bot remove a pessoa da call. O `!addreuniao` e o `!removereuniao` funcionam melhor quando usados por alguem que ja tem acesso a call; se houver mais de uma reuniao ativa para a pessoa, ela deve entrar na call certa antes de usar o comando.

O Discord nao permite remover diretamente a permissao **Change Nickname** de um usuario especifico. O `!unname` faz o equivalente pratico: guarda o apelido atual e restaura automaticamente se a pessoa tentar trocar. O bot precisa da permissao **Manage Nicknames** e cargo acima do alvo.

O cooldown de mensagens apaga mensagens enviadas antes do tempo definido. O bot precisa da permissao **Manage Messages**.

O comando especial `!add`/`!remove` precisa da permissao **Manage Roles**. O bot so mexe em cargos abaixo do cargo configurado em `SPECIAL_ROLE_LIMIT_ROLE_ID` (`1526051649423147011` por padrao), e o cargo real mais alto do bot tambem precisa ficar acima do cargo que sera adicionado ou removido.

O comando `!dm` nao envia multiplas mensagens repetidas. Se alguem tentar usar um numero maior que 1, o bot recusa para evitar spam. Quando a pessoa responder a DM do bot, a resposta e encaminhada por DM para quem enviou a mensagem anonima original.

O Discord nao disponibiliza IP de usuarios para bots. O ban direto do Discord vale para o ID da conta banida; este hardban extra funciona por padroes de nome salvos em `data/hard-bans.json`, com referencia ao ID da conta original quando o padrao veio de `!hardban @usuario`.
O hardban e aplicado quando alguem entra no servidor ou altera o nome/apelido para bater com um padrao salvo.

## Bom dia automatico

O bot envia diariamente, as 06:00 no fuso `America/Sao_Paulo`, uma mensagem no canal configurado em `GOOD_MORNING_CHANNEL_ID`.

A mensagem segue o formato:

```text
Dia 1 dando Bom dia Zeca e Mimo
```

O mesmo canal tambem e moderado automaticamente: mensagens de usuarios devem ser apenas `Bom dia Zeca e Mimo` (com maiusculas/minusculas, espacos extras e pontuacao simples tolerados). Quem enviar `Mal`, ofensas como `vai se fuder`, `fds` ou `vai tomar no cu`, ou qualquer mensagem off-topic tem a mensagem apagada e recebe timeout/mute de 5 minutos.

Para essa moderacao automatica funcionar, o bot precisa das permissoes **Manage Messages** e **Moderate Members**, e o cargo dele deve ficar acima dos cargos que ele precisa mutar.

O contador fica salvo em `data/good-morning-state.json` enquanto a aplicacao roda.

## Guardiao protegido

Os usuarios configurados em `GUARDIAN_USER_IDS` sao protegidos automaticamente. Se um deles receber timeout/mute de chat, o bot remove o timeout. Se for mutado ou deafado em voz pelo servidor, o bot remove o mute/deafen de voz. Se for kickado de uma call, o bot consulta o audit log e desconecta da voz quem kickou. Se perder o cargo `GUARDIAN_ROLE_ID`, o bot adiciona o cargo de volta.

Se alguem banir um guardiao, o bot remove o banimento do guardiao, consulta o audit log e bane automaticamente o executor do banimento.

Para essa protecao funcionar, ative o intent **Server Members** no Discord Developer Portal. O codigo tambem solicita o intent de moderacao para receber eventos de banimento. O bot precisa das permissoes **Moderate Members**, **Mute Members**, **Deafen Members**, **Move Members**, **Manage Roles**, **View Audit Log** e **Ban Members**. O cargo do bot tambem precisa ficar acima do cargo protegido e acima de quem ele devera banir.

## Diagnostico de memoria

O bot usa limites conservadores de cache do `discord.js` para reduzir retencao de mensagens, membros, usuarios, reacoes e threads sem desativar as funcionalidades atuais.

Para investigar RAM em desenvolvimento ou temporariamente na hospedagem, ative:

```bash
MEMORY_DEBUG=true
MEMORY_DEBUG_INTERVAL_MS=60000
```

Quando ativo, o bot registra linhas `[memory-debug]` com RSS, heap, memoria externa, caches do Discord, listeners, comandos carregados, reunioes temporarias e timers conhecidos. O diagnostico nao registra token, conteudo de mensagens ou dados privados.

Para procurar vazamento real, compare as metricas logo apos o `ClientReady`, depois de executar comandos repetidamente, e novamente alguns minutos apos os timers/limpezas expirarem. Crescimento constante de `heapUsedMb`, caches ou `meetingRooms.activeRooms` indica algo vivo demais; RSS isolado pode ficar alto por reserva normal do Node/V8.
