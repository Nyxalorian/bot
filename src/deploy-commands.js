import { REST, Routes } from 'discord.js';
import { pathToFileURL } from 'node:url';
import { config, requireEnv } from './config.js';
import { getCommandFiles } from './utils/loaders.js';

const token = requireEnv('DISCORD_TOKEN', config.token, ['BOT_TOKEN', 'TOKEN']);
const clientId = requireEnv('DISCORD_CLIENT_ID', config.clientId, [
  'DISCORD_APPLICATION_ID',
  'APPLICATION_ID',
  'CLIENT_ID',
]);

const commands = [];
const commandFiles = await getCommandFiles();

for (const filePath of commandFiles) {
  const command = await import(pathToFileURL(filePath).href);

  if (!command.data?.toJSON) {
    throw new Error(`Comando invalido em ${filePath}`);
  }

  commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(token);
const route = config.guildId
  ? Routes.applicationGuildCommands(clientId, config.guildId)
  : Routes.applicationCommands(clientId);

await rest.put(route, { body: commands });

const target = config.guildId ? `servidor ${config.guildId}` : 'registro global';
console.log(`${commands.length} comando(s) registrado(s) no ${target}.`);
