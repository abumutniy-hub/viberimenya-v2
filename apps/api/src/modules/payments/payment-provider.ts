export type CorePaymentStatus =
  | "created"
  | "pending"
  | "waiting_for_capture"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired";

export type ProviderReceiptItem = {
  description: string;
  quantity: string;
  amount: {
    value: string;
    currency: string;
  };
  vat_code: number;
  payment_mode: string;
  payment_subject: string;
};

export type CreateProviderPaymentParams = {
  idempotenceKey: string;
  amountRubles: number;
  shopId: string;
  orderId: string;
  orderNumber: string;
  trackingToken: string;
  method: "online_card" | "sbp";
  customerEmail: string | null;
  customerPhone: string | null;
  returnUrl: string;
  receiptItems?: ProviderReceiptItem[];
};

export type CreateProviderRefundParams = {
  idempotenceKey: string;
  paymentId: string;
  amountRubles: number;
  orderId: string;
  orderNumber: string;
  reason: string;
};

export type ProviderPaymentSnapshot = {
  id: string;
  status: CorePaymentStatus;
  providerStatus: string;
  amountMinor: number;
  currency: string;
  shopId: string;
  orderId: string;
  confirmationUrl: string | null;
  paidAt: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  raw: unknown;
};

export type ProviderRefundSnapshot = {
  id: string;
  paymentId: string;
  status: "pending" | "succeeded" | "cancelled";
  providerStatus: string;
  amountMinor: number;
  currency: string;
  cancellationReason: string | null;
  raw: unknown;
};

export interface PaymentProvider {
  readonly name: string;
  isConfigured(): boolean;
  createPayment(params: CreateProviderPaymentParams): Promise<ProviderPaymentSnapshot>;
  getPayment(paymentId: string): Promise<ProviderPaymentSnapshot>;
  cancelPayment(paymentId: string, idempotenceKey: string): Promise<ProviderPaymentSnapshot>;
  createRefund(params: CreateProviderRefundParams): Promise<ProviderRefundSnapshot>;
  getRefund(refundId: string): Promise<ProviderRefundSnapshot>;
}

export function expectedAmountMinor(amountRubles: number) {
  const safe = Math.max(0, Math.round(Number(amountRubles) || 0));
  return safe * 100;
}

export function parseDecimalAmountMinor(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  const match = /^(0|[1-9]\d*)\.(\d{2})$/.exec(text);

  if (!match) return null;

  const rubles = Number(match[1]);
  const kopecks = Number(match[2]);

  if (!Number.isSafeInteger(rubles) || !Number.isSafeInteger(kopecks)) {
    return null;
  }

  const minor = rubles * 100 + kopecks;
  return Number.isSafeInteger(minor) ? minor : null;
}
