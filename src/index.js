import { config, requireEnv } from './config.js';
import { startMemoryDiagnostics } from './services/memoryDiagnostics.js';
import { loadCommands, loadEvents } from './utils/loaders.js';

main().catch((error) => {
  console.error('Falha ao iniciar o Zeca e Mimo:', error);
  process.exit(1);
});

async function main() {
  const token = requireEnv('DISCORD_TOKEN', config.token);
  const { Client, Collection, GatewayIntentBits, Options, Partials } = await import('discord.js');

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 0,
      GuildMessageManager: 0,
      DMMessageManager: 0,
      GuildMemberManager: {
        maxSize: 100,
        keepOverLimit: shouldKeepMemberCached,
      },
      UserManager: {
        maxSize: 100,
        keepOverLimit: shouldKeepUserCached,
      },
      ReactionManager: 0,
      ReactionUserManager: 0,
      PresenceManager: 0,
      GuildInviteManager: 0,
      GuildScheduledEventManager: 0,
      GuildStickerManager: 0,
      StageInstanceManager: 0,
      ThreadMemberManager: 0,
      ThreadManager: 25,
      GuildTextThreadManager: 25,
      GuildForumThreadManager: 25,
    }),
    partials: [Partials.Channel],
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: {
        interval: 300,
        lifetime: 60,
      },
      guildMembers: {
        interval: 120,
        filter: () => (member) => !shouldKeepMemberCached(member),
      },
      users: {
        interval: 120,
        filter: () => (user) => !shouldKeepUserCached(user),
      },
    },
  });

  client.commands = new Collection();
  registerShutdownHandlers(client);

  await loadCommands(client);
  await loadEvents(client);
  startMemoryDiagnostics(client);

  const memory = process.memoryUsage();
  console.log(
    `Iniciando Zeca e Mimo | Node ${process.version} | RSS ${toMb(memory.rss)} MB | Heap ${toMb(memory.heapUsed)} MB`,
  );

  await client.login(token);
}

function toMb(bytes) {
  return Math.round(bytes / 1024 / 1024);
}

function shouldKeepMemberCached(member) {
  return (
    member.id === member.client.user?.id ||
    config.guardianUserIds.includes(member.id) ||
    Boolean(member.voice?.channelId)
  );
}

function shouldKeepUserCached(user) {
  return (
    user.id === user.client.user?.id ||
    config.guardianUserIds.includes(user.id)
  );
}

function registerShutdownHandlers(client) {
  let shuttingDown = false;

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;
      console.warn(`Recebi ${signal}; encerrando o Zeca e Mimo com seguranca.`);
      client.destroy();
      process.exit(0);
    });
  }
}
