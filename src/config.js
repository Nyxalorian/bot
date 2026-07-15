import 'dotenv/config';

const defaultGuardianUserIds = [
  '1505932546242773162',
  '764227139029041192',
];

export const config = {
  token: readEnv('DISCORD_TOKEN'),
  clientId: readEnv('DISCORD_CLIENT_ID'),
  guildId: readEnv('DISCORD_GUILD_ID'),
  goodMorningChannelId:
    readEnv('GOOD_MORNING_CHANNEL_ID') || '1526051855480918128',
  goodMorningTimeZone: readEnv('GOOD_MORNING_TIME_ZONE') || 'America/Sao_Paulo',
  hardBanManagerRoleId:
    readEnv('HARD_BAN_MANAGER_ROLE_ID') || '1520801193033470083',
  dmManagerRoleId:
    readEnv('DM_MANAGER_ROLE_ID') ||
    readEnv('HARD_BAN_MANAGER_ROLE_ID') ||
    '1520801193033470083',
  unnameManagerRoleId:
    readEnv('UNNAME_MANAGER_ROLE_ID') ||
    readEnv('HARD_BAN_MANAGER_ROLE_ID') ||
    '1520801193033470083',
  messageCooldownManagerRoleId:
    readEnv('MESSAGE_COOLDOWN_MANAGER_ROLE_ID') ||
    readEnv('HARD_BAN_MANAGER_ROLE_ID') ||
    '1520801193033470083',
  meetingCategoryId: readEnv('MEETING_CATEGORY_ID') || '1519817688354914367',
  guardianUserIds: getGuardianUserIds(),
  guardianRoleId:
    readEnv('GUARDIAN_ROLE_ID') ||
    readEnv('HARD_BAN_MANAGER_ROLE_ID') ||
    '1520801193033470083',
  specialRoleManagerUserId:
    readEnv('SPECIAL_ROLE_MANAGER_USER_ID') || '1505932546242773162',
  specialRoleLimitRoleId:
    readEnv('SPECIAL_ROLE_LIMIT_ROLE_ID') || '1526051649423147011',
};

export function requireEnv(key, value) {
  if (!value) {
    throw new Error(
      `Variavel de ambiente obrigatoria ausente: ${key}. Configure no .env local ou no painel da Discloud.`,
    );
  }

  return value;
}

function readEnv(key) {
  return process.env[key]?.trim() || null;
}

function readEnvList(key) {
  return (readEnv(key) || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function getGuardianUserIds() {
  const configuredIds = readEnvList('GUARDIAN_USER_IDS');

  if (configuredIds.length > 0) {
    return uniqueIds(configuredIds);
  }

  return uniqueIds([readEnv('GUARDIAN_USER_ID'), ...defaultGuardianUserIds]);
}

function uniqueIds(values) {
  return values.filter(Boolean).filter((value, index, list) => {
    return list.indexOf(value) === index;
  });
}
