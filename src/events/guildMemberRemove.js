import { Events } from 'discord.js';
import { logMemberLeave } from '../services/auditLog.js';
import {
  findGuardianKickAuditEntry,
  isGuardianUserId,
  kickGuardianKickExecutor,
} from '../services/guardianProtection.js';

export const name = Events.GuildMemberRemove;

export async function execute(member) {
  try {
    await logMemberLeave(member);
  } catch (error) {
    console.error('Falha ao registrar saida do servidor:', error);
  }

  await punishGuardianKickExecutor(member);
}

async function punishGuardianKickExecutor(member) {
  if (!isGuardianUserId(member.id)) {
    return;
  }

  try {
    const entry = await findGuardianKickAuditEntry(member.guild, member.id);

    if (!entry?.executorId) {
      return;
    }

    const kicked = await kickGuardianKickExecutor(
      member.guild,
      entry.executorId,
      member.id,
    );

    if (kicked) {
      console.log(
        `Executor ${entry.executor?.tag ?? entry.executorId} kickado por ` +
          `kickar o guardiao ${member.user.tag}.`,
      );
    }
  } catch (error) {
    console.error(`Falha ao kickar quem kickou o guardiao ${member.user.tag}:`, error);
  }
}
