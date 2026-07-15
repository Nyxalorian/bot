import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';

const auditLogWindowMs = 20_000;
const auditLogAttempts = 4;
const auditLogRetryDelayMs = 750;
const voiceAuditLogAttempts = 8;
const voiceAuditLogRetryDelayMs = 1_000;
const voiceDisconnectAuditLogWindowMs = 30_000;
const handledVoiceDisconnectAuditEntryIds = new Set();
const allowedGuardianVoiceMutes = new Map();
const allowedGuardianVoiceDeafens = new Map();
const guardianVoiceStateAllowanceMs = 12 * 60 * 60 * 1000;

export function isGuardianUserId(userId) {
  return config.guardianUserIds.includes(userId);
}

export function allowGuardianVoiceDeafen(guildId, userId, channelId) {
  allowGuardianVoiceState(allowedGuardianVoiceDeafens, guildId, userId, channelId);
}

export function allowGuardianVoiceMute(guildId, userId, channelId) {
  allowGuardianVoiceState(allowedGuardianVoiceMutes, guildId, userId, channelId);
}

export function clearGuardianVoiceDeafenAllowance(guildId, userId) {
  clearGuardianVoiceStateAllowance(allowedGuardianVoiceDeafens, guildId, userId);
}

export function clearGuardianVoiceMuteAllowance(guildId, userId) {
  clearGuardianVoiceStateAllowance(allowedGuardianVoiceMutes, guildId, userId);
}

export async function removeGuardianChatMute(member) {
  if (!isGuardianUserId(member.id) || !isMemberTimedOut(member)) {
    return false;
  }

  await assertBotPermission(
    member.guild,
    PermissionFlagsBits.ModerateMembers,
    'Moderate Members',
  );

  await member.timeout(
    null,
    'Guardiao protegido: mute de chat removido automaticamente',
  );

  return true;
}

export async function restoreGuardianRole(member) {
  if (!isGuardianUserId(member.id) || member.roles.cache.has(config.guardianRoleId)) {
    return false;
  }

  const botMember = await assertBotPermission(
    member.guild,
    PermissionFlagsBits.ManageRoles,
    'Manage Roles',
  );
  const role = await fetchGuardianRole(member.guild);

  if (!role) {
    throw new Error(`Cargo guardiao ${config.guardianRoleId} nao encontrado.`);
  }

  if (role.managed) {
    throw new Error(`Cargo guardiao ${role.name} e gerenciado por integracao.`);
  }

  if (botMember.roles.highest.comparePositionTo(role) <= 0) {
    throw new Error(
      `O cargo do bot precisa ficar acima de ${role.name} para restaura-lo.`,
    );
  }

  await member.roles.add(
    role,
    'Guardiao protegido: cargo restaurado automaticamente',
  );

  return true;
}

export async function removeGuardianVoiceMute(voiceState) {
  if (
    !isGuardianUserId(voiceState.id) ||
    !voiceState.serverMute
  ) {
    return false;
  }

  if (isAllowedGuardianVoiceState(allowedGuardianVoiceMutes, voiceState)) {
    return false;
  }

  await assertBotPermission(
    voiceState.guild,
    PermissionFlagsBits.MuteMembers,
    'Mute Members',
  );

  await voiceState.setMute(
    false,
    'Guardiao protegido: mute de voz removido automaticamente',
  );

  return true;
}

export async function removeGuardianVoiceDeafen(voiceState) {
  if (
    !isGuardianUserId(voiceState.id) ||
    !voiceState.serverDeaf
  ) {
    return false;
  }

  if (isAllowedGuardianVoiceDeafen(voiceState)) {
    return false;
  }

  await assertBotPermission(
    voiceState.guild,
    PermissionFlagsBits.DeafenMembers,
    'Deafen Members',
  );

  await voiceState.setDeaf(
    false,
    'Guardiao protegido: deafen de voz removido automaticamente',
  );

  return true;
}

export async function removeGuardianVoiceMuteInGuild(guild) {
  let removedAny = false;

  for (const userId of config.guardianUserIds) {
    const voiceState = guild.voiceStates.cache.get(userId);

    if (!voiceState) {
      continue;
    }

    const removed = await removeGuardianVoiceMute(voiceState);
    removedAny ||= removed;
  }

  return removedAny;
}

export async function removeGuardianVoiceDeafenInGuild(guild) {
  let removedAny = false;

  for (const userId of config.guardianUserIds) {
    const voiceState = guild.voiceStates.cache.get(userId);

    if (!voiceState) {
      continue;
    }

    const removed = await removeGuardianVoiceDeafen(voiceState);
    removedAny ||= removed;
  }

  return removedAny;
}

export async function unbanGuardian(guild, guardianUserId) {
  assertGuardianUserId(guardianUserId);
  await assertBotPermission(guild, PermissionFlagsBits.BanMembers, 'Ban Members');
  await guild.members.unban(
    guardianUserId,
    'Guardiao protegido: banimento removido automaticamente',
  );
}

export async function findGuardianBanAuditEntry(guild, guardianUserId) {
  assertGuardianUserId(guardianUserId);
  await assertBotPermission(guild, PermissionFlagsBits.ViewAuditLog, 'View Audit Log');

  for (let attempt = 0; attempt < auditLogAttempts; attempt += 1) {
    const logs = await guild.fetchAuditLogs({
      type: AuditLogEvent.MemberBanAdd,
      limit: 5,
    });
    const entry = logs.entries.find(
      (item) =>
        item.targetId === guardianUserId &&
        Date.now() - item.createdTimestamp <= auditLogWindowMs,
    );

    if (entry) {
      return entry;
    }

    if (attempt < auditLogAttempts - 1) {
      await wait(auditLogRetryDelayMs);
    }
  }

  return null;
}

export async function findGuardianVoiceDisconnectAuditEntry(
  guild,
  guardianUserId,
  disconnectedAt = Date.now(),
) {
  assertGuardianUserId(guardianUserId);
  await assertBotPermission(guild, PermissionFlagsBits.ViewAuditLog, 'View Audit Log');

  for (let attempt = 0; attempt < voiceAuditLogAttempts; attempt += 1) {
    const logs = await guild.fetchAuditLogs({
      type: AuditLogEvent.MemberDisconnect,
      limit: 10,
    });
    const entry = logs.entries.find((item) => {
      const createdNearDisconnect =
        Math.abs(item.createdTimestamp - disconnectedAt) <= voiceDisconnectAuditLogWindowMs;

      return (
        item.executorId &&
        item.executorId !== guild.client.user?.id &&
        !handledVoiceDisconnectAuditEntryIds.has(item.id) &&
        createdNearDisconnect &&
        Number(item.extra?.count ?? 0) > 0
      );
    });

    if (entry) {
      rememberVoiceDisconnectAuditEntry(entry.id);
      return entry;
    }

    if (attempt < voiceAuditLogAttempts - 1) {
      await wait(voiceAuditLogRetryDelayMs);
    }
  }

  return null;
}

export async function banGuardianBanExecutor(guild, executorId, guardianUserId) {
  assertGuardianUserId(guardianUserId);

  if (!executorId || executorId === guild.client.user?.id) {
    return false;
  }

  await assertBotPermission(guild, PermissionFlagsBits.BanMembers, 'Ban Members');

  const executorMember = await fetchMemberIfPresent(guild, executorId);
  const reason = `Guardiao protegido: baniu ${guardianUserId}`;

  if (executorMember) {
    if (!executorMember.bannable) {
      throw new Error(
        `Nao consigo banir ${executorMember.user.tag}. Verifique cargos e permissoes.`,
      );
    }

    await executorMember.ban({ reason });
    return true;
  }

  await guild.members.ban(executorId, { reason });
  return true;
}

export async function disconnectGuardianVoiceKickExecutor(
  guild,
  executorId,
  guardianUserId,
) {
  assertGuardianUserId(guardianUserId);

  if (!executorId || executorId === guild.client.user?.id) {
    return false;
  }

  await assertBotPermission(guild, PermissionFlagsBits.MoveMembers, 'Move Members');

  const executorVoiceState = await fetchVoiceStateIfPresent(guild, executorId);

  if (!executorVoiceState?.channelId) {
    return false;
  }

  const executorVoiceChannel = await fetchChannelIfPresent(
    guild,
    executorVoiceState.channelId,
  );

  if (!executorVoiceChannel) {
    return false;
  }

  await assertBotChannelPermission(
    executorVoiceChannel,
    PermissionFlagsBits.MoveMembers,
    'Move Members',
  );

  await executorVoiceState.disconnect(
    `Guardiao protegido: desconectou ${guardianUserId} da call`,
  );

  return true;
}

export async function fetchGuardianMembers(guild) {
  const members = [];

  for (const userId of config.guardianUserIds) {
    const member = await fetchGuardianMember(guild, userId);

    if (member) {
      members.push(member);
    }
  }

  return members;
}

async function fetchGuardianMember(guild, userId) {
  try {
    return await guild.members.fetch({
      user: userId,
      cache: false,
    });
  } catch {
    return null;
  }
}

function assertGuardianUserId(userId) {
  if (!isGuardianUserId(userId)) {
    throw new Error(`Usuario ${userId} nao esta configurado como guardiao.`);
  }
}

function isMemberTimedOut(member) {
  return (
    typeof member.communicationDisabledUntilTimestamp === 'number' &&
    member.communicationDisabledUntilTimestamp > Date.now()
  );
}

async function fetchGuardianRole(guild) {
  return (
    guild.roles.cache.get(config.guardianRoleId) ??
    guild.roles.fetch(config.guardianRoleId)
  );
}

async function assertBotPermission(guild, permission, permissionName) {
  const botMember =
    guild.members.me ?? await guild.members.fetchMe({ cache: false });

  if (!botMember.permissions.has(permission)) {
    throw new Error(`Falta permissao ${permissionName}.`);
  }

  return botMember;
}

async function fetchMemberIfPresent(guild, userId) {
  try {
    return await guild.members.fetch({ user: userId, cache: false });
  } catch {
    return null;
  }
}

async function fetchVoiceStateIfPresent(guild, userId) {
  const cachedVoiceState = guild.voiceStates.cache.get(userId);

  if (cachedVoiceState?.channelId) {
    return cachedVoiceState;
  }

  try {
    return await guild.voiceStates.fetch(userId, { cache: true, force: true });
  } catch {
    return null;
  }
}

async function fetchChannelIfPresent(guild, channelId) {
  const cachedChannel = guild.channels.cache.get(channelId);

  if (cachedChannel) {
    return cachedChannel;
  }

  try {
    return await guild.channels.fetch(channelId);
  } catch {
    return null;
  }
}

async function assertBotChannelPermission(channel, permission, permissionName) {
  const botMember =
    channel.guild.members.me ?? await channel.guild.members.fetchMe({ cache: false });

  if (!channel.permissionsFor(botMember)?.has(permission)) {
    throw new Error(`Falta permissao ${permissionName} na call ${channel.id}.`);
  }

  return botMember;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function rememberVoiceDisconnectAuditEntry(entryId) {
  handledVoiceDisconnectAuditEntryIds.add(entryId);

  const timeout = setTimeout(() => {
    handledVoiceDisconnectAuditEntryIds.delete(entryId);
  }, auditLogWindowMs);

  timeout.unref?.();
}

function isAllowedGuardianVoiceDeafen(voiceState) {
  return isAllowedGuardianVoiceState(allowedGuardianVoiceDeafens, voiceState);
}

function isAllowedGuardianVoiceState(allowances, voiceState) {
  const allowed = allowances.get(getGuardianVoiceStateKey(voiceState.guild.id, voiceState.id));
  return Boolean(allowed && allowed.channelId === voiceState.channelId);
}

function allowGuardianVoiceState(allowances, guildId, userId, channelId) {
  if (!isGuardianUserId(userId)) {
    return;
  }

  const key = getGuardianVoiceStateKey(guildId, userId);
  const existing = allowances.get(key);

  if (existing?.timeout) {
    clearTimeout(existing.timeout);
  }

  const timeout = setTimeout(() => {
    allowances.delete(key);
  }, guardianVoiceStateAllowanceMs);
  timeout.unref?.();

  allowances.set(key, { channelId, timeout });
}

function clearGuardianVoiceStateAllowance(allowances, guildId, userId) {
  const key = getGuardianVoiceStateKey(guildId, userId);
  const existing = allowances.get(key);

  if (existing?.timeout) {
    clearTimeout(existing.timeout);
  }

  allowances.delete(key);
}

function getGuardianVoiceStateKey(guildId, userId) {
  return `${guildId}:${userId}`;
}
