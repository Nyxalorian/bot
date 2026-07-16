import { AuditLogEvent, ChannelType, EmbedBuilder } from 'discord.js';
import { config } from '../config.js';

const messageSnapshots = new Map();
const maxMessageSnapshots = 2000;
const messageSnapshotTtlMs = 24 * 60 * 60 * 1000;
const maxLoggedContentLength = 900;
const maxLoggedAttachments = 10;
const auditLogLookupWindowMs = 15_000;
const auditLogLookupLimit = 8;

export function rememberMessageForAuditLog(message) {
  if (!message.guild || message.author?.bot) {
    return;
  }

  rememberMessageSnapshot(createSnapshotFromMessage(message));
}

export async function logDeletedMessage(message) {
  if (!message.guild) {
    return;
  }

  const snapshot = messageSnapshots.get(message.id) ?? createSnapshotFromMessage(message);
  messageSnapshots.delete(message.id);

  const fields = [
    { name: 'Autor', value: formatUser(snapshot.authorId, snapshot.authorTag), inline: true },
    { name: 'Canal', value: `<#${snapshot.channelId}>`, inline: true },
    { name: 'Mensagem ID', value: snapshot.id, inline: true },
  ];

  if (snapshot.content) {
    fields.push({
      name: 'Conteudo apagado',
      value: codeBlock(snapshot.content),
      inline: false,
    });
  }

  if (snapshot.attachments.length > 0) {
    fields.push({
      name: 'Imagens/arquivos apagados',
      value: formatAttachments(snapshot.attachments),
      inline: false,
    });
  }

  if (!snapshot.content && snapshot.attachments.length === 0) {
    fields.push({
      name: 'Conteudo',
      value: 'Nao consegui recuperar o conteudo. A mensagem nao estava no cache local do bot.',
      inline: false,
    });
  }

  await sendAuditLog(message.client, {
    title: 'Mensagem apagada',
    color: 0xef4444,
    fields,
  });
}

export async function logEditedMessage(oldMessage, newMessage) {
  if (!newMessage.guild || newMessage.author?.bot) {
    return;
  }

  const before =
    messageSnapshots.get(newMessage.id) ??
    createSnapshotFromMessage(oldMessage);
  const after = createSnapshotFromMessage(newMessage);
  const contentChanged = before.content !== after.content;
  const attachmentsChanged =
    getAttachmentSignature(before.attachments) !==
    getAttachmentSignature(after.attachments);

  rememberMessageSnapshot(after);

  if (!contentChanged && !attachmentsChanged) {
    return;
  }

  const fields = [
    { name: 'Autor', value: formatUser(after.authorId, after.authorTag), inline: true },
    { name: 'Canal', value: `<#${after.channelId}>`, inline: true },
    { name: 'Mensagem ID', value: after.id, inline: true },
  ];

  if (after.url) {
    fields.push({ name: 'Link', value: after.url, inline: false });
  }

  if (contentChanged) {
    fields.push(
      {
        name: 'Antes',
        value: before.content
          ? codeBlock(before.content)
          : 'Sem texto registrado ou mensagem fora do cache local.',
        inline: false,
      },
      {
        name: 'Depois',
        value: after.content ? codeBlock(after.content) : 'Sem texto.',
        inline: false,
      },
    );
  }

  if (attachmentsChanged) {
    fields.push(
      {
        name: 'Anexos antes',
        value: before.attachments.length > 0
          ? formatAttachments(before.attachments)
          : 'Sem anexos.',
        inline: false,
      },
      {
        name: 'Anexos depois',
        value: after.attachments.length > 0
          ? formatAttachments(after.attachments)
          : 'Sem anexos.',
        inline: false,
      },
    );
  }

  await sendAuditLog(newMessage.client, {
    title: 'Mensagem editada',
    color: 0xf59e0b,
    fields,
  });
}

export async function logMemberJoin(member) {
  await sendAuditLog(member.client, {
    title: 'Entrada no servidor',
    color: 0x22c55e,
    fields: [
      { name: 'Usuario', value: formatUser(member.id, member.user.tag), inline: true },
      { name: 'Servidor', value: member.guild.name, inline: true },
      { name: 'Conta criada', value: formatTimestamp(member.user.createdTimestamp), inline: true },
      { name: 'Usuario ID', value: inlineCode(member.id), inline: true },
    ],
  });
}

export async function logMemberLeave(member) {
  await sendAuditLog(member.client, {
    title: 'Saida do servidor',
    color: 0xef4444,
    fields: [
      { name: 'Usuario', value: formatUser(member.id, member.user.tag), inline: true },
      { name: 'Servidor', value: member.guild.name, inline: true },
      { name: 'Entrou em', value: formatTimestamp(member.joinedTimestamp), inline: true },
      { name: 'Cargos ao sair', value: formatMemberRoles(member), inline: false },
    ],
  });
}

export async function logMemberNameChange(client, oldMember, newMember) {
  const changes = [];

  if (oldMember.nickname !== newMember.nickname) {
    changes.push({
      name: 'Apelido',
      before: oldMember.nickname || 'Sem apelido',
      after: newMember.nickname || 'Sem apelido',
    });
  }

  if (oldMember.displayName !== newMember.displayName) {
    changes.push({
      name: 'Nome exibido',
      before: oldMember.displayName,
      after: newMember.displayName,
    });
  }

  if (changes.length === 0) {
    return;
  }

  const fields = [
    { name: 'Usuario', value: formatUser(newMember.id, newMember.user.tag), inline: true },
    { name: 'Servidor', value: newMember.guild.name, inline: true },
    ...changes.map((change) => ({
      name: change.name,
      value: `Antes: ${inlineCode(change.before)}\nDepois: ${inlineCode(change.after)}`,
      inline: false,
    })),
  ];
  const entry = await findRecentAuditLogEntry(newMember.guild, AuditLogEvent.MemberUpdate, {
    targetId: newMember.id,
  });

  addAuditExecutorFields(fields, entry);

  await sendAuditLog(client, {
    title: 'Nome alterado',
    color: 0xf59e0b,
    fields,
  });
}

export async function logMemberRoleChange(client, oldMember, newMember) {
  const oldRoleIds = getMemberRoleIds(oldMember);
  const newRoleIds = getMemberRoleIds(newMember);
  const addedRoleIds = [...newRoleIds].filter((roleId) => !oldRoleIds.has(roleId));
  const removedRoleIds = [...oldRoleIds].filter((roleId) => !newRoleIds.has(roleId));

  if (addedRoleIds.length === 0 && removedRoleIds.length === 0) {
    return;
  }

  const fields = [
    { name: 'Usuario', value: formatUser(newMember.id, newMember.user.tag), inline: true },
    { name: 'Servidor', value: newMember.guild.name, inline: true },
  ];

  if (addedRoleIds.length > 0) {
    fields.push({
      name: 'Cargos adicionados',
      value: formatRoleIds(newMember.guild, addedRoleIds),
      inline: false,
    });
  }

  if (removedRoleIds.length > 0) {
    fields.push({
      name: 'Cargos removidos',
      value: formatRoleIds(newMember.guild, removedRoleIds),
      inline: false,
    });
  }

  const entry = await findRecentAuditLogEntry(newMember.guild, AuditLogEvent.MemberRoleUpdate, {
    targetId: newMember.id,
  });

  addAuditExecutorFields(fields, entry);

  await sendAuditLog(client, {
    title: 'Cargos alterados',
    color: 0x8b5cf6,
    fields,
  });
}

export async function logUserNameChange(client, oldUser, newUser) {
  const changes = [];

  if (oldUser.username !== newUser.username) {
    changes.push({
      name: 'Nome de usuario',
      before: oldUser.username,
      after: newUser.username,
    });
  }

  if (oldUser.globalName !== newUser.globalName) {
    changes.push({
      name: 'Nome global',
      before: oldUser.globalName || 'Sem nome global',
      after: newUser.globalName || 'Sem nome global',
    });
  }

  if (oldUser.tag !== newUser.tag) {
    changes.push({
      name: 'Tag',
      before: oldUser.tag,
      after: newUser.tag,
    });
  }

  if (changes.length === 0) {
    return;
  }

  await sendAuditLog(client, {
    title: 'Nome de usuario alterado',
    color: 0xf59e0b,
    fields: [
      { name: 'Usuario', value: formatUser(newUser.id, newUser.tag), inline: true },
      ...changes.map((change) => ({
        name: change.name,
        value: `Antes: ${inlineCode(change.before)}\nDepois: ${inlineCode(change.after)}`,
        inline: false,
      })),
    ],
  });
}

export async function logChannelCreate(channel) {
  if (!channel.guild) {
    return;
  }

  const fields = getChannelBaseFields(channel);
  const entry = await findRecentAuditLogEntry(channel.guild, AuditLogEvent.ChannelCreate, {
    targetId: channel.id,
  });

  addAuditExecutorFields(fields, entry);

  await sendAuditLog(channel.client, {
    title: 'Canal criado',
    color: 0x22c55e,
    fields,
  });
}

export async function logChannelDelete(channel) {
  if (!channel.guild) {
    return;
  }

  const fields = getChannelBaseFields(channel);
  const entry = await findRecentAuditLogEntry(channel.guild, AuditLogEvent.ChannelDelete, {
    targetId: channel.id,
  });

  addAuditExecutorFields(fields, entry);

  await sendAuditLog(channel.client, {
    title: 'Canal apagado',
    color: 0xef4444,
    fields,
  });
}

export async function logChannelUpdate(oldChannel, newChannel) {
  if (!newChannel.guild) {
    return;
  }

  const changes = getChannelChanges(oldChannel, newChannel);

  if (changes.length === 0) {
    return;
  }

  const fields = [
    ...getChannelBaseFields(newChannel),
    ...changes.map((change) => ({
      name: change.name,
      value: `Antes: ${change.before}\nDepois: ${change.after}`,
      inline: false,
    })),
  ];
  const entry = await findRecentAuditLogEntry(newChannel.guild, AuditLogEvent.ChannelUpdate, {
    targetId: newChannel.id,
  });

  addAuditExecutorFields(fields, entry);

  await sendAuditLog(newChannel.client, {
    title: 'Canal alterado',
    color: 0xf59e0b,
    fields,
  });
}

export async function logInviteCreate(invite) {
  if (!invite.guild) {
    return;
  }

  await sendAuditLog(invite.client, {
    title: 'Convite criado',
    color: 0x38bdf8,
    fields: [
      { name: 'Codigo', value: inlineCode(invite.code), inline: true },
      { name: 'Canal', value: invite.channel ? formatChannel(invite.channel) : 'Canal desconhecido', inline: true },
      {
        name: 'Criado por',
        value: invite.inviter
          ? formatUser(invite.inviter.id, invite.inviter.tag)
          : 'Usuario desconhecido',
        inline: true,
      },
      { name: 'Expira em', value: formatInviteExpiration(invite), inline: true },
      { name: 'Usos maximos', value: invite.maxUses ? String(invite.maxUses) : 'Ilimitado', inline: true },
      { name: 'Temporario', value: formatBoolean(invite.temporary), inline: true },
      { name: 'URL', value: invite.url || `https://discord.gg/${invite.code}`, inline: false },
    ],
  });
}

export async function logVoiceChannelChange(oldState, newState) {
  if (oldState.channelId === newState.channelId) {
    return;
  }

  const guild = newState.guild ?? oldState.guild;
  const member = newState.member ?? oldState.member;

  if (!guild || !member) {
    return;
  }

  const fields = [
    { name: 'Usuario', value: formatUser(member.id, member.user.tag), inline: true },
    { name: 'Servidor', value: guild.name, inline: true },
  ];

  let title = 'Canal de voz alterado';
  let color = 0xf59e0b;

  if (!oldState.channelId && newState.channelId) {
    title = 'Entrada em canal de voz';
    color = 0x22c55e;
    fields.push({ name: 'Canal', value: formatChannelId(newState.channelId), inline: true });
  } else if (oldState.channelId && !newState.channelId) {
    title = 'Saida de canal de voz';
    color = 0xef4444;
    fields.push({ name: 'Canal', value: formatChannelId(oldState.channelId), inline: true });
  } else {
    fields.push(
      { name: 'Antes', value: formatChannelId(oldState.channelId), inline: true },
      { name: 'Depois', value: formatChannelId(newState.channelId), inline: true },
    );
  }

  await sendAuditLog(guild.client, {
    title,
    color,
    fields,
  });
}

export async function logCommandUsage({
  client,
  user,
  guild = null,
  channel = null,
  command,
  details = null,
}) {
  const fields = [
    { name: 'Usuario', value: formatUser(user.id, user.tag), inline: true },
    { name: 'Comando', value: inlineCode(command), inline: true },
  ];

  if (guild) {
    fields.push({ name: 'Servidor', value: guild.name, inline: true });
  }

  if (channel) {
    fields.push({ name: 'Canal', value: `${channel}`, inline: true });
  }

  if (details) {
    fields.push({
      name: 'Detalhes',
      value: truncateText(details, 1024),
      inline: false,
    });
  }

  await sendAuditLog(client, {
    title: 'Comando usado',
    color: 0x38bdf8,
    fields,
  });
}

export async function logBotTimeout({ client, member, durationMs, reason }) {
  await sendAuditLog(client, {
    title: 'Timeout aplicado pelo bot',
    color: 0xef4444,
    fields: [
      { name: 'Usuario', value: formatUser(member.id, member.user.tag), inline: true },
      { name: 'Duracao', value: formatDuration(durationMs), inline: true },
      { name: 'Servidor', value: member.guild.name, inline: true },
      { name: 'Motivo', value: truncateText(reason, 1024), inline: false },
    ],
  });
}

async function sendAuditLog(client, { title, color, fields }) {
  if (!config.logChannelId) {
    return;
  }

  try {
    const channel = await client.channels.fetch(config.logChannelId);

    if (!channel?.isTextBased() || typeof channel.send !== 'function') {
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .addFields(fields.map(normalizeField))
      .setTimestamp();

    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error('Falha ao enviar log de auditoria:', error);
  }
}

function createSnapshotFromMessage(message) {
  return {
    id: message.id,
    guildId: message.guild?.id ?? null,
    channelId: message.channelId,
    authorId: message.author?.id ?? null,
    authorTag: message.author?.tag ?? 'Autor desconhecido',
    content: truncateText(message.content?.trim() || '', maxLoggedContentLength),
    url: message.url || null,
    attachments: message.attachments
      ? [...message.attachments.values()]
          .slice(0, maxLoggedAttachments)
          .map((attachment) => ({
            name: attachment.name || 'arquivo',
            url: attachment.url,
            contentType: attachment.contentType || null,
            size: attachment.size || 0,
          }))
      : [],
    createdAt: Date.now(),
  };
}

function rememberMessageSnapshot(snapshot) {
  pruneMessageSnapshots();
  messageSnapshots.set(snapshot.id, {
    ...snapshot,
    createdAt: Date.now(),
  });
}

function pruneMessageSnapshots() {
  const now = Date.now();

  for (const [messageId, snapshot] of messageSnapshots.entries()) {
    if (
      messageSnapshots.size <= maxMessageSnapshots &&
      now - snapshot.createdAt <= messageSnapshotTtlMs
    ) {
      continue;
    }

    messageSnapshots.delete(messageId);
  }
}

function normalizeField(field) {
  return {
    ...field,
    name: truncateText(field.name, 256),
    value: truncateText(field.value || 'Sem dados', 1024),
  };
}

function formatAttachments(attachments) {
  return attachments
    .map((attachment, index) => {
      const size = attachment.size ? ` (${formatBytes(attachment.size)})` : '';
      return `${index + 1}. [${truncateText(attachment.name, 80)}](${attachment.url})${size}`;
    })
    .join('\n');
}

function getAttachmentSignature(attachments) {
  return attachments
    .map((attachment) => `${attachment.name}:${attachment.url}:${attachment.size}`)
    .join('|');
}

function formatUser(userId, tag) {
  if (!userId) {
    return tag || 'Usuario desconhecido';
  }

  return `<@${userId}> (${inlineCode(userId)})`;
}

function formatMemberRoles(member) {
  const roleIds = getMemberRoleIds(member);

  if (roleIds.size === 0) {
    return 'Sem cargos.';
  }

  return formatRoleIds(member.guild, [...roleIds]);
}

function getMemberRoleIds(member) {
  return new Set(
    [...member.roles.cache.keys()].filter((roleId) => roleId !== member.guild.id),
  );
}

function formatRoleIds(guild, roleIds) {
  if (roleIds.length === 0) {
    return 'Nenhum.';
  }

  return truncateText(
    roleIds
      .map((roleId) => {
        const role = guild.roles.cache.get(roleId);
        return role ? `${role} (${inlineCode(role.id)})` : `<@&${roleId}> (${inlineCode(roleId)})`;
      })
      .join('\n'),
    1024,
  );
}

function getChannelBaseFields(channel) {
  return [
    { name: 'Canal', value: formatChannel(channel), inline: true },
    { name: 'Nome', value: inlineCode(channel.name ?? 'Sem nome'), inline: true },
    { name: 'Tipo', value: formatChannelType(channel.type), inline: true },
    { name: 'Categoria', value: formatChannelParent(channel), inline: true },
    { name: 'Canal ID', value: inlineCode(channel.id), inline: true },
  ];
}

function getChannelChanges(oldChannel, newChannel) {
  const changes = [];

  addChange(changes, 'Nome', oldChannel.name, newChannel.name, inlineCode);
  addChange(
    changes,
    'Categoria',
    oldChannel.parentId,
    newChannel.parentId,
    (parentId) => parentId ? formatChannelId(parentId) : 'Sem categoria',
  );
  addChange(changes, 'Topico', oldChannel.topic, newChannel.topic, formatOptionalText);
  addChange(changes, 'NSFW', oldChannel.nsfw, newChannel.nsfw, formatBoolean);
  addChange(
    changes,
    'Slowmode',
    oldChannel.rateLimitPerUser,
    newChannel.rateLimitPerUser,
    formatSlowmode,
  );
  addChange(changes, 'Bitrate', oldChannel.bitrate, newChannel.bitrate, formatBitrate);
  addChange(
    changes,
    'Limite de usuarios',
    oldChannel.userLimit,
    newChannel.userLimit,
    formatUserLimit,
  );
  addChange(
    changes,
    'Posicao',
    oldChannel.rawPosition ?? oldChannel.position,
    newChannel.rawPosition ?? newChannel.position,
    (position) => String(position ?? 'Desconhecida'),
  );

  const oldPermissionSignature = getPermissionOverwriteSignature(oldChannel);
  const newPermissionSignature = getPermissionOverwriteSignature(newChannel);

  if (oldPermissionSignature !== newPermissionSignature) {
    changes.push({
      name: 'Permissoes',
      before: formatPermissionOverwrites(oldChannel),
      after: formatPermissionOverwrites(newChannel),
    });
  }

  return changes;
}

function addChange(changes, name, before, after, formatter) {
  if (before === after) {
    return;
  }

  changes.push({
    name,
    before: formatter(before),
    after: formatter(after),
  });
}

function formatChannel(channel) {
  return `${formatChannelId(channel.id)} (${inlineCode(channel.id)})`;
}

function formatChannelId(channelId) {
  return channelId ? `<#${channelId}>` : 'Nenhum canal';
}

function formatChannelParent(channel) {
  if (channel.type === ChannelType.GuildCategory) {
    return 'Categoria raiz';
  }

  return channel.parentId ? formatChannelId(channel.parentId) : 'Sem categoria';
}

function formatChannelType(type) {
  const types = new Map([
    [ChannelType.GuildText, 'Texto'],
    [ChannelType.GuildVoice, 'Voz'],
    [ChannelType.GuildCategory, 'Categoria'],
    [ChannelType.GuildAnnouncement, 'Anuncios'],
    [ChannelType.GuildStageVoice, 'Palco'],
    [ChannelType.GuildForum, 'Forum'],
    [ChannelType.GuildMedia, 'Midia'],
    [ChannelType.GuildDirectory, 'Diretorio'],
  ]);

  return types.get(type) ?? `Tipo ${type}`;
}

function formatOptionalText(value) {
  return value ? inlineCode(truncateText(value, 120)) : 'Vazio';
}

function formatBoolean(value) {
  return value ? 'Sim' : 'Nao';
}

function formatSlowmode(seconds) {
  if (!seconds) {
    return 'Desativado';
  }

  return formatDuration(seconds * 1000);
}

function formatBitrate(bitrate) {
  if (!bitrate) {
    return 'Nao aplicavel';
  }

  return `${Math.round(bitrate / 1000)} kbps`;
}

function formatUserLimit(limit) {
  if (!limit) {
    return 'Sem limite';
  }

  return String(limit);
}

function getPermissionOverwriteSignature(channel) {
  if (!channel.permissionOverwrites?.cache) {
    return '';
  }

  return [...channel.permissionOverwrites.cache.values()]
    .map((overwrite) => (
      `${overwrite.id}:${overwrite.type}:${overwrite.allow.bitfield}:${overwrite.deny.bitfield}`
    ))
    .sort()
    .join('|');
}

function formatPermissionOverwrites(channel) {
  if (!channel.permissionOverwrites?.cache?.size) {
    return 'Sem permissoes especificas.';
  }

  return truncateText(
    [...channel.permissionOverwrites.cache.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(formatPermissionOverwrite)
      .join('\n'),
    1000,
  );
}

function formatPermissionOverwrite(overwrite) {
  const target = overwrite.type === 0 ? `<@&${overwrite.id}>` : `<@${overwrite.id}>`;
  const allowed = overwrite.allow.toArray().join(', ') || 'nenhuma';
  const denied = overwrite.deny.toArray().join(', ') || 'nenhuma';

  return `${target}: permitir [${allowed}] | negar [${denied}]`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return 'Desconhecido';
  }

  return `<t:${Math.floor(timestamp / 1000)}:F>`;
}

function formatInviteExpiration(invite) {
  if (!invite.maxAge) {
    return 'Nunca expira';
  }

  if (invite.expiresTimestamp) {
    return formatTimestamp(invite.expiresTimestamp);
  }

  if (invite.createdTimestamp) {
    return formatTimestamp(invite.createdTimestamp + invite.maxAge * 1000);
  }

  return formatDuration(invite.maxAge * 1000);
}

async function findRecentAuditLogEntry(guild, type, { targetId = null } = {}) {
  try {
    const logs = await guild.fetchAuditLogs({
      type,
      limit: auditLogLookupLimit,
    });

    return logs.entries.find((entry) => {
      if (targetId && entry.targetId !== targetId) {
        return false;
      }

      return Date.now() - entry.createdTimestamp <= auditLogLookupWindowMs;
    }) ?? null;
  } catch {
    return null;
  }
}

function addAuditExecutorFields(fields, entry) {
  if (!entry?.executorId) {
    return;
  }

  fields.push({
    name: 'Responsavel',
    value: formatUser(entry.executorId, entry.executor?.tag),
    inline: true,
  });

  if (entry.reason) {
    fields.push({
      name: 'Motivo',
      value: truncateText(entry.reason, 1024),
      inline: false,
    });
  }
}

function formatDuration(durationMs) {
  const totalSeconds = Math.ceil(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  if (seconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${seconds}s`;
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

function codeBlock(value) {
  return `\`\`\`\n${String(value).replace(/```/g, "'''")}\n\`\`\``;
}

function inlineCode(value) {
  return `\`${String(value).replace(/`/g, "'")}\``;
}

function truncateText(value, maxLength) {
  const text = String(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}
