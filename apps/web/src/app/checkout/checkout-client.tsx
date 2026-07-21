"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./checkout.module.css";
import {
  buildWebCheckoutCustomerRecipientPatch,
  preserveWebCheckoutProgressStep,
  validateWebCheckoutCustomerRecipient,
  webCheckoutContactFingerprint,
  type WebCheckoutContactIssue,
  type WebCheckoutContactPreference,
  type WebCheckoutCustomerRecipientData,
  type WebCheckoutDraftStep,
} from "./checkout-customer-recipient";

type CustomerProfile = {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
};

type CheckoutDraftData = Partial<
  WebCheckoutCustomerRecipientData & {
    _core?: {
      sourceChannel?: "site" | "telegram" | "max";
    };
  }
>;

type CheckoutDraftSnapshot = {
  linked: true;
  step: WebCheckoutDraftStep;
  data: CheckoutDraftData;
  revision: number;
  expiresAt: string;
  updatedAt: string;
};

type ServerContactValidation = {
  valid: boolean;
  issues: Array<{
    code: string;
    field: string;
    message: string;
    severity: "error" | "warning";
  }>;
};

type AccountResponse = {
  ok?: boolean;
  customer?: CustomerProfile;
  telegram?: {
    connected?: boolean;
    username?: string | null;
  };
  message?: string;
};

type DraftResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
  draft?: CheckoutDraftSnapshot | null;
  contactValidation?: ServerContactValidation | null;
  currentRevision?: number;
};

type SaveDraftResponse = DraftResponse & {
  reused?: boolean;
};

type PageState =
  | "loading"
  | "ready"
  | "unauthorized"
  | "telegram_required"
  | "error";

type SaveState = "idle" | "saving" | "saved" | "error";

const EMPTY_FORM: WebCheckoutCustomerRecipientData = {
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  contactPreference: "call_or_message",
  recipientSameAsCustomer: false,
  recipientName: "",
  recipientPhone: "",
  isSurprise: false,
  doNotCallRecipient: false,
};

function createOperationId(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${prefix}:${random}`.slice(0, 180);
}

function safeContactPreference(
  value: unknown,
): WebCheckoutContactPreference {
  return value === "phone_call" || value === "messenger_only"
    ? value
    : "call_or_message";
}

function formFromProfileAndDraft(
  customer: CustomerProfile,
  draft: CheckoutDraftSnapshot | null,
): WebCheckoutCustomerRecipientData {
  const data = draft?.data || {};
  const same = data.recipientSameAsCustomer === true;

  return {
    customerName: String(data.customerName || customer.name || ""),
    customerPhone: customer.phone,
    customerEmail: String(data.customerEmail ?? customer.email ?? ""),
    contactPreference: safeContactPreference(data.contactPreference),
    recipientSameAsCustomer: same,
    recipientName: same
      ? String(data.customerName || customer.name || "")
      : String(data.recipientName || ""),
    recipientPhone: same
      ? customer.phone
      : String(data.recipientPhone || ""),
    isSurprise: same ? false : data.isSurprise === true,
    doNotCallRecipient: same ? false : data.doNotCallRecipient === true,
  };
}

function issueMap(
  local: WebCheckoutContactIssue[],
  server: ServerContactValidation | null,
) {
  const map = new Map<string, string>();

  for (const issue of server?.issues || []) {
    if (issue.severity === "error" && issue.field && issue.message) {
      map.set(issue.field, issue.message);
    }
  }

  for (const issue of local) {
    map.set(issue.field, issue.message);
  }

  return map;
}

function sourceLabel(source: unknown) {
  if (source === "telegram") return "Продолжено из Telegram";
  if (source === "max") return "Продолжено из MAX";
  return "Общий черновик сайта и Telegram";
}

function expiryText(value: string | undefined) {
  if (!value) return "Черновик хранится 24 часа";

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Черновик хранится 24 часа";

  return `Черновик сохранён до ${new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp))}`;
}

export function CheckoutClient() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [pageMessage, setPageMessage] = useState("");
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [draft, setDraft] = useState<CheckoutDraftSnapshot | null>(null);
  const [serverValidation, setServerValidation] =
    useState<ServerContactValidation | null>(null);
  const [form, setForm] = useState<WebCheckoutCustomerRecipientData>(
    EMPTY_FORM,
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [showValidation, setShowValidation] = useState(false);
  const initializedRef = useRef(false);
  const lastSavedFingerprintRef = useRef("");
  const saveRequestRef = useRef(0);

  const loadCheckout = useCallback(async () => {
    setPageState("loading");
    setPageMessage("");
    setSaveMessage("");
    initializedRef.current = false;

    try {
      const accountResponse = await fetch("/api/public/account/me", {
        credentials: "include",
        cache: "no-store",
      });

      if (accountResponse.status === 401) {
        setPageState("unauthorized");
        return;
      }

      const accountData = await accountResponse.json() as AccountResponse;

      if (!accountResponse.ok || !accountData.customer) {
        throw new Error(accountData.message || "Не удалось загрузить профиль");
      }

      setCustomer(accountData.customer);

      if (accountData.telegram?.connected !== true) {
        setPageState("telegram_required");
        return;
      }

      const draftResponse = await fetch(
        "/api/public/account/checkout-draft",
        {
          credentials: "include",
          cache: "no-store",
        },
      );
      const draftData = await draftResponse.json() as DraftResponse;

      if (
        draftResponse.status === 409
        && draftData.code === "telegram_not_connected"
      ) {
        setPageState("telegram_required");
        return;
      }

      if (!draftResponse.ok) {
        throw new Error(
          draftData.message || "Не удалось загрузить общий черновик",
        );
      }

      const nextDraft = draftData.draft || null;
      const nextForm = formFromProfileAndDraft(
        accountData.customer,
        nextDraft,
      );

      setDraft(nextDraft);
      setServerValidation(draftData.contactValidation || null);
      setForm(nextForm);
      lastSavedFingerprintRef.current = webCheckoutContactFingerprint(nextForm);
      initializedRef.current = true;
      setPageState("ready");
      setSaveState("saved");
      setSaveMessage(
        nextDraft
          ? sourceLabel(nextDraft.data._core?.sourceChannel)
          : "Можно начать оформление на сайте и продолжить в Telegram",
      );
    } catch (error) {
      setPageMessage(
        error instanceof Error
          ? error.message
          : "Не удалось открыть оформление",
      );
      setPageState("error");
    }
  }, []);

  useEffect(() => {
    void loadCheckout();
  }, [loadCheckout]);

  const localValidation = useMemo(
    () => validateWebCheckoutCustomerRecipient(form),
    [form],
  );
  const visibleIssues = useMemo(
    () => issueMap(
      showValidation ? localValidation.issues : [],
      showValidation ? serverValidation : null,
    ),
    [localValidation.issues, serverValidation, showValidation],
  );

  const updateForm = useCallback(
    <K extends keyof WebCheckoutCustomerRecipientData>(
      field: K,
      value: WebCheckoutCustomerRecipientData[K],
    ) => {
      setForm((current) => {
        const next = { ...current, [field]: value };

        if (field === "recipientSameAsCustomer" && value === true) {
          return {
            ...next,
            recipientName: current.customerName,
            recipientPhone: current.customerPhone,
            isSurprise: false,
            doNotCallRecipient: false,
          };
        }

        if (
          current.recipientSameAsCustomer
          && (field === "customerName" || field === "customerPhone")
        ) {
          return {
            ...next,
            recipientName: field === "customerName"
              ? String(value)
              : current.recipientName,
            recipientPhone: field === "customerPhone"
              ? String(value)
              : current.recipientPhone,
          };
        }

        return next;
      });
      setSaveState("idle");
      setSaveMessage("");
    },
    [],
  );

  const fetchLatestDraft = useCallback(async () => {
    const response = await fetch("/api/public/account/checkout-draft", {
      credentials: "include",
      cache: "no-store",
    });
    const data = await response.json() as DraftResponse;

    if (!response.ok) {
      throw new Error(data.message || "Не удалось обновить общий черновик");
    }

    return data;
  }, []);

  const saveDraft = useCallback(async (params: {
    explicit: boolean;
    retryConflict?: boolean;
  }) => {
    if (!initializedRef.current || pageState !== "ready") return false;

    const fingerprint = webCheckoutContactFingerprint(form);

    if (!params.explicit && fingerprint === lastSavedFingerprintRef.current) {
      return true;
    }

    const requestNumber = saveRequestRef.current + 1;
    saveRequestRef.current = requestNumber;
    setSaveState("saving");
    setSaveMessage(params.explicit ? "Сохраняем данные…" : "Автосохранение…");

    const performSave = async (
      expectedRevision: number,
      currentStep: WebCheckoutDraftStep | null,
      allowConflictRetry: boolean,
    ): Promise<SaveDraftResponse | null> => {
      const response = await fetch("/api/public/account/checkout-draft", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: createOperationId(
            params.explicit ? "web-checkout-continue" : "web-checkout-autosave",
          ),
          expectedRevision,
          step: preserveWebCheckoutProgressStep(currentStep),
          data: buildWebCheckoutCustomerRecipientPatch(form),
        }),
      });
      const data = await response.json() as SaveDraftResponse;

      if (
        response.status === 409
        && data.code === "checkout_draft_conflict"
        && allowConflictRetry
        && params.retryConflict !== false
      ) {
        const latest = await fetchLatestDraft();
        return performSave(
          latest.draft?.revision ?? Number(data.currentRevision || 0),
          latest.draft?.step || currentStep,
          false,
        );
      }

      if (response.status === 401) {
        setPageState("unauthorized");
        return null;
      }

      if (
        response.status === 409
        && data.code === "telegram_not_connected"
      ) {
        setPageState("telegram_required");
        return null;
      }

      if (!response.ok || !data.draft) {
        throw new Error(data.message || "Не удалось сохранить данные");
      }

      return data;
    };

    try {
      const result = await performSave(
        draft?.revision ?? 0,
        draft?.step || null,
        true,
      );

      if (!result) return false;

      if (requestNumber === saveRequestRef.current) {
        setDraft(result.draft || null);
        setServerValidation(result.contactValidation || null);
        lastSavedFingerprintRef.current = fingerprint;
        setSaveState("saved");
        setSaveMessage(
          params.explicit
            ? "Данные сохранены в общем черновике"
            : "Сохранено",
        );
      }

      return true;
    } catch (error) {
      if (requestNumber === saveRequestRef.current) {
        setSaveState("error");
        setSaveMessage(
          error instanceof Error
            ? error.message
            : "Не удалось сохранить данные",
        );
      }

      return false;
    }
  }, [draft, fetchLatestDraft, form, pageState]);

  useEffect(() => {
    if (!initializedRef.current || pageState !== "ready") return;

    const fingerprint = webCheckoutContactFingerprint(form);

    if (fingerprint === lastSavedFingerprintRef.current) return;

    const timer = window.setTimeout(() => {
      void saveDraft({ explicit: false });
    }, 900);

    return () => window.clearTimeout(timer);
  }, [form, pageState, saveDraft]);

  async function continueToDelivery() {
    setShowValidation(true);

    if (!localValidation.valid) {
      const firstIssue = localValidation.issues[0];
      document.getElementById(firstIssue?.field || "customerName")?.focus();
      setSaveState("error");
      setSaveMessage(firstIssue?.message || "Проверьте данные");
      return;
    }

    const saved = await saveDraft({ explicit: true });

    if (saved) {
      router.push("/checkout/delivery");
    }
  }

  if (pageState === "loading") {
    return (
      <main className={styles.page} aria-busy="true">
        <section className={styles.stateCard}>
          <span className={styles.eyebrow}>Оформление заказа</span>
          <h1>Загружаем общий черновик</h1>
          <p>Проверяем профиль и синхронизацию с Telegram.</p>
          <div className={styles.loadingBar} />
        </section>
      </main>
    );
  }

  if (pageState === "unauthorized") {
    return (
      <main className={styles.page}>
        <section className={styles.stateCard}>
          <span className={styles.eyebrow}>Защищённое оформление</span>
          <h1>Войдите в личный кабинет</h1>
          <p>
            Вход нужен, чтобы сохранить контакты на сервере и продолжить
            оформление с другого устройства или из Telegram.
          </p>
          <div className={styles.stateActions}>
            <Link className={styles.primaryLink} href="/account">
              Войти
            </Link>
            <Link className={styles.secondaryLink} href="/cart">
              Вернуться в корзину
            </Link>
          </div>
        </section>
      </main>
    );
  }

  if (pageState === "telegram_required") {
    return (
      <main className={styles.page}>
        <section className={styles.stateCard}>
          <span className={styles.eyebrow}>Единый черновик</span>
          <h1>Подключите Telegram</h1>
          <p>
            Общий checkout хранится в едином профиле. После подключения можно
            начать на сайте и продолжить в Telegram без повторного заполнения.
          </p>
          <div className={styles.stateActions}>
            <Link className={styles.primaryLink} href="/account#telegram">
              Подключить Telegram
            </Link>
            <Link className={styles.secondaryLink} href="/cart">
              Оформить обычным способом
            </Link>
          </div>
        </section>
      </main>
    );
  }

  if (pageState === "error") {
    return (
      <main className={styles.page}>
        <section className={styles.stateCard}>
          <span className={styles.eyebrow}>Оформление заказа</span>
          <h1>Не удалось открыть страницу</h1>
          <p>{pageMessage || "Попробуйте загрузить данные ещё раз."}</p>
          <div className={styles.stateActions}>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => void loadCheckout()}
            >
              Повторить
            </button>
            <Link className={styles.secondaryLink} href="/cart">
              Вернуться в корзину
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const source = draft?.data._core?.sourceChannel;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.backLink} href="/cart">
            ← Корзина
          </Link>
          <div className={styles.titleBlock}>
            <span className={styles.eyebrow}>Шаг 1 из 4</span>
            <h1>Покупатель и получатель</h1>
            <p>
              Контакты сохраняются в общем серверном черновике и доступны в
              Telegram после синхронизации.
            </p>
          </div>
          <div className={styles.progress} aria-label="Прогресс оформления">
            <span className={styles.progressActive}>1</span>
            <span>2</span>
            <span>3</span>
            <span>4</span>
          </div>
        </header>

        <div className={styles.syncNotice} role="status">
          <div>
            <strong>{sourceLabel(source)}</strong>
            <small>{expiryText(draft?.expiresAt)}</small>
          </div>
          <span
            className={[
              styles.saveBadge,
              saveState === "error" ? styles.saveBadgeError : "",
            ].filter(Boolean).join(" ")}
          >
            {saveState === "saving"
              ? "Сохраняем…"
              : saveState === "error"
                ? "Нужна проверка"
                : "Синхронизировано"}
          </span>
        </div>

        <div className={styles.grid}>
          <section className={styles.card}>
            <div className={styles.cardHeading}>
              <span>1</span>
              <div>
                <h2>Покупатель</h2>
                <p>С кем менеджер подтвердит заказ</p>
              </div>
            </div>

            <div className={styles.fields}>
              <label className={styles.field}>
                <span>Ваше имя *</span>
                <input
                  id="customerName"
                  value={form.customerName}
                  onChange={(event) => updateForm(
                    "customerName",
                    event.target.value.slice(0, 160),
                  )}
                  autoComplete="name"
                  maxLength={160}
                  aria-invalid={visibleIssues.has("customerName")}
                />
                {visibleIssues.get("customerName") ? (
                  <small className={styles.fieldError}>
                    {visibleIssues.get("customerName")}
                  </small>
                ) : null}
              </label>

              <label className={styles.field}>
                <span>Подтверждённый телефон</span>
                <input
                  id="customerPhone"
                  value={form.customerPhone}
                  readOnly
                  aria-readonly="true"
                  inputMode="tel"
                  autoComplete="tel"
                  aria-invalid={visibleIssues.has("customerPhone")}
                />
                <small>
                  Телефон связан с вашим профилем и Telegram-идентификацией.
                </small>
                {visibleIssues.get("customerPhone") ? (
                  <small className={styles.fieldError}>
                    {visibleIssues.get("customerPhone")}
                  </small>
                ) : null}
              </label>

              <label className={styles.field}>
                <span>Email</span>
                <input
                  id="customerEmail"
                  type="email"
                  value={form.customerEmail}
                  onChange={(event) => updateForm(
                    "customerEmail",
                    event.target.value.slice(0, 255),
                  )}
                  autoComplete="email"
                  maxLength={255}
                  placeholder="Для чека и уведомлений"
                  aria-invalid={visibleIssues.has("customerEmail")}
                />
                {visibleIssues.get("customerEmail") ? (
                  <small className={styles.fieldError}>
                    {visibleIssues.get("customerEmail")}
                  </small>
                ) : null}
              </label>

              <label className={styles.field}>
                <span>Как связаться</span>
                <select
                  value={form.contactPreference}
                  onChange={(event) => updateForm(
                    "contactPreference",
                    safeContactPreference(event.target.value),
                  )}
                >
                  <option value="call_or_message">Позвонить или написать</option>
                  <option value="phone_call">Лучше позвонить</option>
                  <option value="messenger_only">Только сообщение</option>
                </select>
              </label>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeading}>
              <span>2</span>
              <div>
                <h2>Получатель</h2>
                <p>Кому передать букет или подарок</p>
              </div>
            </div>

            <div className={styles.recipientMode}>
              <button
                type="button"
                className={form.recipientSameAsCustomer
                  ? styles.modeActive
                  : ""}
                aria-pressed={form.recipientSameAsCustomer}
                onClick={() => updateForm("recipientSameAsCustomer", true)}
              >
                <strong>Получатель — я</strong>
                <small>Используем данные покупателя</small>
              </button>
              <button
                type="button"
                className={!form.recipientSameAsCustomer
                  ? styles.modeActive
                  : ""}
                aria-pressed={!form.recipientSameAsCustomer}
                onClick={() => updateForm("recipientSameAsCustomer", false)}
              >
                <strong>Другой человек</strong>
                <small>Укажем отдельные контакты</small>
              </button>
            </div>

            {!form.recipientSameAsCustomer ? (
              <div className={styles.fields}>
                <label className={styles.field}>
                  <span>Имя получателя *</span>
                  <input
                    id="recipientName"
                    value={form.recipientName}
                    onChange={(event) => updateForm(
                      "recipientName",
                      event.target.value.slice(0, 160),
                    )}
                    autoComplete="off"
                    maxLength={160}
                    aria-invalid={visibleIssues.has("recipientName")}
                  />
                  {visibleIssues.get("recipientName") ? (
                    <small className={styles.fieldError}>
                      {visibleIssues.get("recipientName")}
                    </small>
                  ) : null}
                </label>

                <label className={styles.field}>
                  <span>Телефон получателя *</span>
                  <input
                    id="recipientPhone"
                    value={form.recipientPhone}
                    onChange={(event) => updateForm(
                      "recipientPhone",
                      event.target.value.slice(0, 32),
                    )}
                    inputMode="tel"
                    autoComplete="off"
                    maxLength={32}
                    placeholder="+7 999 000-00-00"
                    aria-invalid={visibleIssues.has("recipientPhone")}
                  />
                  {visibleIssues.get("recipientPhone") ? (
                    <small className={styles.fieldError}>
                      {visibleIssues.get("recipientPhone")}
                    </small>
                  ) : null}
                </label>

                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={form.isSurprise}
                    onChange={(event) => updateForm(
                      "isSurprise",
                      event.target.checked,
                    )}
                  />
                  <span>
                    <strong>Это сюрприз</strong>
                    <small>Не раскрывать содержание заказа заранее</small>
                  </span>
                </label>

                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={form.doNotCallRecipient}
                    onChange={(event) => updateForm(
                      "doNotCallRecipient",
                      event.target.checked,
                    )}
                  />
                  <span>
                    <strong>Не звонить получателю</strong>
                    <small>Связаться только с покупателем</small>
                  </span>
                </label>
              </div>
            ) : (
              <div className={styles.recipientSummary}>
                <span>Получатель</span>
                <strong>{form.customerName || customer?.name || "Покупатель"}</strong>
                <small>{form.customerPhone}</small>
              </div>
            )}
          </section>
        </div>

        <footer className={styles.actions}>
          <div className={styles.saveStatus} aria-live="polite">
            <strong>
              {saveState === "saving"
                ? "Сохраняем черновик"
                : saveState === "error"
                  ? "Проверьте данные"
                  : "Данные защищены"}
            </strong>
            <small>
              {saveMessage || "Изменения автоматически сохраняются на сервере"}
            </small>
          </div>

          <div className={styles.actionButtons}>
            <Link className={styles.secondaryLink} href="/cart">
              Назад
            </Link>
            <button
              className={styles.primaryButton}
              type="button"
              disabled={saveState === "saving"}
              onClick={() => void continueToDelivery()}
            >
              Продолжить к доставке
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
}
