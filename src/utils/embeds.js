import { EmbedBuilder } from 'discord.js';

const colors = {
  success: 0x22c55e,
  error: 0xef4444,
  warning: 0xf59e0b,
  info: 0x38bdf8,
  neutral: 0x5865f2,
};
const maxDescriptionLength = 4096;
const maxFieldNameLength = 256;
const maxFieldValueLength = 1024;

export function createEmbed({
  title,
  description,
  color = 'info',
  fields = [],
  url = null,
  image = null,
}) {
  const embed = new EmbedBuilder()
    .setColor(colors[color] ?? color)
    .setTimestamp();

  if (title) {
    embed.setTitle(title);
  }

  if (description) {
    embed.setDescription(truncateText(description, maxDescriptionLength));
  }

  if (url) {
    embed.setURL(url);
  }

  if (image) {
    embed.setImage(image);
  }

  if (fields.length > 0) {
    embed.addFields(
      fields.map((field) => ({
        ...field,
        name: truncateText(field.name, maxFieldNameLength),
        value: truncateText(field.value, maxFieldValueLength),
      })),
    );
  }

  return embed;
}

export function successEmbed(title, description, fields = []) {
  return createEmbed({ title, description, fields, color: 'success' });
}

export function errorEmbed(title, description, fields = []) {
  return createEmbed({ title, description, fields, color: 'error' });
}

export function warningEmbed(title, description, fields = []) {
  return createEmbed({ title, description, fields, color: 'warning' });
}

export function infoEmbed(title, description, fields = []) {
  return createEmbed({ title, description, fields, color: 'info' });
}

export async function replyWithEmbed(message, embed) {
  return message.reply({
    embeds: [embed],
    allowedMentions: { repliedUser: false },
  });
}

function truncateText(value, maxLength) {
  const text = String(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}
