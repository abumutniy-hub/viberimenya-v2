import {
  buildControlOrderItems,
  buildLaunchSummary,
  type ControlOrderSnapshot,
  type LaunchReadinessItem,
} from "./modules/launch/launch-readiness";

function check(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(`FAILED: ${message}`);
  }
  console.log(`✓ ${message}`);
}

const configuration: LaunchReadinessItem[] = [
  {
    key: "products",
    label: "Товары",
    ok: true,
    value: "12",
    critical: true,
    section: "store",
  },
  {
    key: "staff",
    label: "Команда",
    ok: true,
    value: "Готова",
    critical: true,
    section: "operations",
  },
  {
    key: "legal_warning",
    label: "Собственные документы",
    ok: false,
    value: "Базовые шаблоны",
    critical: false,
    section: "legal",
  },
];

const withoutOrder = buildLaunchSummary([
  ...configuration,
  ...buildControlOrderItems(null, true),
]);

check(withoutOrder.configurationReady, "готовая конфигурация допускает контрольный заказ");
check(!withoutOrder.controlOrderReady, "без выбранного заказа запуск не разрешается");
check(withoutOrder.status === "ready_for_control_order", "статус без заказа — ready_for_control_order");

const partialOrder: ControlOrderSnapshot = {
  id: "11111111-1111-4111-8111-111111111111",
  orderNumber: "VM-TEST-1",
  status: "assembling",
  paymentStatus: "paid",
  paymentMethod: "online_card",
  paymentProvider: "yookassa",
  trackingToken: "tracking-token-1234567890",
  managerId: "manager",
  floristId: "florist",
  courierId: null,
  bouquetPhotoUrl: "/uploads/bouquets/test.jpg",
  bouquetApprovalStatus: "pending",
  deliveryProofPhotoUrl: null,
  bonusEarned: 100,
  sentNotifications: 4,
  failedNotifications: 0,
  statusHistory: ["new", "confirmed", "assembling"],
};

const partialItems = buildControlOrderItems(partialOrder, true);
const partialSummary = buildLaunchSummary([...configuration, ...partialItems]);
check(partialSummary.status === "control_order_in_progress", "незавершённый заказ остаётся в процессе");
check(!partialSummary.readyForLaunch, "согласование фото и доставка обязательны");
check(
  partialItems.find((item) => item.key === "control_order_payment")?.ok === true,
  "реальная оплата ЮKassa распознаётся",
);

const completeOrder: ControlOrderSnapshot = {
  ...partialOrder,
  status: "delivered",
  courierId: "courier",
  bouquetApprovalStatus: "approved",
  deliveryProofPhotoUrl: "/uploads/deliveries/test.jpg",
  sentNotifications: 12,
  statusHistory: [
    "new",
    "confirmed",
    "assembling",
    "ready",
    "assigned_courier",
    "delivering",
    "delivered",
  ],
};

const completeItems = buildControlOrderItems(completeOrder, true);
const completeSummary = buildLaunchSummary([...configuration, ...completeItems]);
check(completeSummary.controlOrderReady, "полная цепочка контрольного заказа распознаётся");
check(completeSummary.readyForLaunch, "после полной цепочки основной запуск разрешён");
check(completeSummary.status === "ready_for_launch", "финальный статус — ready_for_launch");

const wrongProvider = buildControlOrderItems(
  { ...completeOrder, paymentProvider: "manual" },
  true,
);
check(
  wrongProvider.find((item) => item.key === "control_order_payment")?.ok === false,
  "онлайн-заказ без подтверждения ЮKassa блокирует запуск",
);


const manualWhileOnline = buildControlOrderItems(
  {
    ...completeOrder,
    paymentMethod: "transfer_after_confirm",
    paymentProvider: "manual",
    paymentStatus: "paid",
  },
  true,
);
check(
  manualWhileOnline.find((item) => item.key === "control_order_payment")?.ok === false,
  "при включённой ЮKassa ручная оплата не заменяет контрольный онлайн-платёж",
);

const notificationFailure = buildControlOrderItems(
  { ...completeOrder, failedNotifications: 1 },
  true,
);
check(
  notificationFailure.find((item) => item.key === "control_order_notifications")?.ok === false,
  "ошибка уведомления по контрольному заказу блокирует запуск",
);

console.log("\nLAUNCH READINESS & CONTROL ORDER E2E: OK");
console.log("Проверены конфигурация, реальная оплата, статусы, фото, курьер, доставка и уведомления.");
