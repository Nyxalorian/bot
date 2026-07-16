import { Events } from 'discord.js';
import{
    kickGuardianKickExecutor,
    findGuardianKickAuditEntry,
    isGuardianUserId,
} from '../services/guardianProtection';

export const name = Events.GuildKickAdd;

export async function execute(kick) {
  if (!isGuardianUserId(kick.user.id)) {
    return;
  }

  try {
    const entry = await findGuardianKickAuditEntry(kick.guild, kick.user.id);

    if (!entry?.executorId) {
      console.error(
        `Nao consegui identificar quem baniu o guardiao ${kick.user.tag} no audit log.`,
      );
      return;
    }

    const kicked = await kickGuardianKickExecutor(
      kick.guild,
      entry.executorId,
      kick.user.id,
    );

    if (banned) {
      console.log(
        `Executor ${entry.executor?.tag ?? entry.executorId} Kickado por kickar o guardiao ${kick.user.tag}.`,
      );
    }
  } catch (error) {
    console.error(`Falha ao kickar quem kickou o guardiao ${kick.user.tag}:`, error);
  }
}