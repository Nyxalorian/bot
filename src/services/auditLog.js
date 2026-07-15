import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';

const messageSnapshots = new Map();
const maxMessageSnapshots = 2000;
const messageSnapshotTtlMs = 24 * 60 * 60 * 1000;
const maxLoggedContentLength = 900;
const maxLoggedAttachments = 10;

export function rememberMessageForAuditLog(message) {
  if (!message.guild || message.author?.bot) {
    return;
  }

  pruneMessageSnapshots();
  messageSnapshots.set(message.id, {
    id: message.id,
    guildId: message.guild.id,
    channelId: message.channelId,
    authorId: message.author.id,
    authorTag: message.author.tag,
    content: truncateText(message.content?.trim() || '', maxLoggedContentLength),
    attachments: [...message.attachments.values()]
      .slice(0, maxLoggedAttachments)
      .map((attachment) => ({
        name: attachment.name || 'arquivo',
        url: attachment.url,
        contentType: attachment.contentType || null,
        size: attachment.size || 0,
      })),
    createdAt: Date.now(),
  });
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

  await sendAuditLog(client, {
    title: 'Nome alterado',
    color: 0xf59e0b,
    fields: [
      { name: 'Usuario', value: formatUser(newMember.id, newMember.user.tag), inline: true },
      { name: 'Servidor', value: newMember.guild.name, inline: true },
      ...changes.map((change) => ({
        name: change.name,
        value: `Antes: ${inlineCode(change.before)}\nDepois: ${inlineCode(change.after)}`,
        inline: false,
      })),
    ],
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

function formatUser(userId, tag) {
  if (!userId) {
    return tag || 'Usuario desconhecido';
  }

  return `<@${userId}> (${inlineCode(userId)})`;
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
