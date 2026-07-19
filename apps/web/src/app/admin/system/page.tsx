import { fetchAdmin } from "../lib/admin-api";
import { MonitoringSettingsForm, SystemActionButton } from "./system-actions";

export const dynamic = "force-dynamic";

type CheckItem = {
  key?: string;
  label?: string;
  status?: string;
  message?: string;
  value?: unknown;
};

type SystemResponse = {
  status?: {
    generatedAt?: string;
    overall?: string;
    checks?: CheckItem[];
    services?: Array<Record<string, unknown>>;
    database?: Record<string, unknown>;
    disk?: Record<string, unknown>;
    ssl?: Record<string, unknown>;
  } | null;
  statusAgeMinutes?: number | null;
  statusStale?: boolean;
  lastBackup?: Record<string, unknown> | null;
  lastRestoreCheck?: Record<string, unknown> | null;
  backups?: Array<Record<string, unknown>>;
  events?: Array<Record<string, unknown>>;
  settings?: {
    alertsEnabled: boolean;
    operationalAlertsEnabled: boolean;
    alertRepeatHours: number;
    dailySummaryEnabled: boolean;
    autoRestartEnabled: boolean;
    backupRetentionDays: number;
    backupMaxCount: number;
    diskWarningPercent: number;
    diskCriticalPercent: number;
    staleOrderMinutes: number;
  };
  recovery?: {
    keyExists?: boolean;
    keyPath?: string;
    backupRoot?: string;
  };
  timers?: Array<Record<string, unknown>>;
};

function text(value: unknown, fallback = "—") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function number(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function bool(value: unknown) {
  return value === true || value === "true";
}

function dateText(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return text(value);
  return date.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function bytes(value: unknown) {
  const size = number(value);
  if (!size) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function statusLabel(value: unknown) {
  const status = text(value, "unknown");
  if (status === "ok" || status === "completed" || status === "active") return "В норме";
  if (status === "warning") return "Внимание";
  if (status === "running") return "Выполняется";
  if (status === "critical" || status === "failed") return "Критично";
  if (status === "inactive") return "Неактивно";
  return status;
}

function statusClass(value: unknown) {
  const status = text(value, "unknown").toLowerCase();
  if (["ok", "completed", "active", "online"].includes(status)) return "ok";
  if (["warning", "activating", "running"].includes(status)) return "warning";
  return "critical";
}

export default async function AdminSystemPage() {
  const data = await fetchAdmin<SystemResponse>("/api/admin/system");
  const status = data?.status;
  const checks = status?.checks ?? [];
  const backups = data?.backups ?? [];
  const events = data?.events ?? [];
  const settings = data?.settings ?? {
    alertsEnabled: true,
    operationalAlertsEnabled: false,
    alertRepeatHours: 24,
    dailySummaryEnabled: false,
    autoRestartEnabled: true,
    backupRetentionDays: 30,
    backupMaxCount: 7,
    diskWarningPercent: 75,
    diskCriticalPercent: 90,
    staleOrderMinutes: 120,
  };
  const overall = data?.statusStale ? "warning" : text(status?.overall, "critical");

  return (
    <div className="admin-page admin-system-page">
      <div className="admin-page-head admin-system-head">
        <div>
          <span>Резервные копии, мониторинг и восстановление</span>
          <h1>Система</h1>
          <p>Контроль сайта, API, Telegram-бота, базы, диска, SSL и резервных копий.</p>
        </div>
        <div className={`admin-system-overall ${statusClass(overall)}`}>
          <span>Общий статус</span>
          <strong>{data?.statusStale ? "Данные устарели" : statusLabel(overall)}</strong>
          <small>Проверка: {dateText(status?.generatedAt)}</small>
        </div>
      </div>

      <section className="admin-system-actions">
        <SystemActionButton action="diagnostics">Проверить сейчас</SystemActionButton>
        <SystemActionButton action="backup" confirmText="Создать резервную копию базы и зашифрованного .env? Неизменившийся архив фотографий будет переиспользован без повторного расхода диска.">
          Создать резервную копию
        </SystemActionButton>
        <SystemActionButton action="restore-check" confirmText="Проверить восстановление последней копии во временную базу? Работающий магазин не изменится.">
          Проверить восстановление
        </SystemActionButton>
        <a href="/api/admin/system/report" className="admin-system-report-link">Скачать диагностику</a>
      </section>

      <section className="admin-system-summary-grid">
        <article className={statusClass(status?.overall)}>
          <span>Последняя проверка</span>
          <strong>{data?.statusAgeMinutes === null || data?.statusAgeMinutes === undefined ? "—" : `${data.statusAgeMinutes} мин. назад`}</strong>
          <small>Автоматически каждые 5 минут</small>
        </article>
        <article className={statusClass(data?.lastBackup?.status)}>
          <span>Последняя копия</span>
          <strong>{dateText(data?.lastBackup?.completedAt)}</strong>
          <small>
            {text(data?.lastBackup?.uploadsStorageMode) === "reused_hardlink"
              ? "Фото переиспользованы без дублирования"
              : text(data?.lastBackup?.mode, "автоматически")}
          </small>
        </article>
        <article className={statusClass(data?.lastRestoreCheck?.status)}>
          <span>Проверка восстановления</span>
          <strong>{dateText(data?.lastRestoreCheck?.completedAt)}</strong>
          <small>{text(data?.lastRestoreCheck?.message, text(data?.lastRestoreCheck?.error))}</small>
        </article>
        <article className={data?.recovery?.keyExists ? "ok" : "critical"}>
          <span>Ключ восстановления</span>
          <strong>{data?.recovery?.keyExists ? "Создан" : "Не найден"}</strong>
          <small>Скачайте отдельно и храните вне сервера</small>
        </article>
      </section>

      <section className="admin-panel admin-system-checks-panel">
        <div className="admin-panel-head">
          <div>
            <span>Автоматическая диагностика</span>
            <h2>Состояние компонентов</h2>
          </div>
        </div>
        <div className="admin-system-check-grid">
          {checks.length ? checks.map((item) => (
            <article key={text(item.key)} className={statusClass(item.status)}>
              <div>
                <span>{statusLabel(item.status)}</span>
                <h3>{text(item.label)}</h3>
              </div>
              <p>{text(item.message)}</p>
            </article>
          )) : (
            <div className="admin-empty">Проверка ещё не выполнялась.</div>
          )}
        </div>
      </section>

      <section className="admin-system-two-columns">
        <article className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <span>Расписание systemd</span>
              <h2>Автоматические задачи</h2>
            </div>
          </div>
          <div className="admin-system-timer-list">
            {(data?.timers ?? []).map((timer) => (
              <div key={text(timer.key)}>
                <span className={statusClass(timer.state)}>{statusLabel(timer.state)}</span>
                <div><strong>{text(timer.label)}</strong><small>{text(timer.unit)}</small></div>
              </div>
            ))}
          </div>
        </article>

        <article className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <span>Шифрование и хранение</span>
              <h2>Восстановление сервера</h2>
            </div>
          </div>
          <div className="admin-system-recovery-note">
            <p>База сохраняется в формате PostgreSQL custom, `.env` — только в зашифрованном виде. Неизменившийся архив фотографий переиспользуется через hardlink и не занимает место повторно.</p>
            <dl>
              <div><dt>Архивы</dt><dd>{text(data?.recovery?.backupRoot)}</dd></div>
              <div><dt>Ключ</dt><dd>{text(data?.recovery?.keyPath)}</dd></div>
            </dl>
            <strong>Важно: скачайте ключ восстановления через Termius и храните отдельно. Без него расшифровать копию `.env` невозможно.</strong>
          </div>
        </article>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <span>Автоматическое поведение</span>
            <h2>Настройки мониторинга</h2>
          </div>
        </div>
        <MonitoringSettingsForm initial={settings} />
      </section>

      <section className="admin-panel admin-system-backups-panel">
        <div className="admin-panel-head">
          <div>
            <span>Последние сохранения</span>
            <h2>Резервные копии</h2>
          </div>
        </div>
        {backups.length ? (
          <div className="admin-system-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Создана</th><th>Режим</th><th>Логический размер</th><th>Добавлено на диск</th><th>Содержимое</th><th>Статус</th></tr></thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={text(backup.name)}>
                    <td><strong>{dateText(backup.createdAt)}</strong><small>{text(backup.name)}</small></td>
                    <td>{text(backup.mode)}</td>
                    <td>{bytes(backup.sizeBytes)}</td>
                    <td>
                      <strong>{bytes(backup.additionalStorageBytes)}</strong>
                      <small>
                        {text(backup.uploadsStorageMode) === "reused_hardlink"
                          ? "фото переиспользованы"
                          : text(backup.uploadsStorageMode) === "created"
                            ? "создан новый архив фото"
                            : "legacy backup"}
                      </small>
                    </td>
                    <td>{bool(backup.uploadsIncluded) ? "База + фото + настройки" : "База + настройки"}</td>
                    <td><span className={`admin-system-status-pill ${statusClass(backup.status)}`}>{statusLabel(backup.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="admin-empty">Автоматических резервных копий пока нет.</div>}
      </section>

      <section className="admin-panel admin-system-events-panel">
        <div className="admin-panel-head">
          <div>
            <span>Последние системные события</span>
            <h2>Журнал</h2>
          </div>
        </div>
        <div className="admin-system-event-list">
          {events.length ? events.map((event, index) => (
            <div key={`${text(event.at)}-${index}`} className={statusClass(event.severity)}>
              <time>{dateText(event.at)}</time>
              <strong>{text(event.type)}</strong>
              <span>{text(event.message)}</span>
            </div>
          )) : <div className="admin-empty">Событий пока нет.</div>}
        </div>
      </section>
    </div>
  );
}
