import type {
  AttendanceResponse,
  DuesResponse,
  PaymentResponse,
  TrainingResponse,
} from '@pitchpresence/shared';
export type PaymentRecord = Pick<PaymentResponse, 'id' | 'status' | 'amount' | 'paidAt'> & {
  provider: 'PAYSTACK' | 'EXTERNAL';
  reversedAt: string | null;
  needsReview?: boolean;
};
export type DuesRecord = DuesResponse & {
  minimumAmount?: number | null;
  paymentAvailable?: boolean;
  paymentsReady?: boolean;
  payments: PaymentRecord[];
  player?: { id: string; name: string; active: boolean };
};
export type AttendanceRecord = {
  id: string;
  session: Pick<TrainingResponse, 'id' | 'name' | 'date' | 'status'>;
  attendance: AttendanceResponse | null;
  result: 'PRESENT' | 'ABSENT' | 'NOT_CHECKED_IN';
};
export type Roster = {
  sessionId: string;
  status: 'OPEN' | 'CLOSED';
  checkedInCount: number;
  players: {
    playerId: string;
    name: string;
    attendance: AttendanceResponse | null;
    result: AttendanceRecord['result'];
  }[];
};
