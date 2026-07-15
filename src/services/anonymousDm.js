import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmbed, errorEmbed, successEmbed } from '../utils/embeds.js';
import { createJsonStateStore } from '../utils/jsonState.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..', '..');
const stateFilePath = path.join(projectRoot, 'data', 'anonymous-dm-routes.json');
const routeTtlMs = 24 * 60 * 60 * 1000;
const stateStore = createJsonStateStore(stateFilePath, normalizeState);

export async function registerAnonymousDmRoute({ recipientId, senderId }) {
  const state = await readState();
  const pruned = pruneExpiredRoutes(state);

  state.routes[recipientId] = {
    senderId,
    recipientId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + routeTtlMs).toISOString(),
  };

  await writeState(state);

  if (pruned > 0) {
    console.log(`Rotas de DM anonima expiradas removidas: ${pruned}.`);
  }
}

export async function forwardAnonymousDmReply(message) {
  const route = await getActiveRoute(message.author.id);

  if (!route) {
    return false;
  }

  const replyText = getForwardableMessageText(message);

  if (!replyText) {
    await message.reply({
      embeds: [
        errorEmbed(
          'Resposta vazia',
          'Nao consegui encaminhar essa resposta.',
        ),
      ],
    });
    return true;
  }

  const sender = await message.client.users.fetch(route.senderId);
  await sender.send({
    embeds: [
      createEmbed({
        title: 'Resposta recebida',
        description: replyText,
        color: 'info',
      }),
    ],
  });
  await message.reply({
    embeds: [successEmbed('Resposta enviada', 'Sua resposta foi encaminhada.')],
  });

  return true;
}

async function getActiveRoute(recipientId) {
  const state = await readState();
  let pruned = pruneExpiredRoutes(state);
  const route = state.routes[recipientId];

  if (!route) {
    if (pruned > 0) {
      await writeState(state);
    }

    return null;
  }

  if (Date.parse(route.expiresAt) <= Date.now()) {
    delete state.routes[recipientId];
    pruned += 1;
    await writeState(state);
    return null;
  }

  if (pruned > 0) {
    await writeState(state);
  }

  return route;
}

function pruneExpiredRoutes(state) {
  const now = Date.now();
  let removed = 0;

  for (const [recipientId, route] of Object.entries(state.routes)) {
    if (Date.parse(route.expiresAt) > now) {
      continue;
    }

    delete state.routes[recipientId];
    removed += 1;
  }

  return removed;
}

function getForwardableMessageText(message) {
  const parts = [];
  const content = message.content.trim();

  if (content) {
    parts.push(content);
  }

  if (message.attachments.size > 0) {
    parts.push(
      ...message.attachments.map((attachment) => attachment.url),
    );
  }

  return parts.join('\n');
}

async function readState() {
  return stateStore.read();
}

async function writeState(state) {
  await stateStore.write(state);
}

function normalizeState(state) {
  return {
    routes: state?.routes && typeof state.routes === 'object' ? state.routes : {},
  };
}
