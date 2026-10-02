import type { PrismaClient, User } from '@pitchpresence/database';
import type { Providers } from '../../src/infrastructure/providers.js';
export const bankProviders: Pick<
  Providers,
  'banks' | 'resolveBank' | 'createSubaccount' | 'findSubaccount' | 'sendStaffInvitation'
> = {
  banks: async () => [{ code: '058', name: 'Test Bank' }],
  resolveBank: async () => 'TEST TEAM',
  createSubaccount: async (input) => ({
    code: `ACCT_${input.profileId}`,
    active: true,
    profileId: input.profileId,
    accountName: 'TEST TEAM',
    accountLast4: input.accountNumber.slice(-4),
    bankCode: input.bankCode,
  }),
  findSubaccount: async () => null,
  sendStaffInvitation: async () => {},
};
export async function seedTeam(db: PrismaClient, manager: User, paymentsReady = true) {
  const team = await db.team.create({ data: { name: 'Test Team', createdBy: manager.id } });
  const updated = await db.user.update({ where: { id: manager.id }, data: { teamId: team.id } });
  if (paymentsReady) {
    const profile = await db.teamPaymentProfile.create({
      data: {
        teamId: team.id,
        configuredBy: manager.id,
        bankCode: '058',
        accountName: 'TEST TEAM',
        accountLast4: '1234',
        status: 'READY',
        subaccountCode: `ACCT_${team.id}`,
      },
    });
    await db.team.update({ where: { id: team.id }, data: { paymentProfileId: profile.id } });
  }
  return updated;
}
