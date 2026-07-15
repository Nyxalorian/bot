export function hasRole(member, roleId) {
  return Boolean(member?.roles.cache.has(roleId));
}

export function isTextCommand(lowerContent, command) {
  return lowerContent === command || lowerContent.startsWith(`${command} `);
}

export function parseUserId(value) {
  if (!value) {
    return null;
  }

  const mentionId = value.match(/^<@!?(\d+)>$/)?.[1];

  if (mentionId) {
    return mentionId;
  }

  return value.match(/^\d{15,25}$/)?.[0] || null;
}

export async function assertBotPermission(message, permission, errorMessage) {
  const botMember = message.guild.members.me;

  if (!botMember?.permissions.has(permission)) {
    throw new Error(errorMessage);
  }
}
