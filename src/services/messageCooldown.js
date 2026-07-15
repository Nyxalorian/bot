import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsonStateStore } from '../utils/jsonState.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..', '..');
const stateFilePath = path.join(projectRoot, 'data', 'message-cooldowns.json');
const minimumCooldownMs = 1_000;
const maximumCooldownMs = 24 * 60 * 60 * 1000;
const stateStore = createJsonStateStore(stateFilePath, normalizeState);

export async function setMessageCooldown(guildId, userId, cooldownMs, setBy) {
  const state = await readState();
  const guildState = getGuildState(state, guildId);

  guildState.cooldowns[userId] = {
    userId,
    cooldownMs,
    lastMessageAt: new Date().toISOString(),
    setBy,
    setAt: new Date().toISOString(),
  };

  await writeState(state);
  return guildState.cooldowns[userId];
}

export async function removeMessageCooldown(guildId, userId) {
  const state = await readState();
  const guildState = getGuildState(state, guildId);
  const existing = guildState.cooldowns[userId] || null;

  if (!existing) {
    return null;
  }

  delete guildState.cooldowns[userId];
  await writeState(state);
  return existing;
}

export async function consumeMessageCooldown(message) {
  const state = await readState();
  const guildState = getGuildState(state, message.guild.id);
  const cooldown = guildState.cooldowns[message.author.id];

  if (!cooldown) {
    return { limited: false };
  }

  const now = Date.now();
  const lastMessageAt = cooldown.lastMessageAt
    ? Date.parse(cooldown.lastMessageAt)
    : 0;
  const nextAllowedAt = lastMessageAt + cooldown.cooldownMs;

  if (lastMessageAt > 0 && now < nextAllowedAt) {
    return {
      limited: true,
      remainingMs: nextAllowedAt - now,
      cooldownMs: cooldown.cooldownMs,
    };
  }

  cooldown.lastMessageAt = new Date(now).toISOString();
  await writeState(state);

  return { limited: false };
}

export function parseCooldownDuration(value) {
  const match = value.match(/^(\d+)(s|m|h)$/i);

  if (!match) {
    throw new Error('Use duracoes como `30s`, `5m` ou `1h`.');
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000;
  const cooldownMs = amount * multiplier;

  if (cooldownMs < minimumCooldownMs || cooldownMs > maximumCooldownMs) {
    throw new Error('Use um cooldown entre 1 segundo e 24 horas.');
  }

  return cooldownMs;
}

export function formatCooldownDuration(cooldownMs) {
  if (cooldownMs % 3_600_000 === 0) {
    return `${cooldownMs / 3_600_000}h`;
  }

  if (cooldownMs % 60_000 === 0) {
    return `${cooldownMs / 60_000}m`;
  }

  return `${Math.ceil(cooldownMs / 1000)}s`;
}

async function readState() {
  return stateStore.read();
}

async function writeState(state) {
  await stateStore.write(state);
}

function normalizeState(state) {
  return {
    guilds: state?.guilds && typeof state.guilds === 'object' ? state.guilds : {},
  };
}

function getGuildState(state, guildId) {
  state.guilds[guildId] ??= { cooldowns: {} };
  state.guilds[guildId].cooldowns ??= {};

  return state.guilds[guildId];
}
