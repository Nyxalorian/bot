import {
  Client,
  Events,
  GatewayIntentBits,
  Options,
} from 'discord.js';
import { config, requireEnv } from './config.js';
import { startGoodMorningSchedule } from './services/goodMorning.js';
import { moderateGoodMorningChannelMessage } from './services/goodMorningModeration.js';

const token = requireEnv('DISCORD_TOKEN', config.token, ['BOT_TOKEN', 'TOKEN']);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 0,
    GuildMessageManager: 0,
    GuildMemberManager: 0,
    UserManager: 25,
    ReactionManager: 0,
    ReactionUserManager: 0,
    PresenceManager: 0,
    GuildInviteManager: 0,
    GuildScheduledEventManager: 0,
    GuildStickerManager: 0,
    StageInstanceManager: 0,
    ThreadMemberManager: 0,
    ThreadManager: 0,
    GuildTextThreadManager: 0,
    GuildForumThreadManager: 0,
  }),
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Zeca e Mimo online como ${readyClient.user.tag}.`);
  startGoodMorningSchedule(readyClient);
});

client.on(Events.MessageCreate, (message) => {
  if (message.author.bot) {
    return;
  }

  moderateGoodMorningChannelMessage(message).catch((error) => {
    console.error('Erro na moderacao do canal de bom dia:', error);
  });
});

registerShutdownHandlers();

client.login(token).catch((error) => {
  console.error('Falha ao iniciar o Zeca e Mimo:', error);
  process.exitCode = 1;
});

function registerShutdownHandlers() {
  let shuttingDown = false;

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;
      client.destroy();
    });
  }
}
