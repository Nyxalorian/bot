import { Events } from 'discord.js';
import { logDeletedMessage } from '../services/auditLog.js';

export const name = Events.MessageBulkDelete;

export async function execute(messages) {
  for (const message of messages.values()) {
    try {
      await logDeletedMessage(message);
    } catch (error) {
      console.error('Falha ao registrar mensagem apagada em massa:', error);
    }
  }
}
