import { Events } from 'discord.js';
import { logChannelDelete } from '../services/auditLog.js';

export const name = Events.ChannelDelete;

export async function execute(channel) {
  try {
    await logChannelDelete(channel);
  } catch (error) {
    console.error('Falha ao registrar canal apagado:', error);
  }
}
