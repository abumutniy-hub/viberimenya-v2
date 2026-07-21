"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ChangeEvent } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { clearLinkedCustomerCart } from "../../lib/customer-cart-sync";
import styles from "./review.module.css";
import {
  availableWebCheckoutPaymentMethods,
  buildWebCheckoutOrderBody,
  buildWebCheckoutReviewPatch,
  normalizeWebCheckoutReviewData,
  preserveWebCheckoutReviewStep,
  validateWebCheckoutReview,
  webCheckoutReviewFingerprint,
  type CheckoutDraftOrderData,
  type CheckoutPaymentOptions,
  type WebCheckoutDraftStep,
  type WebCheckoutPaymentMethod,
  type WebCheckoutReviewData,
} from "./checkout-review";

type CheckoutQuoteIssue = {
  code: string;
  field: string;
  message: string;
  severity: "error" | "warning";
};

type CheckoutQuote = {
  quotedAt: string;
  quoteHash: string;
  itemCount: number;
  quantityCount: number;
  subtotal: number;
  minimumOrderAmount: number;
  deliveryPrice: number;
  deliveryTariffName: string;
  discountTotal: number;
  promoCode: string;
  bonusRequested: number;
  bonusAvailable: number;
  bonusApplied: number;
  total: number;
  currency: "RUB";
  readyForConfirmation: boolean;
  issues: CheckoutQuoteIssue[];
};

type CheckoutDraftSnapshot = {
  linked: true;
  step: WebCheckoutDraftStep;
  data: CheckoutDraftOrderData & {
    deliveryZoneName?: string;
    _core?: {
      sourceChannel?: "site" | "telegram" | "max";
      quote?: CheckoutQuote | null;
    };
  };
  revision: number;
  expiresAt: string;
  updatedAt: string;
};

type CheckoutCartItem = {
  productId: string;
  slug: string;
  name: string;
  price: number;
  quantity: number;
  availability: "available" | "preorder";
  imageUrl: string | null;
  imageAlt: string | null;
};

type CheckoutCart = {
  linked: boolean;
  items: CheckoutCartItem[];
  removed: Array<{ productId: string; name: string; reason: string }>;
  itemCount: number;
  quantityCount: number;
  subtotal: number;
};

type CheckoutOptions = {
  pickup: { enabled: boolean; address: string; note: string };
  acceptingOrders: boolean;
  maintenanceMode: boolean;
  ordersPausedMessage: string;
  paymentMethods: CheckoutPaymentOptions;
};

type OptionsResponse = {
  ok?: boolean;
  options?: CheckoutOptions;
  message?: string;
};

type DraftResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
  draft?: CheckoutDraftSnapshot | null;
  currentRevision?: number;
};

type CartResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
  cart?: CheckoutCart;
};

type OrderResult = {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  discountTotal: number;
  bonusSpent: number;
  deliveryPrice: number;
  deliveryTariffName: string;
  trackingToken: string;
  paymentMethod: WebCheckoutPaymentMethod;
  telegramLinkCode?: string | null;
  reused: boolean;
};

type OrderResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  order?: OrderResult;
};

type PageState =
  | "loading"
  | "ready"
  | "empty"
  | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

function createOperationId(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${random}`.slice(0, 180);
}

function money(value: number) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

function sourceLabel(source: unknown) {
  if (source === "telegram") return "Продолжено из Telegram";
  if (source === "max") return "Продолжено из MAX";
  return "Черновик оформления на этом устройстве";
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

function paymentTitle(method: WebCheckoutPaymentMethod) {
  const map: Record<WebCheckoutPaymentMethod, string> = {
    transfer_after_confirm: "Перевод после подтверждения",
    cash_on_delivery: "Оплата при получении",
    online_card: "Банковской картой онлайн",
    sbp: "Через СБП",
  };
  return map[method];
}

function paymentDescription(method: WebCheckoutPaymentMethod) {
  if (method === "online_card" || method === "sbp") {
    return "Ссылка появится на странице заказа после проверки и подтверждения менеджером.";
  }
  if (method === "cash_on_delivery") {
    return "Оплата производится при получении заказа, если способ разрешён магазином.";
  }
  return "Менеджер подтвердит заказ и отправит реквизиты или инструкцию по оплате.";
}

function deliverySummary(data: CheckoutDraftSnapshot["data"], options: CheckoutOptions) {
  if (data.deliveryType === "pickup") {
    return {
      title: "Самовывоз",
      text: options.pickup.address || "Адрес подтвердит менеджер",
      detail: options.pickup.note || "Время готовности появится после подтверждения заказа",
    };
  }

  const details = [
    data.deliveryApartment && !data.deliveryNoApartment
      ? `кв./офис ${data.deliveryApartment}`
      : data.deliveryNoApartment
        ? "без квартиры"
        : "",
    data.deliveryEntrance ? `подъезд ${data.deliveryEntrance}` : "",
    data.deliveryFloor ? `этаж ${data.deliveryFloor}` : "",
    data.deliveryIntercom ? `домофон ${data.deliveryIntercom}` : "",
  ].filter(Boolean).join(" · ");

  return {
    title: data.deliveryService === "express" ? "Срочная доставка" : "Доставка",
    text: data.deliveryAddress || "Адрес не указан",
    detail: [
      data.deliveryDateText || "",
      data.deliveryInterval || "",
      details,
    ].filter(Boolean).join(" · "),
  };
}

function errorNavigation(field: string) {
  if ([
    "customerName",
    "customerPhone",
    "customerEmail",
    "recipientName",
    "recipientPhone",
  ].includes(field)) return "/checkout";

  if ([
    "deliveryType",
    "deliveryService",
    "deliveryZoneId",
    "deliveryDateText",
    "deliveryIntervalId",
    "deliveryAddress",
  ].includes(field)) return "/checkout/delivery";

  if (field === "items") return "/cart";
  return null;
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json().catch(() => ({})) as T;
}

export function CheckoutReviewClient() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [pageMessage, setPageMessage] = useState("");
  const [options, setOptions] = useState<CheckoutOptions | null>(null);
  const [draft, setDraft] = useState<CheckoutDraftSnapshot | null>(null);
  const [cart, setCart] = useState<CheckoutCart | null>(null);
  const [form, setForm] = useState<WebCheckoutReviewData | null>(null);
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [showValidation, setShowValidation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const initializedRef = useRef(false);
  const lastSavedFingerprintRef = useRef("");
  const saveRequestRef = useRef(0);

  const fetchLatestDraft = useCallback(async () => {
    const response = await fetch("/api/public/account/checkout-draft", {
      credentials: "include",
      cache: "no-store",
    });
    const data = await readJson<DraftResponse>(response);
    if (!response.ok || !data.draft) {
      throw new Error(data.message || "Не удалось обновить черновик");
    }
    setDraft(data.draft);
    return data.draft;
  }, []);

  const requestQuote = useCallback(async (
    sourceDraft: CheckoutDraftSnapshot,
    retryOnConflict = true,
  ): Promise<CheckoutDraftSnapshot> => {
    const response = await fetch("/api/public/account/checkout-draft/quote", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: createOperationId("site-review-quote"),
        expectedRevision: sourceDraft.revision,
      }),
    });
    const data = await readJson<DraftResponse>(response);

    if (
      response.status === 409
      && data.code === "checkout_draft_conflict"
      && retryOnConflict
    ) {
      const latest = await fetchLatestDraft();
      return requestQuote(latest, false);
    }

    if (!response.ok || !data.draft) {
      throw new Error(data.message || "Не удалось рассчитать заказ");
    }

    setDraft(data.draft);
    setQuote(data.draft.data._core?.quote || null);
    return data.draft;
  }, [fetchLatestDraft]);

  const loadPage = useCallback(async () => {
    setPageState("loading");
    setPageMessage("");
    initializedRef.current = false;

    try {
      const [optionsResponse, draftResponse, cartResponse] = await Promise.all([
        fetch("/api/public/account/checkout-options", { credentials: "include", cache: "no-store" }),
        fetch("/api/public/account/checkout-draft", { credentials: "include", cache: "no-store" }),
        fetch("/api/public/account/cart", { credentials: "include", cache: "no-store" }),
      ]);

      const optionsData = await readJson<OptionsResponse>(optionsResponse);
      const draftData = await readJson<DraftResponse>(draftResponse);
      const cartData = await readJson<CartResponse>(cartResponse);

      if (!optionsResponse.ok || !optionsData.options) {
        throw new Error(optionsData.message || "Не удалось загрузить настройки заказа");
      }
      if (!draftResponse.ok || !draftData.draft) {
        throw new Error(draftData.message || "Сначала заполните контакты и доставку");
      }
      if (!cartResponse.ok || !cartData.cart) {
        throw new Error(cartData.message || "Не удалось загрузить корзину");
      }
      if (cartData.cart.items.length === 0) {
        setCart(cartData.cart);
        setPageState("empty");
        return;
      }

      const nextOptions = optionsData.options;
      const nextDraft = draftData.draft;
      const nextForm = normalizeWebCheckoutReviewData(nextDraft.data, nextOptions.paymentMethods);

      setOptions(nextOptions);
      setDraft(nextDraft);
      setCart(cartData.cart);
      setForm(nextForm);
      setQuote(nextDraft.data._core?.quote || null);
      lastSavedFingerprintRef.current = webCheckoutReviewFingerprint(nextForm);
      initializedRef.current = true;
      setSaveState("saved");
      setSaveMessage(sourceLabel(nextDraft.data._core?.sourceChannel));
      setPageState("ready");

      try {
        await requestQuote(nextDraft);
      } catch (error) {
        setSaveState("error");
        setSaveMessage(error instanceof Error ? error.message : "Не удалось рассчитать заказ");
      }
    } catch (error) {
      setPageMessage(error instanceof Error ? error.message : "Не удалось открыть итог заказа");
      setPageState("error");
    }
  }, [requestQuote]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const paymentMethods = useMemo(
    () => options ? availableWebCheckoutPaymentMethods(options.paymentMethods) : [],
    [options],
  );
  const localValidation = useMemo(
    () => form && options && cart
      ? validateWebCheckoutReview(form, options.paymentMethods, cart.items.length)
      : { valid: false, issues: [] },
    [cart, form, options],
  );

  const saveDraft = useCallback(async (
    sourceForm: WebCheckoutReviewData,
    explicit: boolean,
    desiredStep: WebCheckoutDraftStep = "payment_method",
    retryOnConflict = true,
    baseDraft?: CheckoutDraftSnapshot,
  ): Promise<CheckoutDraftSnapshot | null> => {
    const currentDraft = baseDraft || draft;
    if (!currentDraft || !options || pageState !== "ready") return null;
    const fingerprint = webCheckoutReviewFingerprint(sourceForm);

    if (!explicit && fingerprint === lastSavedFingerprintRef.current) {
      return currentDraft;
    }

    const requestNumber = ++saveRequestRef.current;
    setSaveState("saving");
    setSaveMessage(explicit ? "Сохраняем и пересчитываем…" : "Сохраняем…");

    try {
      const response = await fetch("/api/public/account/checkout-draft", {
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: createOperationId("site-review-save"),
          expectedRevision: currentDraft.revision,
          step: preserveWebCheckoutReviewStep(currentDraft.step, desiredStep),
          data: buildWebCheckoutReviewPatch(sourceForm),
        }),
      });
      const data = await readJson<DraftResponse>(response);

      if (
        response.status === 409
        && data.code === "checkout_draft_conflict"
        && retryOnConflict
      ) {
        const latest = await fetchLatestDraft();
        return saveDraft(sourceForm, explicit, desiredStep, false, latest);
      }

      if (!response.ok || !data.draft) {
        throw new Error(data.message || "Не удалось сохранить итог заказа");
      }

      if (requestNumber === saveRequestRef.current) {
        setDraft(data.draft);
        lastSavedFingerprintRef.current = fingerprint;
        setSaveState("saved");
        setSaveMessage(explicit ? "Данные сохранены" : "Сохранено");
      }

      return data.draft;
    } catch (error) {
      if (requestNumber === saveRequestRef.current) {
        setSaveState("error");
        setSaveMessage(error instanceof Error ? error.message : "Не удалось сохранить");
      }
      return null;
    }
  }, [draft, fetchLatestDraft, options, pageState]);

  const saveAndQuote = useCallback(async (
    sourceForm: WebCheckoutReviewData,
    explicit: boolean,
  ) => {
    const saved = await saveDraft(sourceForm, explicit);
    if (!saved) return null;

    try {
      const quoted = await requestQuote(saved);
      setSaveState("saved");
      setSaveMessage(explicit ? "Итог рассчитан сервером" : "Сохранено и пересчитано");
      return quoted;
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "Не удалось рассчитать заказ");
      return null;
    }
  }, [requestQuote, saveDraft]);

  useEffect(() => {
    if (!initializedRef.current || pageState !== "ready" || !form || submitting) return;
    const fingerprint = webCheckoutReviewFingerprint(form);
    if (fingerprint === lastSavedFingerprintRef.current) return;

    setQuote(null);
    const timer = window.setTimeout(() => {
      void saveAndQuote(form, false);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [form, pageState, saveAndQuote, submitting]);

  function updateForm<K extends keyof WebCheckoutReviewData>(
    field: K,
    value: WebCheckoutReviewData[K],
  ) {
    setForm((current) => current ? { ...current, [field]: value } : current);
    setSaveState("idle");
    setSaveMessage("");
  }

  async function submitOrder() {
    if (!form || !options || !cart || submitting) return;
    setShowValidation(true);

    if (!localValidation.valid) {
      const first = localValidation.issues[0];
      document.getElementById(first?.field || "review")?.focus();
      setSaveState("error");
      setSaveMessage(first?.message || "Проверьте итог заказа");
      return;
    }

    setSubmitting(true);
    setSaveState("saving");
    setSaveMessage("Проверяем цены, остатки и создаём заказ…");

    try {
      const saved = await saveDraft(form, true, "confirm");
      if (!saved) throw new Error("Не удалось сохранить итог заказа");
      const quoted = await requestQuote(saved);
      const serverQuote = quoted.data._core?.quote || null;

      if (!serverQuote?.readyForConfirmation) {
        const firstError = serverQuote?.issues.find((item) => item.severity === "error");
        const target = firstError ? errorNavigation(firstError.field) : null;
        if (target) {
          setSaveState("error");
          setSaveMessage(`${firstError?.message}. Откройте нужный раздел и исправьте данные.`);
        } else {
          setSaveState("error");
          setSaveMessage(firstError?.message || "Заказ пока не готов к оформлению");
        }
        return;
      }

      const body = buildWebCheckoutOrderBody(quoted.data, cart.items);
      const response = await fetch("/api/public/orders", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJson<OrderResponse>(response);

      if (!response.ok || !data.order) {
        throw new Error(data.message || data.error || "Не удалось оформить заказ");
      }

      try {
        if (data.order.telegramLinkCode) {
          window.sessionStorage.setItem(
            `viberimenya_order_telegram_code:${data.order.trackingToken}`,
            data.order.telegramLinkCode,
          );
        }
      } catch {
        // Код также остаётся связан с заказом на сервере.
      }

      try {
        window.localStorage.setItem("viberimenya_cart", "[]");
        window.dispatchEvent(new Event("viberimenya_cart_changed"));
      } catch {
        // Заказ уже создан; локальная очистка не должна ломать успешный переход.
      }
      await Promise.allSettled([
        clearLinkedCustomerCart(),
        fetch("/api/public/account/checkout-draft", {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operationId: createOperationId("site-order-success"),
          }),
        }),
      ]);

      const suffix = data.order.reused ? "?created=reused" : "?created=1";
      router.replace(`/order/track/${encodeURIComponent(data.order.trackingToken)}${suffix}`);
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "Не удалось оформить заказ");
    } finally {
      setSubmitting(false);
    }
  }

  if (pageState === "loading") {
    return (
      <main className={styles.page} aria-busy="true">
        <section className={styles.stateCard}>
          <span className={styles.eyebrow}>Шаг 3 из 4</span>
          <h1>Собираем итог заказа</h1>
          <p>Проверяем корзину, цены, доставку, бонусы и способы оплаты.</p>
          <div className={styles.loadingBar} />
        </section>
      </main>
    );
  }

  if (pageState === "empty") {
    return (
      <main className={styles.page}>
        <section className={styles.stateCard}>
          <span className={styles.eyebrow}>Корзина пуста</span>
          <h1>Добавьте букет</h1>
          <p>После выбора товаров вернитесь к оформлению.</p>
          <div className={styles.stateActions}>
            <Link className={styles.primaryLink} href="/catalog">В каталог</Link>
            <Link className={styles.secondaryLink} href="/cart">В корзину</Link>
          </div>
        </section>
      </main>
    );
  }

  if (pageState === "error" || !options || !draft || !cart || !form) {
    return (
      <main className={styles.page}>
        <section className={styles.stateCard}>
          <span className={styles.eyebrow}>Не удалось загрузить</span>
          <h1>Проверьте оформление</h1>
          <p>{pageMessage || "Обновите страницу или вернитесь к предыдущему шагу."}</p>
          <div className={styles.stateActions}>
            <button className={styles.primaryButton} type="button" onClick={() => void loadPage()}>Повторить</button>
            <Link className={styles.secondaryLink} href="/checkout/delivery">К доставке</Link>
          </div>
        </section>
      </main>
    );
  }

  const delivery = deliverySummary(draft.data, options);
  const quoteIssues = quote?.issues || [];
  const errorIssues = quoteIssues.filter((item) => item.severity === "error");
  const warningIssues = quoteIssues.filter((item) => item.severity === "warning");
  const visibleLocalIssues = showValidation ? localValidation.issues : [];
  const selectedPaymentDescription = paymentDescription(form.paymentMethod);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.backLink} href="/checkout/delivery">← Доставка</Link>
          <div className={styles.titleBlock}>
            <span className={styles.eyebrow}>Шаг 3 из 4</span>
            <h1>Проверка и оплата</h1>
            <p>Финальный расчёт выполняется сервером перед созданием заказа.</p>
          </div>
          <div className={styles.progress} aria-label="Шаг 3 из 4">
            <span className={styles.progressDone}>✓</span>
            <span className={styles.progressDone}>✓</span>
            <span className={styles.progressActive}>3</span>
            <span>4</span>
          </div>
        </header>

        <section className={styles.syncNotice}>
          <div>
            <strong>{saveMessage || sourceLabel(draft.data._core?.sourceChannel)}</strong>
            <small>{expiryText(draft.expiresAt)}</small>
          </div>
          <span className={saveState === "error" ? `${styles.saveBadge} ${styles.saveBadgeError}` : styles.saveBadge}>
            {saveState === "saving" ? "Сохраняем" : saveState === "error" ? "Проверьте" : "Сохранено"}
          </span>
        </section>

        {errorIssues.length > 0 ? (
          <section className={styles.issuePanel} role="alert">
            <strong>Перед оформлением нужно исправить:</strong>
            {errorIssues.map((issue) => {
              const target = errorNavigation(issue.field);
              return target ? (
                <Link key={`${issue.code}-${issue.field}`} href={target}>{issue.message} →</Link>
              ) : (
                <span key={`${issue.code}-${issue.field}`}>{issue.message}</span>
              );
            })}
          </section>
        ) : null}

        {warningIssues.length > 0 ? (
          <section className={styles.warningPanel}>
            {warningIssues.map((issue) => <span key={`${issue.code}-${issue.field}`}>{issue.message}</span>)}
          </section>
        ) : null}

        <div className={styles.layout}>
          <div>
            <section className={styles.card}>
              <div className={styles.cardHeading}>
                <span>1</span>
                <div><h2>Товары</h2><p>{cart.quantityCount} шт. в заказе</p></div>
                <Link href="/cart">Изменить</Link>
              </div>
              <div className={styles.items}>
                {cart.items.map((item) => (
                  <article className={styles.item} key={item.productId}>
                    <div className={styles.itemImage}>
                      {item.imageUrl ? <img src={item.imageUrl} alt={item.imageAlt || item.name} /> : <span>ВМ</span>}
                    </div>
                    <div><strong>{item.name}</strong><small>{item.quantity} × {money(item.price)}</small></div>
                    <b>{money(item.price * item.quantity)}</b>
                  </article>
                ))}
              </div>
            </section>

            <section className={styles.card}>
              <div className={styles.cardHeading}>
                <span>2</span>
                <div><h2>Получатель и доставка</h2><p>Проверьте перед созданием заказа</p></div>
              </div>
              <div className={styles.summaryGrid}>
                <div>
                  <small>Покупатель</small>
                  <strong>{draft.data.customerName || "—"}</strong>
                  <span>{draft.data.customerPhone || "—"}</span>
                  {draft.data.customerEmail ? <span>{draft.data.customerEmail}</span> : null}
                  <Link href="/checkout">Изменить контакты</Link>
                </div>
                <div>
                  <small>Получатель</small>
                  <strong>{draft.data.recipientSameAsCustomer ? draft.data.customerName : draft.data.recipientName || "—"}</strong>
                  <span>{draft.data.recipientSameAsCustomer ? draft.data.customerPhone : draft.data.recipientPhone || "—"}</span>
                  <span>{draft.data.isSurprise ? "Сюрприз" : "Обычная доставка"}</span>
                </div>
                <div className={styles.deliverySummary}>
                  <small>{delivery.title}</small>
                  <strong>{delivery.text}</strong>
                  <span>{delivery.detail || "Детали подтвердит менеджер"}</span>
                  {draft.data.deliveryComment ? <span>Курьеру: {draft.data.deliveryComment}</span> : null}
                  <Link href="/checkout/delivery">Изменить доставку</Link>
                </div>
              </div>
            </section>

            <section className={styles.card}>
              <div className={styles.cardHeading}>
                <span>3</span>
                <div><h2>Пожелания</h2><p>Открытка и комментарий к заказу</p></div>
              </div>
              <div className={styles.fields}>
                <label className={styles.field}>
                  <span>Текст открытки</span>
                  <textarea id="cardText" value={form.cardText} maxLength={500} placeholder="Например: С днём рождения!" onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateForm("cardText", event.target.value)} />
                  <small>{form.cardText.length}/500</small>
                </label>
                <label className={styles.field}>
                  <span>Комментарий к заказу</span>
                  <textarea id="comment" value={form.comment} maxLength={2000} placeholder="Пожелания по составу, цветовой гамме или связи" onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateForm("comment", event.target.value)} />
                  <small>{form.comment.length}/2000</small>
                </label>
              </div>
              {!draft.data.recipientSameAsCustomer ? (
                <div className={styles.toggles}>
                  <label><input type="checkbox" checked={form.isSurprise} onChange={(event: ChangeEvent<HTMLInputElement>) => updateForm("isSurprise", event.target.checked)} /><span>Это сюрприз</span></label>
                  <label><input type="checkbox" checked={form.doNotCallRecipient} onChange={(event: ChangeEvent<HTMLInputElement>) => updateForm("doNotCallRecipient", event.target.checked)} /><span>Не звонить получателю заранее</span></label>
                </div>
              ) : null}
            </section>

            <section className={styles.card}>
              <div className={styles.cardHeading}>
                <span>4</span>
                <div><h2>Скидки и бонусы</h2><p>Итог всегда пересчитывается на сервере</p></div>
              </div>
              <div className={styles.discountGrid}>
                <label className={styles.field}>
                  <span>Промокод</span>
                  <div className={styles.inlineControl}>
                    <input id="promoCode" value={form.promoCode} maxLength={80} placeholder="ПРОМОКОД" onChange={(event: ChangeEvent<HTMLInputElement>) => updateForm("promoCode", event.target.value.toUpperCase())} />
                    <button type="button" disabled={saveState === "saving"} onClick={() => void saveAndQuote(form, true)}>Применить</button>
                  </div>
                </label>
                <label className={styles.field}>
                  <span>Списать бонусы</span>
                  <div className={styles.inlineControl}>
                    <input id="bonusToSpend" type="number" min="0" max={quote?.bonusAvailable || 0} value={form.bonusToSpend} onChange={(event: ChangeEvent<HTMLInputElement>) => updateForm("bonusToSpend", Math.max(0, Math.trunc(Number(event.target.value) || 0)))} />
                    <button type="button" disabled={!quote?.bonusAvailable || saveState === "saving"} onClick={() => updateForm("bonusToSpend", quote?.bonusAvailable || 0)}>Все</button>
                  </div>
                  <small>Доступно: {money(quote?.bonusAvailable || 0)}. Бонусы доступны после входа через Telegram.</small>
                </label>
              </div>
            </section>

            <section className={styles.card}>
              <div className={styles.cardHeading}>
                <span>5</span>
                <div><h2>Способ оплаты</h2><p>Выберите доступный вариант</p></div>
              </div>
              <div className={styles.paymentMethods} id="paymentMethod">
                {paymentMethods.map((method) => (
                  <label className={form.paymentMethod === method ? `${styles.paymentMethod} ${styles.paymentMethodActive}` : styles.paymentMethod} key={method}>
                    <input type="radio" name="paymentMethod" value={method} checked={form.paymentMethod === method} onChange={() => updateForm("paymentMethod", method)} />
                    <span><strong>{paymentTitle(method)}</strong><small>{paymentDescription(method)}</small></span>
                  </label>
                ))}
              </div>
              <p className={styles.paymentNote}>{selectedPaymentDescription}</p>
            </section>
          </div>

          <aside className={styles.totalCard}>
            <span className={styles.eyebrow}>Итог заказа</span>
            <div className={styles.totalRows}>
              <div><span>Товары</span><strong>{quote ? money(quote.subtotal) : "Пересчёт…"}</strong></div>
              <div><span>{quote?.deliveryTariffName || "Доставка"}</span><strong>{quote ? (quote.deliveryPrice > 0 ? money(quote.deliveryPrice) : "Бесплатно") : "—"}</strong></div>
              {quote?.discountTotal ? <div className={styles.discountRow}><span>Скидка</span><strong>− {money(quote.discountTotal)}</strong></div> : null}
              {quote?.bonusApplied ? <div className={styles.discountRow}><span>Бонусы</span><strong>− {money(quote.bonusApplied)}</strong></div> : null}
            </div>
            <div className={styles.totalMain}><span>К оплате</span><strong>{quote ? money(quote.total) : "Пересчёт…"}</strong></div>

            {visibleLocalIssues.map((issue) => <p className={styles.fieldError} key={`${issue.code}-${issue.field}`}>{issue.message}</p>)}

            <label className={styles.consent}>
              <input id="privacyAccepted" type="checkbox" checked={form.privacyAccepted} onChange={(event: ChangeEvent<HTMLInputElement>) => updateForm("privacyAccepted", event.target.checked)} />
              <span>Я согласен с <Link href="/consent" target="_blank">обработкой данных</Link>, <Link href="/offer" target="_blank">офертой</Link> и подтверждаю правильность заказа.</span>
            </label>

            {!options.acceptingOrders || options.maintenanceMode ? (
              <div className={styles.paused}>{options.ordersPausedMessage || "Приём заказов временно приостановлен"}</div>
            ) : null}

            <button className={styles.submitButton} type="button" disabled={submitting || saveState === "saving" || !quote || !options.acceptingOrders || options.maintenanceMode} onClick={() => void submitOrder()}>
              {submitting ? "Создаём заказ…" : quote ? `Оформить заказ на ${money(quote.total)}` : "Пересчитываем итог…"}
            </button>
            <button className={styles.recalculateButton} type="button" disabled={submitting || saveState === "saving"} onClick={() => void saveAndQuote(form, true)}>Пересчитать</button>
            <small className={styles.idempotencyNote}>Повторное нажатие не создаст второй заказ. Цены, скидки, остатки и бонусы повторно проверяются сервером.</small>
          </aside>
        </div>
      </div>
    </main>
  );
}
