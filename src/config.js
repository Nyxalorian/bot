import 'dotenv/config';

export const config = {
  token: readEnvAny(['DISCORD_TOKEN', 'BOT_TOKEN', 'TOKEN']),
  goodMorningChannelId:
    readEnv('GOOD_MORNING_CHANNEL_ID') || '1526051855480918128',
  goodMorningTimeZone: readEnv('GOOD_MORNING_TIME_ZONE') || 'America/Sao_Paulo',
  goodMorningStartDate: readEnv('GOOD_MORNING_START_DATE') || '2026-07-13',
};

export function requireEnv(key, value, aliases = []) {
  if (!value) {
    throw new Error(
      `Variavel de ambiente obrigatoria ausente: ${[key, ...aliases].join(', ')}.`,
    );
  }

  return value;
}

function readEnvAny(keys) {
  for (const key of keys) {
    const value = readEnv(key);

    if (value) {
      return value;
    }
  }

  return null;
}

function readEnv(key) {
  return process.env[key]?.trim() || null;
}
