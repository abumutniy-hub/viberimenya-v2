import {
  fetchAdmin,
  type AdminRow
} from "../lib/admin-api";

import {
  DeliveryZoneManager,
  type DeliveryZoneManagerItem
} from "./delivery-zone-manager";

import {
  DeliveryIntervalManager,
  type DeliveryIntervalManagerItem
} from "./delivery-interval-manager";

export const dynamic =
  "force-dynamic";

type Response = {
  zones: AdminRow[];
  intervals: AdminRow[];
};

function booleanValue(
  value: unknown
) {
  return (
    value === true
    || value === "true"
    || value === "t"
    || value === 1
    || value === "1"
  );
}

function numberValue(
  value: unknown,
  fallback = 0
) {
  const result = Number(value);

  return Number.isFinite(result)
    ? result
    : fallback;
}

function nullableNumber(
  value: unknown
) {
  if (
    value === null
    || value === undefined
    || value === ""
  ) {
    return null;
  }

  const result = Number(value);

  return Number.isFinite(result)
    ? result
    : null;
}

export default async function AdminDeliveryPage() {
  const data =
    await fetchAdmin<Response>(
      "/api/admin/delivery"
    );

  const zoneRows =
    data?.zones ?? [];

  const zones:
    DeliveryZoneManagerItem[] =
      zoneRows
        .filter(
          (zone) =>
            typeof zone.id === "string"
            && typeof zone.name
              === "string"
        )
        .map((zone) => ({
          id: String(zone.id),
          name: String(zone.name),

          description: String(
            zone.description ?? ""
          ),

          price: numberValue(
            zone.price
          ),

          freeFromAmount:
            nullableNumber(
              zone.free_from_amount
            ),

          isExpressAvailable:
            booleanValue(
              zone.is_express_available
            ),

          expressPrice:
            nullableNumber(
              zone.express_price
            ),

          isActive:
            booleanValue(
              zone.is_active
            ),

          sortOrder:
            numberValue(
              zone.sort_order,
              100
            ),

          updatedAt: String(
            zone.updated_at ?? ""
          )
        }));

  const deliveryZones =
    zones.filter(
      (zone) =>
        zone.name
          .trim()
          .toLowerCase()
        !== "самовывоз"
    );

  const activeZones =
    deliveryZones.filter(
      (zone) => zone.isActive
    ).length;

  const expressZones =
    deliveryZones.filter(
      (zone) =>
        zone.isActive
        && zone.isExpressAvailable
    ).length;

  const freeDeliveryZones =
    deliveryZones.filter(
      (zone) =>
        zone.isActive
        && Number(
          zone.freeFromAmount ?? 0
        ) > 0
    ).length;

  const intervalRows =
    data?.intervals ?? [];

  const intervals:
    DeliveryIntervalManagerItem[] =
      intervalRows
        .filter(
          (interval) =>
            typeof interval.id
              === "string"
        )
        .map((interval) => ({
          id: String(interval.id),

          name: String(
            interval.name ?? ""
          ),

          startsAt: String(
            interval.starts_at ?? ""
          ),

          endsAt: String(
            interval.ends_at ?? ""
          ),

          isActive:
            booleanValue(
              interval.is_active
            ),

          sortOrder:
            numberValue(
              interval.sort_order,
              100
            ),

          ordersCount:
            numberValue(
              interval.orders_count
            ),

          updatedAt: String(
            interval.updated_at ?? ""
          )
        }));

  const activeIntervals =
    intervals.filter(
      (interval) =>
        interval.isActive
    ).length;

  return (
    <div className="admin-page admin-delivery-page">
      <div className="admin-page-head">
        <div>
          <span>Логистика</span>

          <h1>Доставка</h1>

          <p>
            Управление зонами, тарифами,
            бесплатной, срочной доставкой
            и доступным временем.
          </p>
        </div>
      </div>

      <section className="admin-delivery-metrics">
        <article>
          <span>Зон доставки</span>
          <strong>
            {deliveryZones.length}
          </strong>
        </article>

        <article>
          <span>Активных зон</span>
          <strong>{activeZones}</strong>
        </article>

        <article>
          <span>Со срочной доставкой</span>
          <strong>{expressZones}</strong>
        </article>

        <article>
          <span>С бесплатным порогом</span>
          <strong>
            {freeDeliveryZones}
          </strong>
        </article>

        <article>
          <span>Активных интервалов</span>
          <strong>
            {activeIntervals}
          </strong>
        </article>
      </section>

      <section className="admin-panel admin-delivery-zones-panel">
        <div className="admin-panel-head">
          <div>
            <span>География и тарифы</span>
            <h2>Зоны доставки</h2>
          </div>

          <span className="admin-delivery-count">
            {deliveryZones.length}
          </span>
        </div>

        <DeliveryZoneManager
          zones={zones}
        />
      </section>

      <section className="admin-panel admin-delivery-intervals-panel">
        <div className="admin-panel-head">
          <div>
            <span>Расписание</span>
            <h2>Интервалы доставки</h2>
          </div>

          <span className="admin-delivery-count">
            {activeIntervals}/{intervals.length}
          </span>
        </div>

        <DeliveryIntervalManager
          intervals={intervals}
        />
      </section>
    </div>
  );
}
