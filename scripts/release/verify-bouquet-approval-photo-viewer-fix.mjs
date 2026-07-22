import { readFile } from "node:fs/promises";

const files = {
  api: "apps/api/src/routes/public.ts",
  preflight: "apps/api/src/verify-bouquet-approval-endpoint-sql-preflight.ts",
  viewer: "apps/web/src/app/components/customer-photo-viewer.tsx",
  approval: "apps/web/src/app/components/customer-bouquet-approval.tsx",
  account: "apps/web/src/app/account/account-client.tsx",
  orders: "apps/web/src/app/orders/orders-client.tsx",
  track: "apps/web/src/app/order/track/[token]/track-client.tsx",
  css: "apps/web/src/app/globals.css",
};

const content = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, path]) => [key, await readFile(path, "utf8")]),
  ),
);

function expect(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}

expect(
  content.api.includes("'status', ${nextStatus}::text"),
  "status согласования имеет явный PostgreSQL text cast",
);
expect(
  !content.api.includes("'status', ${nextStatus},"),
  "старый неоднозначный status-параметр удалён",
);
expect(
  content.api.includes("'note', ${body.action === \"revision\" ? note : null}::text"),
  "nullable note имеет явный PostgreSQL text cast",
);
expect(
  content.api.includes('"bouquet_revision_requested"\n              }::text'),
  "тип notification event имеет явный PostgreSQL text cast",
);
expect(
  content.preflight.includes("BOUQUET_APPROVAL_ENDPOINT_SQL_PREFLIGHT: OK"),
  "добавлена реальная TEMP TABLE проверка approve и revision",
);
expect(
  content.viewer.includes('role="dialog"')
    && content.viewer.includes("handleTouchMove")
    && content.viewer.includes("onDoubleClick")
    && content.viewer.includes("MAX_ZOOM = 4"),
  "фото открывается в полноэкранном viewer с pinch и double-click zoom",
);
expect(
  content.account.includes("<CustomerPhotoViewer")
    && content.orders.includes("<CustomerPhotoViewer")
    && content.track.includes("<CustomerPhotoViewer"),
  "viewer подключён в профиле, Моих заказах и пути заказа",
);
expect(
  content.approval.includes("/bouquet-approval")
    && content.approval.includes('action: "approve"'),
  "профиль продолжает использовать единый защищённый endpoint согласования",
);
expect(
  content.css.includes(".customer-photo-lightbox")
    && content.css.includes("touch-action: none"),
  "добавлены полноэкранные и мобильные стили viewer",
);

console.log("BOUQUET APPROVAL ENDPOINT + PHOTO VIEWER SOURCE CONTRACT: OK");
