import { Events } from 'discord.js';
import { logChannelCreate } from '../services/auditLog.js';

export const name = Events.ChannelCreate;

export async function execute(channel) {
  try {
    await logChannelCreate(channel);
  } catch (error) {
    console.error('Falha ao registrar canal criado:', error);
  }
}
