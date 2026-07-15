import { Events } from 'discord.js';
import { logDeletedMessage } from '../services/auditLog.js';

export const name = Events.MessageDelete;

export async function execute(message) {
  try {
    await logDeletedMessage(message);
  } catch (error) {
    console.error('Falha ao registrar mensagem apagada:', error);
  }
}
