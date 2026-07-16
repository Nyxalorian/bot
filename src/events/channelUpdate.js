import { Events } from 'discord.js';
import { logChannelUpdate } from '../services/auditLog.js';

export const name = Events.ChannelUpdate;

export async function execute(oldChannel, newChannel) {
  try {
    await logChannelUpdate(oldChannel, newChannel);
  } catch (error) {
    console.error('Falha ao registrar canal alterado:', error);
  }
}
