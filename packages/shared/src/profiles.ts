import { z } from 'zod';
export const POSITION_LABELS = {
  GK: 'Goalkeeper',
  CB: 'Centre-back',
  LB: 'Left-back',
  RB: 'Right-back',
  LWB: 'Left wing-back',
  RWB: 'Right wing-back',
  DM: 'Defensive midfielder',
  CM: 'Central midfielder',
  AM: 'Attacking midfielder',
  LW: 'Left winger',
  RW: 'Right winger',
  ST: 'Striker',
} as const;
export const position = z.enum([
  'GK',
  'CB',
  'LB',
  'RB',
  'LWB',
  'RWB',
  'DM',
  'CM',
  'AM',
  'LW',
  'RW',
  'ST',
]);
export const footballFields = z
  .object({
    preferredFoot: z.enum(['LEFT', 'RIGHT', 'BOTH']).nullable(),
    primaryPosition: position.nullable(),
    secondaryPositions: z.array(position).max(2),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.secondaryPositions).size === value.secondaryPositions.length &&
      !value.secondaryPositions.some((p) => p === value.primaryPosition),
    {
      message: 'Choose up to two different secondary positions, excluding your primary position.',
      path: ['secondaryPositions'],
    },
  );
export const teamProfileFields = z
  .object({
    shirtNumber: z.number().int().min(0).max(99).nullable(),
    assignedPosition: position.nullable(),
  })
  .strict();
export const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const photoUpload = z
  .object({
    content: z.string().min(4).max(2796204),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  })
  .strict();
export const profileSummary = z.object({
  preferredFoot: z.enum(['LEFT', 'RIGHT', 'BOTH']).nullable(),
  primaryPosition: position.nullable(),
  secondaryPositions: z.array(position).max(2),
  photoVersion: z.string().uuid().nullable(),
  shirtNumber: z.number().int().nullable(),
  assignedPosition: position.nullable(),
});
export const playerProfileResponse = z.object({
  membershipId: z.string().uuid(),
  name: z.string(),
  teamName: z.string(),
  active: z.boolean(),
  isVerified: z.boolean(),
  profile: profileSummary,
  attendance: z.object({
    attended: z.number().int(),
    missed: z.number().int(),
    total: z.number().int(),
    percentage: z.number().nullable(),
  }),
});
export type PlayerProfileResponse = z.infer<typeof playerProfileResponse>;
export type FootballFields = z.infer<typeof footballFields>;
export type TeamProfileFields = z.infer<typeof teamProfileFields>;
