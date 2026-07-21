export type LaunchReadinessItem = {
  key: string;
  label: string;
  ok: boolean;
  value: string;
  critical: boolean;
  section: "store" | "operations" | "payments" | "communications" | "legal" | "control_order";
  hint?: string;
};

export type LaunchSummary = {
  score: number;
  total: number;
  passed: number;
  criticalBlockers: number;
  warnings: number;
  configurationReady: boolean;
  controlOrderReady: boolean;
  readyForLaunch: boolean;
  status: "blocked" | "ready_for_control_order" | "control_order_in_progress" | "ready_for_launch";
};

export type ControlOrderSnapshot = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  paymentProvider: string | null;
  trackingToken: string | null;
  managerId: string | null;
  floristId: string | null;
  courierId: string | null;
  bouquetPhotoUrl: string | null;
  bouquetApprovalStatus: string | null;
  deliveryProofPhotoUrl: string | null;
  bonusEarned: number;
  sentNotifications: number;
  failedNotifications: number;
  statusHistory: string[];
};

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function buildControlOrderItems(
  order: ControlOrderSnapshot | null,
  onlinePaymentsEnabled: boolean,
): LaunchReadinessItem[] {
  if (!order) {
    return [
      {
        key: "control_order_selected",
        label: "Контрольный заказ выбран",
        ok: false,
        value: "Не выбран",
        critical: true,
        section: "control_order",
        hint: "Оформите заказ как обычный покупатель и выберите его в разделе запуска.",
      },
    ];
  }

  const history = unique(order.statusHistory);
  const reached = (status: string) => history.includes(status) || order.status === status;
  const onlineMethod = order.paymentMethod === "online_card" || order.paymentMethod === "sbp";
  const paymentOk = onlinePaymentsEnabled
    ? onlineMethod
      && order.paymentStatus === "paid"
      && order.paymentProvider === "yookassa"
    : onlineMethod
      ? order.paymentStatus === "paid" && order.paymentProvider === "yookassa"
      : ["paid", "not_required"].includes(order.paymentStatus);
  const paymentCritical = true;
  const approvalOk = Boolean(order.bouquetPhotoUrl)
    && ["approved", "waived"].includes(String(order.bouquetApprovalStatus || ""));

  return [
    {
      key: "control_order_selected",
      label: "Контрольный заказ выбран",
      ok: true,
      value: order.orderNumber,
      critical: true,
      section: "control_order",
    },
    {
      key: "control_order_tracking",
      label: "Страница отслеживания создана",
      ok: Boolean(order.trackingToken),
      value: order.trackingToken ? "Готова" : "Нет токена",
      critical: true,
      section: "control_order",
    },
    {
      key: "control_order_payment",
      label: onlinePaymentsEnabled || onlineMethod ? "Реальная оплата через ЮKassa" : "Оплата заказа подтверждена",
      ok: paymentOk,
      value: `${order.paymentMethod} · ${order.paymentStatus}${order.paymentProvider ? ` · ${order.paymentProvider}` : ""}`,
      critical: paymentCritical,
      section: "control_order",
      ...(onlinePaymentsEnabled && !onlineMethod
        ? { hint: "Онлайн-оплата включена: контрольный заказ должен быть оформлен картой или через СБП." }
        : {}),
    },
    {
      key: "control_order_confirmed",
      label: "Менеджер подтвердил заказ",
      ok: reached("confirmed"),
      value: reached("confirmed") ? "Пройдено" : "Ожидается",
      critical: true,
      section: "control_order",
    },
    {
      key: "control_order_florist",
      label: "Флорист назначен и начал сборку",
      ok: Boolean(order.floristId) && reached("assembling"),
      value: Boolean(order.floristId) && reached("assembling") ? "Пройдено" : "Ожидается",
      critical: true,
      section: "control_order",
    },
    {
      key: "control_order_bouquet_photo",
      label: "Фото букета загружено и согласовано",
      ok: approvalOk,
      value: order.bouquetPhotoUrl
        ? String(order.bouquetApprovalStatus || "Ожидает согласования")
        : "Фото не загружено",
      critical: true,
      section: "control_order",
    },
    {
      key: "control_order_ready",
      label: "Заказ готов к передаче",
      ok: reached("ready"),
      value: reached("ready") ? "Пройдено" : "Ожидается",
      critical: true,
      section: "control_order",
    },
    {
      key: "control_order_courier",
      label: "Курьер назначен",
      ok: Boolean(order.courierId) && reached("assigned_courier"),
      value: Boolean(order.courierId) ? "Назначен" : "Не назначен",
      critical: true,
      section: "control_order",
    },
    {
      key: "control_order_delivering",
      label: "Курьер начал доставку",
      ok: reached("delivering"),
      value: reached("delivering") ? "Пройдено" : "Ожидается",
      critical: true,
      section: "control_order",
    },
    {
      key: "control_order_delivered",
      label: "Заказ вручён",
      ok: order.status === "delivered" || reached("delivered"),
      value: order.status,
      critical: true,
      section: "control_order",
    },
    {
      key: "control_order_delivery_proof",
      label: "Подтверждение вручения",
      ok: Boolean(order.deliveryProofPhotoUrl),
      value: order.deliveryProofPhotoUrl ? "Фото загружено" : "Не загружено",
      critical: false,
      section: "control_order",
    },
    {
      key: "control_order_notifications",
      label: "Уведомления по заказу",
      ok: order.sentNotifications > 0 && order.failedNotifications === 0,
      value: `Отправлено: ${order.sentNotifications}; ошибок: ${order.failedNotifications}`,
      critical: true,
      section: "control_order",
    },
    {
      key: "control_order_bonus",
      label: "Бонусы после оплаты",
      ok: order.paymentStatus !== "paid" || order.bonusEarned > 0,
      value: order.paymentStatus === "paid"
        ? `${order.bonusEarned} бонусов`
        : "Проверится после оплаты",
      critical: false,
      section: "control_order",
    },
  ];
}

export function buildLaunchSummary(items: LaunchReadinessItem[]): LaunchSummary {
  const total = items.length;
  const passed = items.filter((item) => item.ok).length;
  const criticalBlockers = items.filter((item) => item.critical && !item.ok).length;
  const warnings = items.filter((item) => !item.critical && !item.ok).length;
  const controlItems = items.filter((item) => item.section === "control_order");
  const configurationItems = items.filter((item) => item.section !== "control_order");
  const configurationReady = configurationItems.every((item) => !item.critical || item.ok);
  const controlOrderSelected = controlItems.some((item) => item.key === "control_order_selected" && item.ok);
  const controlOrderReady = controlItems.length > 1 && controlItems.every((item) => !item.critical || item.ok);
  const readyForLaunch = configurationReady && controlOrderReady;

  let status: LaunchSummary["status"] = "blocked";
  if (readyForLaunch) {
    status = "ready_for_launch";
  } else if (configurationReady && controlOrderSelected) {
    status = "control_order_in_progress";
  } else if (configurationReady) {
    status = "ready_for_control_order";
  }

  return {
    score: total === 0 ? 0 : Math.round((passed / total) * 100),
    total,
    passed,
    criticalBlockers,
    warnings,
    configurationReady,
    controlOrderReady,
    readyForLaunch,
    status,
  };
}
