import { Events } from 'discord.js';
import { logInviteCreate } from '../services/auditLog.js';

export const name = Events.InviteCreate;

export async function execute(invite) {
  try {
    await logInviteCreate(invite);
  } catch (error) {
    console.error('Falha ao registrar convite criado:', error);
  }
}
