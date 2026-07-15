import { fileURLToPath, pathToFileURL } from 'node:url';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..');
const commandsDir = path.join(rootDir, 'commands');
const eventsDir = path.join(rootDir, 'events');

export async function getCommandFiles() {
  return getJavaScriptFiles(commandsDir);
}

export async function loadCommands(client) {
  const commandFiles = await getCommandFiles();

  for (const filePath of commandFiles) {
    const command = await import(pathToFileURL(filePath).href);

    if (!command.data?.name || typeof command.execute !== 'function') {
      throw new Error(`Comando invalido em ${filePath}`);
    }

    client.commands.set(command.data.name, command);
  }
}

export async function loadEvents(client) {
  const eventFiles = await getJavaScriptFiles(eventsDir);

  for (const filePath of eventFiles) {
    const event = await import(pathToFileURL(filePath).href);

    if (!event.name || typeof event.execute !== 'function') {
      throw new Error(`Evento invalido em ${filePath}`);
    }

    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client));
      continue;
    }

    client.on(event.name, (...args) => event.execute(...args, client));
  }
}

async function getJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return getJavaScriptFiles(entryPath);
      }

      return entry.isFile() && entry.name.endsWith('.js') ? entryPath : [];
    }),
  );

  return files.flat();
}
