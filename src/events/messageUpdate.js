import { Events } from 'discord.js';
import { logEditedMessage } from '../services/auditLog.js';

export const name = Events.MessageUpdate;

export async function execute(oldMessage, newMessage) {
  try {
    if (newMessage.partial) {
      await newMessage.fetch();
    }

    await logEditedMessage(oldMessage, newMessage);
  } catch (error) {
    console.error('Falha ao registrar mensagem editada:', error);
  }
}
