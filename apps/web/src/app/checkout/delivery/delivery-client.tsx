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
import styles from "./delivery.module.css";
import {
  addDaysIso,
  buildWebCheckoutDeliveryPatch,
  clearStructuredDeliveryAddress,
  emptyWebCheckoutDeliveryData,
  moscowTodayIso,
  nextWebCheckoutDeliveryStep,
  normalizeWebCheckoutDeliveryData,
  preserveWebCheckoutDeliveryStep,
  savedAddressToDeliveryData,
  suggestionToDeliveryData,
  validateWebCheckoutDelivery,
  webCheckoutDeliveryFingerprint,
  type CheckoutDeliveryOptions,
  type DeliveryAddressSuggestion,
  type WebCheckoutDeliveryData,
  type WebCheckoutDeliveryIssue,
  type WebCheckoutDraftStep,
} from "./checkout-delivery";

type CheckoutDraftSnapshot = {
  linked: true;
  step: WebCheckoutDraftStep;
  data: Partial<WebCheckoutDeliveryData> & {
    _core?: { sourceChannel?: "site" | "telegram" | "max" };
  };
  revision: number;
  expiresAt: string;
  updatedAt: string;
};

type AccountResponse = {
  ok?: boolean;
  customer?: { id: string; name: string | null; phone: string };
  telegram?: { connected?: boolean };
  message?: string;
};

type OptionsResponse = {
  ok?: boolean;
  options?: CheckoutDeliveryOptions;
  message?: string;
};

type DraftResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
  draft?: CheckoutDraftSnapshot | null;
  currentRevision?: number;
};

type SuggestionResponse = {
  ok?: boolean;
  configured?: boolean;
  suggestions?: DeliveryAddressSuggestion[];
  message?: string;
};

type PageState =
  | "loading"
  | "ready"
  | "unauthorized"
  | "telegram_required"
  | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

function createOperationId(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${random}`.slice(0, 180);
}

function sourceLabel(source: unknown) {
  if (source === "telegram") return "Продолжено из Telegram";
  if (source === "max") return "Продолжено из MAX";
  return "Общий черновик сайта и Telegram";
}

function expiryText(value: string | undefined) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) return "Черновик хранится 24 часа";

  return `Черновик сохранён до ${new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp))}`;
}

function issueMap(issues: WebCheckoutDeliveryIssue[]) {
  const map = new Map<string, string>();
  for (const issue of issues) map.set(issue.field, issue.message);
  return map;
}

function money(value: number) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

export function CheckoutDeliveryClient() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [pageMessage, setPageMessage] = useState("");
  const [options, setOptions] = useState<CheckoutDeliveryOptions | null>(null);
  const [draft, setDraft] = useState<CheckoutDraftSnapshot | null>(null);
  const [form, setForm] = useState<WebCheckoutDeliveryData>(
    emptyWebCheckoutDeliveryData(),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [showValidation, setShowValidation] = useState(false);
  const [suggestions, setSuggestions] = useState<DeliveryAddressSuggestion[]>([]);
  const [suggestionState, setSuggestionState] = useState<
    "idle" | "loading" | "ready" | "disabled" | "error"
  >("idle");
  const [suggestionMessage, setSuggestionMessage] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const initializedRef = useRef(false);
  const lastSavedFingerprintRef = useRef("");
  const saveRequestRef = useRef(0);
  const suggestionRequestRef = useRef(0);

  const loadPage = useCallback(async () => {
    setPageState("loading");
    setPageMessage("");
    initializedRef.current = false;

    try {
      const [accountResponse, optionsResponse] = await Promise.all([
        fetch("/api/public/account/me", {
          credentials: "include",
          cache: "no-store",
        }),
        fetch("/api/public/account/checkout-options", {
          credentials: "include",
          cache: "no-store",
        }),
      ]);

      if (accountResponse.status === 401 || optionsResponse.status === 401) {
        setPageState("unauthorized");
        return;
      }

      const accountData = await accountResponse.json() as AccountResponse;
      const optionsData = await optionsResponse.json() as OptionsResponse;

      if (!accountResponse.ok || !accountData.customer) {
        throw new Error(accountData.message || "Не удалось загрузить профиль");
      }
      if (!optionsResponse.ok || !optionsData.options) {
        throw new Error(optionsData.message || "Не удалось загрузить доставку");
      }
      if (accountData.telegram?.connected !== true) {
        setPageState("telegram_required");
        return;
      }

      const draftResponse = await fetch("/api/public/account/checkout-draft", {
        credentials: "include",
        cache: "no-store",
      });
      const draftData = await draftResponse.json() as DraftResponse;

      if (
        draftResponse.status === 409
        && draftData.code === "telegram_not_connected"
      ) {
        setPageState("telegram_required");
        return;
      }
      if (!draftResponse.ok) {
        throw new Error(draftData.message || "Не удалось загрузить черновик");
      }

      const nextOptions = optionsData.options;
      const nextDraft = draftData.draft || null;
      const nextForm = normalizeWebCheckoutDeliveryData(nextDraft?.data);

      if (!nextForm.deliveryZoneId && nextOptions.zones.length === 1) {
        nextForm.deliveryZoneId = nextOptions.zones[0]?.id || "";
        nextForm.deliveryZoneName = nextOptions.zones[0]?.name || "";
      }
      if (!nextForm.deliveryIntervalId && nextOptions.intervals.length === 1) {
        nextForm.deliveryIntervalId = nextOptions.intervals[0]?.id || "";
        nextForm.deliveryInterval = nextOptions.intervals[0]?.name || "";
      }
      if (!nextForm.deliveryDateText) {
        nextForm.deliveryDateText = moscowTodayIso();
      }

      setOptions(nextOptions);
      setDraft(nextDraft);
      setForm(nextForm);
      lastSavedFingerprintRef.current = webCheckoutDeliveryFingerprint(
        nextForm,
        nextOptions,
      );
      initializedRef.current = true;
      setPageState("ready");
      setSaveState("saved");
      setSaveMessage(
        nextDraft
          ? sourceLabel(nextDraft.data._core?.sourceChannel)
          : "Можно продолжить оформление на сайте или в Telegram",
      );
    } catch (error) {
      setPageMessage(
        error instanceof Error ? error.message : "Не удалось открыть доставку",
      );
      setPageState("error");
    }
  }, []);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const validation = useMemo(
    () => options
      ? validateWebCheckoutDelivery(form, options)
      : { valid: false, issues: [] },
    [form, options],
  );
  const visibleIssues = useMemo(
    () => issueMap(showValidation ? validation.issues : []),
    [showValidation, validation.issues],
  );

  const updateForm = useCallback(<K extends keyof WebCheckoutDeliveryData>(
    field: K,
    value: WebCheckoutDeliveryData[K],
  ) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveState("idle");
    setSaveMessage("");
  }, []);

  const updateAddressText = useCallback((value: string) => {
    setForm((current) => ({
      ...current,
      ...clearStructuredDeliveryAddress(value),
      deliveryComment: current.deliveryComment,
    }));
    setSuggestionsOpen(value.trim().length >= 3);
    setSaveState("idle");
    setSaveMessage("");
  }, []);

  useEffect(() => {
    if (pageState !== "ready" || form.deliveryType !== "delivery") return;
    const query = form.deliveryAddress.trim();

    if (form.deliveryAddressSelected || query.length < 3) {
      setSuggestions([]);
      setSuggestionState("idle");
      return;
    }

    const timer = window.setTimeout(async () => {
      const requestNumber = suggestionRequestRef.current + 1;
      suggestionRequestRef.current = requestNumber;
      setSuggestionState("loading");
      setSuggestionMessage("");

      try {
        const response = await fetch("/api/public/account/address-suggestions", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, count: 7 }),
        });
        const data = await response.json() as SuggestionResponse;
        if (requestNumber !== suggestionRequestRef.current) return;

        if (response.status === 401) {
          setPageState("unauthorized");
          return;
        }
        if (!response.ok) {
          setSuggestions([]);
          setSuggestionState("error");
          setSuggestionMessage(
            data.message || "Подсказки недоступны — подтвердите адрес вручную",
          );
          return;
        }
        if (data.configured === false) {
          setSuggestions([]);
          setSuggestionState("disabled");
          setSuggestionMessage(
            "Автоподсказки ещё не подключены. Проверьте адрес и подтвердите ручной ввод.",
          );
          return;
        }

        const nextSuggestions = Array.isArray(data.suggestions)
          ? data.suggestions
          : [];
        setSuggestions(nextSuggestions);
        setSuggestionState("ready");
        setSuggestionsOpen(true);
        setSuggestionMessage(
          nextSuggestions.length === 0
            ? "Ничего не найдено. Дополните адрес или подтвердите ручной ввод."
            : "",
        );
      } catch {
        if (requestNumber !== suggestionRequestRef.current) return;
        setSuggestions([]);
        setSuggestionState("error");
        setSuggestionMessage(
          "Подсказки временно недоступны — адрес можно подтвердить вручную",
        );
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [form.deliveryAddress, form.deliveryAddressSelected, form.deliveryType, pageState]);

  const fetchLatestDraft = useCallback(async () => {
    const response = await fetch("/api/public/account/checkout-draft", {
      credentials: "include",
      cache: "no-store",
    });
    const data = await response.json() as DraftResponse;
    if (!response.ok) {
      throw new Error(data.message || "Не удалось обновить черновик");
    }
    return data;
  }, []);

  const saveDraft = useCallback(async (explicit: boolean) => {
    if (!initializedRef.current || pageState !== "ready" || !options) {
      return false;
    }

    const fingerprint = webCheckoutDeliveryFingerprint(form, options);
    if (!explicit && fingerprint === lastSavedFingerprintRef.current) {
      return true;
    }

    const requestNumber = saveRequestRef.current + 1;
    saveRequestRef.current = requestNumber;
    setSaveState("saving");
    setSaveMessage(explicit ? "Сохраняем доставку…" : "Автосохранение…");

    const performSave = async (
      expectedRevision: number,
      currentStep: WebCheckoutDraftStep | null,
      allowRetry: boolean,
    ): Promise<DraftResponse | null> => {
      const desiredStep = nextWebCheckoutDeliveryStep(form, options);
      const response = await fetch("/api/public/account/checkout-draft", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: createOperationId(
            explicit ? "web-delivery-continue" : "web-delivery-autosave",
          ),
          expectedRevision,
          step: preserveWebCheckoutDeliveryStep(currentStep, desiredStep),
          data: buildWebCheckoutDeliveryPatch(form, options),
        }),
      });
      const data = await response.json() as DraftResponse;

      if (
        response.status === 409
        && data.code === "checkout_draft_conflict"
        && allowRetry
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
        throw new Error(data.message || "Не удалось сохранить доставку");
      }
      return data;
    };

    try {
      const result = await performSave(
        draft?.revision ?? 0,
        draft?.step || null,
        true,
      );
      if (!result?.draft) return false;

      if (requestNumber === saveRequestRef.current) {
        setDraft(result.draft);
        lastSavedFingerprintRef.current = fingerprint;
        setSaveState("saved");
        setSaveMessage(explicit ? "Доставка сохранена" : "Сохранено");
      }
      return true;
    } catch (error) {
      if (requestNumber === saveRequestRef.current) {
        setSaveState("error");
        setSaveMessage(
          error instanceof Error ? error.message : "Не удалось сохранить",
        );
      }
      return false;
    }
  }, [draft, fetchLatestDraft, form, options, pageState]);

  useEffect(() => {
    if (!initializedRef.current || pageState !== "ready" || !options) return;
    const fingerprint = webCheckoutDeliveryFingerprint(form, options);
    if (fingerprint === lastSavedFingerprintRef.current) return;

    const timer = window.setTimeout(() => {
      void saveDraft(false);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [form, options, pageState, saveDraft]);

  async function continueCheckout() {
    if (!options) return;
    setShowValidation(true);

    if (!validation.valid) {
      const first = validation.issues[0];
      document.getElementById(first?.field || "delivery")?.focus();
      setSaveState("error");
      setSaveMessage(first?.message || "Проверьте данные доставки");
      return;
    }

    const saved = await saveDraft(true);
    if (saved) router.push("/cart#checkout-delivery");
  }

  if (pageState === "loading") {
    return (
      <main className={styles.page} aria-busy="true">
        <section className={styles.stateCard}>
          <span className={styles.eyebrow}>Шаг 2 из 4</span>
          <h1>Загружаем доставку</h1>
          <p>Получаем зоны, интервалы, сохранённые адреса и общий черновик.</p>
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
          <p>Вход нужен для безопасного сохранения адреса и доставки.</p>
          <div className={styles.stateActions}>
            <Link className={styles.primaryLink} href="/account">Войти</Link>
            <Link className={styles.secondaryLink} href="/cart">В корзину</Link>
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
          <p>После подключения адрес и дата будут одинаковыми на сайте и в боте.</p>
          <div className={styles.stateActions}>
            <Link className={styles.primaryLink} href="/account#telegram">Подключить Telegram</Link>
            <Link className={styles.secondaryLink} href="/cart">Оформить в корзине</Link>
          </div>
        </section>
      </main>
    );
  }

  if (pageState === "error" || !options) {
    return (
      <main className={styles.page}>
        <section className={styles.stateCard}>
          <span className={styles.eyebrow}>Доставка</span>
          <h1>Не удалось открыть страницу</h1>
          <p>{pageMessage || "Попробуйте загрузить данные ещё раз."}</p>
          <div className={styles.stateActions}>
            <button className={styles.primaryButton} type="button" onClick={() => void loadPage()}>
              Повторить
            </button>
            <Link className={styles.secondaryLink} href="/cart">В корзину</Link>
          </div>
        </section>
      </main>
    );
  }

  const zone = options.zones.find((item) => item.id === form.deliveryZoneId);
  const source = draft?.data._core?.sourceChannel;
  const minDate = moscowTodayIso();
  const maxDate = addDaysIso(minDate, 180);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.backLink} href="/checkout">← Контакты</Link>
          <div className={styles.titleBlock}>
            <span className={styles.eyebrow}>Шаг 2 из 4</span>
            <h1>Доставка и адрес</h1>
            <p>Выберите способ получения, точный адрес, дату и удобный интервал.</p>
          </div>
          <div className={styles.progress} aria-label="Прогресс оформления">
            <span className={styles.progressDone}>✓</span>
            <span className={styles.progressActive}>2</span>
            <span>3</span>
            <span>4</span>
          </div>
        </header>

        <div className={styles.syncNotice} role="status">
          <div>
            <strong>{sourceLabel(source)}</strong>
            <small>{expiryText(draft?.expiresAt)}</small>
          </div>
          <span className={`${styles.saveBadge} ${saveState === "error" ? styles.saveBadgeError : ""}`}>
            {saveState === "saving" ? "Сохраняем…" : saveState === "error" ? "Нужна проверка" : "Синхронизировано"}
          </span>
        </div>

        {!options.acceptingOrders ? (
          <div className={styles.warning}>{options.ordersPausedMessage}</div>
        ) : null}

        <section className={styles.card}>
          <div className={styles.cardHeading}>
            <span>1</span>
            <div><h2>Способ получения</h2><p>Курьером или самостоятельно</p></div>
          </div>
          <div className={styles.choiceGrid} id="deliveryType">
            <button
              type="button"
              className={`${styles.choice} ${form.deliveryType === "delivery" ? styles.choiceActive : ""}`}
              onClick={() => updateForm("deliveryType", "delivery")}
            >
              <strong>Доставка курьером</strong>
              <small>Адрес, дата и интервал</small>
            </button>
            <button
              type="button"
              disabled={!options.pickup.enabled}
              className={`${styles.choice} ${form.deliveryType === "pickup" ? styles.choiceActive : ""}`}
              onClick={() => updateForm("deliveryType", "pickup")}
            >
              <strong>Самовывоз</strong>
              <small>{options.pickup.enabled ? options.pickup.address || "Адрес уточнит менеджер" : "Сейчас недоступен"}</small>
            </button>
          </div>
          {visibleIssues.get("deliveryType") ? <p className={styles.formError}>{visibleIssues.get("deliveryType")}</p> : null}
        </section>

        {form.deliveryType === "delivery" ? (
          <>
            <div className={styles.twoColumns}>
              <section className={styles.card}>
                <div className={styles.cardHeading}>
                  <span>2</span>
                  <div><h2>Зона и скорость</h2><p>Стоимость рассчитает сервер</p></div>
                </div>
                <label className={styles.field}>
                  <span>Зона доставки *</span>
                  <select
                    id="deliveryZoneId"
                    value={form.deliveryZoneId}
                    aria-invalid={Boolean(visibleIssues.get("deliveryZoneId"))}
                    onChange={(event) => {
                      const selected = options.zones.find((item) => item.id === event.target.value);
                      setForm((current) => ({
                        ...current,
                        deliveryZoneId: event.target.value,
                        deliveryZoneName: selected?.name || "",
                        deliveryService: current.deliveryService === "express" && !selected?.expressAvailable ? "standard" : current.deliveryService,
                      }));
                      setSaveState("idle");
                    }}
                  >
                    <option value="">Выберите зону</option>
                    {options.zones.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} — {money(item.price)}
                      </option>
                    ))}
                  </select>
                  {visibleIssues.get("deliveryZoneId") ? <small className={styles.fieldError}>{visibleIssues.get("deliveryZoneId")}</small> : null}
                </label>
                <div className={styles.serviceGrid} id="deliveryService">
                  <button
                    type="button"
                    className={`${styles.serviceChoice} ${form.deliveryService === "standard" ? styles.serviceChoiceActive : ""}`}
                    onClick={() => updateForm("deliveryService", "standard")}
                  >
                    <strong>Обычная</strong><small>{zone ? money(zone.price) : "после выбора зоны"}</small>
                  </button>
                  <button
                    type="button"
                    disabled={!zone?.expressAvailable || !zone.expressPrice}
                    className={`${styles.serviceChoice} ${form.deliveryService === "express" ? styles.serviceChoiceActive : ""}`}
                    onClick={() => updateForm("deliveryService", "express")}
                  >
                    <strong>Срочная</strong><small>{zone?.expressAvailable && zone.expressPrice ? money(zone.expressPrice) : "недоступна"}</small>
                  </button>
                </div>
                {visibleIssues.get("deliveryService") ? <p className={styles.formError}>{visibleIssues.get("deliveryService")}</p> : null}
              </section>

              <section className={styles.card}>
                <div className={styles.cardHeading}>
                  <span>3</span>
                  <div><h2>Дата и интервал</h2><p>До 180 дней вперёд</p></div>
                </div>
                <div className={styles.fields}>
                  <label className={styles.field}>
                    <span>Дата доставки *</span>
                    <input
                      id="deliveryDateText"
                      type="date"
                      min={minDate}
                      max={maxDate}
                      value={form.deliveryDateText}
                      aria-invalid={Boolean(visibleIssues.get("deliveryDateText"))}
                      onChange={(event) => updateForm("deliveryDateText", event.target.value)}
                    />
                    {visibleIssues.get("deliveryDateText") ? <small className={styles.fieldError}>{visibleIssues.get("deliveryDateText")}</small> : null}
                  </label>
                  <label className={styles.field}>
                    <span>Интервал *</span>
                    <select
                      id="deliveryIntervalId"
                      value={form.deliveryIntervalId}
                      aria-invalid={Boolean(visibleIssues.get("deliveryIntervalId"))}
                      onChange={(event) => {
                        const selected = options.intervals.find((item) => item.id === event.target.value);
                        setForm((current) => ({ ...current, deliveryIntervalId: event.target.value, deliveryInterval: selected?.name || "" }));
                        setSaveState("idle");
                      }}
                    >
                      <option value="">Выберите интервал</option>
                      {options.intervals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    {visibleIssues.get("deliveryIntervalId") ? <small className={styles.fieldError}>{visibleIssues.get("deliveryIntervalId")}</small> : null}
                  </label>
                </div>
              </section>
            </div>

            <section className={styles.card}>
              <div className={styles.cardHeading}>
                <span>4</span>
                <div><h2>Точный адрес</h2><p>Начните вводить — появятся подходящие варианты</p></div>
              </div>

              {options.addresses.length > 0 ? (
                <div className={styles.savedAddresses}>
                  <span>Сохранённые адреса</span>
                  <div>
                    {options.addresses.map((address) => (
                      <button
                        key={address.id}
                        type="button"
                        onClick={() => {
                          setForm((current) => ({ ...current, ...savedAddressToDeliveryData(address) }));
                          setSuggestions([]);
                          setSuggestionsOpen(false);
                          setSaveState("idle");
                        }}
                      >
                        {address.isDefault ? "★ " : ""}{[address.city, address.street, address.house ? `д. ${address.house}` : "", address.apartment ? `кв. ${address.apartment}` : ""].filter(Boolean).join(", ")}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className={styles.addressWrap}>
                <label className={styles.field}>
                  <span>Город, улица и дом *</span>
                  <input
                    id="deliveryAddress"
                    type="text"
                    autoComplete="street-address"
                    value={form.deliveryAddress}
                    aria-invalid={Boolean(visibleIssues.get("deliveryAddress"))}
                    placeholder="Например: Москва, ул. Тверская, д. 10"
                    onChange={(event) => updateAddressText(event.target.value)}
                    onFocus={() => setSuggestionsOpen(true)}
                  />
                  {form.deliveryAddressSelected ? (
                    <small className={styles.addressConfirmed}>✓ Адрес подтверждён</small>
                  ) : suggestionState === "loading" ? (
                    <small>Ищем адрес…</small>
                  ) : suggestionMessage ? (
                    <small>{suggestionMessage}</small>
                  ) : (
                    <small>Выберите подсказку с номером дома или подтвердите ручной ввод.</small>
                  )}
                  {visibleIssues.get("deliveryAddress") ? <small className={styles.fieldError}>{visibleIssues.get("deliveryAddress")}</small> : null}
                </label>

                {suggestionsOpen && suggestions.length > 0 ? (
                  <div className={styles.suggestions} role="listbox" aria-label="Подсказки адреса">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion.id}
                        type="button"
                        role="option"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setForm((current) => ({ ...current, ...suggestionToDeliveryData(suggestion) }));
                          setSuggestions([]);
                          setSuggestionsOpen(false);
                          setSuggestionMessage("");
                          setSaveState("idle");
                        }}
                      >
                        <strong>{suggestion.value}</strong>
                        <small>{suggestion.hasHouse ? "Точный адрес" : "Укажите номер дома"}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {!form.deliveryAddressSelected && form.deliveryAddress.trim().length >= 5 ? (
                <button
                  type="button"
                  className={styles.manualButton}
                  onClick={() => {
                    setForm((current) => ({ ...current, deliveryAddressSelected: true, deliveryAddressProvider: "manual" }));
                    setSuggestions([]);
                    setSuggestionsOpen(false);
                    setSaveState("idle");
                  }}
                >
                  Подтвердить адрес вручную
                </button>
              ) : null}

              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={form.deliveryNoApartment}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    deliveryNoApartment: event.target.checked,
                    deliveryApartment: event.target.checked ? "" : current.deliveryApartment,
                  }))}
                />
                <span><strong>Частный дом / квартиры нет</strong><small>Поле квартиры станет необязательным</small></span>
              </label>

              <div className={styles.detailGrid}>
                {!form.deliveryNoApartment ? (
                  <label className={styles.field}>
                    <span>Квартира / офис *</span>
                    <input id="deliveryApartment" value={form.deliveryApartment} aria-invalid={Boolean(visibleIssues.get("deliveryApartment"))} onChange={(event) => updateForm("deliveryApartment", event.target.value)} />
                    {visibleIssues.get("deliveryApartment") ? <small className={styles.fieldError}>{visibleIssues.get("deliveryApartment")}</small> : null}
                  </label>
                ) : null}
                <label className={styles.field}><span>Подъезд</span><input value={form.deliveryEntrance} onChange={(event) => updateForm("deliveryEntrance", event.target.value)} /></label>
                <label className={styles.field}><span>Этаж</span><input value={form.deliveryFloor} onChange={(event) => updateForm("deliveryFloor", event.target.value)} /></label>
                <label className={styles.field}><span>Код домофона</span><input value={form.deliveryIntercom} onChange={(event) => updateForm("deliveryIntercom", event.target.value)} /></label>
              </div>

              <label className={styles.field}>
                <span>Комментарий курьеру</span>
                <textarea
                  value={form.deliveryComment}
                  maxLength={1000}
                  placeholder="Шлагбаум, вход со двора, позвонить за 5 минут…"
                  onChange={(event) => updateForm("deliveryComment", event.target.value)}
                />
              </label>
            </section>
          </>
        ) : (
          <section className={styles.card}>
            <div className={styles.pickupSummary}>
              <strong>Адрес самовывоза</strong>
              <p>{options.pickup.address || "Адрес и время готовности подтвердит менеджер."}</p>
            </div>
          </section>
        )}

        <footer className={styles.footer}>
          <div>
            <strong>{saveMessage || "Изменения сохраняются автоматически"}</strong>
            <small>Ключ адресного сервиса не передаётся в браузер.</small>
          </div>
          <div className={styles.footerActions}>
            <Link className={styles.secondaryLink} href="/checkout">Назад</Link>
            <button className={styles.primaryButton} type="button" disabled={saveState === "saving" || !options.acceptingOrders} onClick={() => void continueCheckout()}>
              Продолжить оформление
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
}
