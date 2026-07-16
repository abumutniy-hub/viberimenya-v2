"use client";

import {
  useMemo,
  useState,
  type FormEvent
} from "react";

import styles from "./settings.module.css";

export type HeroImageOption = {
  productId: string;
  productName: string;
  url: string;
  alt: string;
};

export type StoreSettingsFormData = {
  phone: string;
  whatsapp: string;
  telegram: string;
  instagram: string;
  address: string;
  workHours: string;
  heroTitle: string;
  heroSubtitle: string;
  heroImageUrl: string;
  isOnlinePaymentEnabled: boolean;
  isCashPaymentEnabled: boolean;
  isTransferPaymentEnabled: boolean;
  site: {
    brandName: string;
    brandSubtitle: string;
    footerDescription: string;
    email: string;
    legalName: string;
    inn: string;
    ogrn: string;
    policyUrl: string;
    offerUrl: string;
    deliveryTermsUrl: string;
    returnsUrl: string;
  };
  homepage: {
    eyebrow: string;
    primaryCtaLabel: string;
    secondaryCtaLabel: string;
    occasions: string[];
    benefits: Array<{
      title: string;
      text: string;
    }>;
  };
  delivery: {
    pickupEnabled: boolean;
    pickupAddress: string;
    pickupNote: string;
    minimumOrderAmount: number;
    orderLeadTimeMinutes: number;
    expressLeadTimeMinutes: number;
    notice: string;
  };
};

type SettingsFormProps = {
  initialSettings: StoreSettingsFormData;
  heroImages: HeroImageOption[];
};

function numberFromForm(
  form: FormData,
  name: string,
  fallback = 0
) {
  const value = Number(
    form.get(name) ?? fallback
  );

  return Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : fallback;
}

async function readResponse(
  response: Response
) {
  try {
    return await response.json() as {
      ok?: boolean;
      message?: string;
      error?: string;
    };
  } catch {
    return null;
  }
}

function splitOccasions(value: string) {
  const seen = new Set<string>();

  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLocaleLowerCase(
        "ru-RU"
      );

      if (!item || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

export function SettingsForm({
  initialSettings,
  heroImages
}: SettingsFormProps) {
  const [isSaving, setIsSaving] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [heroImageUrl, setHeroImageUrl] =
    useState(initialSettings.heroImageUrl);

  const selectedHeroImage = useMemo(
    () =>
      heroImages.find(
        (image) => image.url === heroImageUrl
      ) ?? null,
    [heroImageUrl, heroImages]
  );

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setIsSaving(true);
    setMessage("");

    const form = new FormData(
      event.currentTarget
    );

    const benefits = [1, 2, 3].map(
      (index) => ({
        title: String(
          form.get(`benefit${index}Title`)
          ?? ""
        ).trim(),
        text: String(
          form.get(`benefit${index}Text`)
          ?? ""
        ).trim()
      })
    );

    const body = {
      phone: String(form.get("phone") ?? ""),
      whatsapp: String(
        form.get("whatsapp") ?? ""
      ),
      telegram: String(
        form.get("telegram") ?? ""
      ),
      instagram: String(
        form.get("instagram") ?? ""
      ),
      address: String(
        form.get("address") ?? ""
      ),
      workHours: String(
        form.get("workHours") ?? ""
      ),
      heroTitle: String(
        form.get("heroTitle") ?? ""
      ),
      heroSubtitle: String(
        form.get("heroSubtitle") ?? ""
      ),
      heroImageUrl,
      isOnlinePaymentEnabled:
        initialSettings.isOnlinePaymentEnabled,
      isCashPaymentEnabled:
        form.get("isCashPaymentEnabled")
        === "on",
      isTransferPaymentEnabled:
        form.get("isTransferPaymentEnabled")
        === "on",
      site: {
        brandName: String(
          form.get("brandName") ?? ""
        ),
        brandSubtitle: String(
          form.get("brandSubtitle") ?? ""
        ),
        footerDescription: String(
          form.get("footerDescription") ?? ""
        ),
        email: String(
          form.get("email") ?? ""
        ),
        legalName: String(
          form.get("legalName") ?? ""
        ),
        inn: String(form.get("inn") ?? ""),
        ogrn: String(form.get("ogrn") ?? ""),
        policyUrl: String(
          form.get("policyUrl") ?? ""
        ),
        offerUrl: String(
          form.get("offerUrl") ?? ""
        ),
        deliveryTermsUrl: String(
          form.get("deliveryTermsUrl")
          ?? ""
        ),
        returnsUrl: String(
          form.get("returnsUrl") ?? ""
        )
      },
      homepage: {
        eyebrow: String(
          form.get("eyebrow") ?? ""
        ),
        primaryCtaLabel: String(
          form.get("primaryCtaLabel")
          ?? ""
        ),
        secondaryCtaLabel: String(
          form.get("secondaryCtaLabel")
          ?? ""
        ),
        occasions: splitOccasions(
          String(
            form.get("occasions") ?? ""
          )
        ),
        benefits
      },
      delivery: {
        pickupEnabled:
          form.get("pickupEnabled")
          === "on",
        pickupAddress: String(
          form.get("pickupAddress") ?? ""
        ),
        pickupNote: String(
          form.get("pickupNote") ?? ""
        ),
        minimumOrderAmount:
          numberFromForm(
            form,
            "minimumOrderAmount"
          ),
        orderLeadTimeMinutes:
          numberFromForm(
            form,
            "orderLeadTimeMinutes",
            120
          ),
        expressLeadTimeMinutes:
          numberFromForm(
            form,
            "expressLeadTimeMinutes",
            60
          ),
        notice: String(
          form.get("deliveryNotice")
          ?? ""
        )
      }
    };

    if (
      !body.isOnlinePaymentEnabled
      && !body.isCashPaymentEnabled
      && !body.isTransferPaymentEnabled
    ) {
      setMessage(
        "Оставьте включённым хотя бы один способ оплаты."
      );
      setIsSaving(false);
      return;
    }

    try {
      const response = await fetch(
        "/api/admin/settings",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          credentials: "include",
          body: JSON.stringify(body)
        }
      );

      const data = await readResponse(
        response
      );

      if (!response.ok) {
        throw new Error(
          data?.message
          || data?.error
          || "Не удалось сохранить настройки"
        );
      }

      setMessage(
        "Настройки сохранены. Витрина обновлена."
      );

      window.setTimeout(() => {
        window.location.reload();
      }, 700);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить настройки"
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      className={styles.form}
      onSubmit={handleSubmit}
    >
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <span>Бренд</span>
            <h2>Название и контакты</h2>
          </div>

          <p>
            Эти данные используются в шапке,
            подвале и клиентских разделах.
          </p>
        </div>

        <div className={styles.grid}>
          <label>
            <span>Название магазина</span>
            <input
              name="brandName"
              defaultValue={
                initialSettings.site.brandName
              }
              required
            />
          </label>

          <label>
            <span>Подпись под логотипом</span>
            <input
              name="brandSubtitle"
              defaultValue={
                initialSettings.site
                  .brandSubtitle
              }
            />
          </label>

          <label>
            <span>Телефон</span>
            <input
              name="phone"
              type="tel"
              defaultValue={
                initialSettings.phone
              }
              placeholder="+7 999 000-00-00"
            />
          </label>

          <label>
            <span>Email</span>
            <input
              name="email"
              type="email"
              defaultValue={
                initialSettings.site.email
              }
              placeholder="hello@example.ru"
            />
          </label>

          <label>
            <span>WhatsApp</span>
            <input
              name="whatsapp"
              defaultValue={
                initialSettings.whatsapp
              }
              placeholder="79990000000 или ссылка"
            />
          </label>

          <label>
            <span>Telegram</span>
            <input
              name="telegram"
              defaultValue={
                initialSettings.telegram
              }
              placeholder="@username или ссылка"
            />
          </label>

          <label>
            <span>Instagram</span>
            <input
              name="instagram"
              defaultValue={
                initialSettings.instagram
              }
              placeholder="https://..."
            />
          </label>

          <label>
            <span>График работы</span>
            <input
              name="workHours"
              defaultValue={
                initialSettings.workHours
              }
              placeholder="Ежедневно, 09:00–21:00"
            />
          </label>

          <label className={styles.wide}>
            <span>Адрес магазина</span>
            <input
              name="address"
              defaultValue={
                initialSettings.address
              }
              placeholder="Город, улица, дом"
            />
          </label>

          <label className={styles.wide}>
            <span>Описание в подвале</span>
            <textarea
              name="footerDescription"
              defaultValue={
                initialSettings.site
                  .footerDescription
              }
              rows={3}
            />
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <span>Главная страница</span>
            <h2>Первый экран</h2>
          </div>

          <p>
            Меняйте главный текст и фотографию
            без редактирования кода.
          </p>
        </div>

        <div className={styles.grid}>
          <label>
            <span>Надпись над заголовком</span>
            <input
              name="eyebrow"
              defaultValue={
                initialSettings.homepage
                  .eyebrow
              }
            />
          </label>

          <label>
            <span>Текст основной кнопки</span>
            <input
              name="primaryCtaLabel"
              defaultValue={
                initialSettings.homepage
                  .primaryCtaLabel
              }
            />
          </label>

          <label>
            <span>Текст второй кнопки</span>
            <input
              name="secondaryCtaLabel"
              defaultValue={
                initialSettings.homepage
                  .secondaryCtaLabel
              }
            />
          </label>

          <label className={styles.wide}>
            <span>Главный заголовок</span>
            <input
              name="heroTitle"
              defaultValue={
                initialSettings.heroTitle
              }
              required
            />
          </label>

          <label className={styles.wide}>
            <span>Подзаголовок</span>
            <textarea
              name="heroSubtitle"
              defaultValue={
                initialSettings.heroSubtitle
              }
              rows={4}
              required
            />
          </label>

          <label className={styles.wide}>
            <span>Фотография первого экрана</span>
            <select
              value={heroImageUrl}
              onChange={(event) => {
                setHeroImageUrl(
                  event.target.value
                );
              }}
            >
              <option value="">
                Автоматически: первый популярный товар
              </option>

              {heroImages.map((image) => (
                <option
                  key={image.productId}
                  value={image.url}
                >
                  {image.productName}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={styles.heroPreview}>
          {heroImageUrl ? (
            <img
              src={heroImageUrl}
              alt={
                selectedHeroImage?.alt
                || selectedHeroImage?.productName
                || "Главная фотография"
              }
            />
          ) : (
            <div>
              Фотография будет выбрана
              автоматически из популярных товаров.
            </div>
          )}

          <section>
            <span>
              {initialSettings.homepage.eyebrow}
            </span>
            <strong>
              {initialSettings.heroTitle}
            </strong>
            <p>
              Предпросмотр фотографии. Текст после
              сохранения обновится на витрине.
            </p>
          </section>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <span>Главная страница</span>
            <h2>Преимущества и поводы</h2>
          </div>

          <p>
            Показывайте конкретные сильные стороны
            магазина и быстрые сценарии выбора.
          </p>
        </div>

        <div className={styles.benefits}>
          {initialSettings.homepage.benefits
            .slice(0, 3)
            .map((benefit, index) => (
              <article key={index}>
                <span>
                  Преимущество {index + 1}
                </span>

                <label>
                  <span>Заголовок</span>
                  <input
                    name={`benefit${index + 1}Title`}
                    defaultValue={benefit.title}
                    required
                  />
                </label>

                <label>
                  <span>Описание</span>
                  <textarea
                    name={`benefit${index + 1}Text`}
                    defaultValue={benefit.text}
                    rows={3}
                    required
                  />
                </label>
              </article>
            ))}
        </div>

        <label className={styles.blockLabel}>
          <span>Поводы — по одному в строке</span>
          <textarea
            name="occasions"
            defaultValue={
              initialSettings.homepage
                .occasions.join("\n")
            }
            rows={8}
            placeholder={
              "Любимой\nМаме\nДень рождения"
            }
          />
          <small>
            На главной показывается не больше
            12 уникальных поводов.
          </small>
        </label>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <span>Получение заказа</span>
            <h2>Доставка и самовывоз</h2>
          </div>

          <p>
            Тарифы и интервалы настраиваются в
            разделе «Доставка», здесь — общие правила.
          </p>
        </div>

        <div className={styles.grid}>
          <label>
            <span>Минимальная сумма товаров, ₽</span>
            <input
              name="minimumOrderAmount"
              type="number"
              min="0"
              step="1"
              defaultValue={
                initialSettings.delivery
                  .minimumOrderAmount
              }
            />
          </label>

          <label>
            <span>Подготовка обычного заказа, мин</span>
            <input
              name="orderLeadTimeMinutes"
              type="number"
              min="0"
              step="1"
              defaultValue={
                initialSettings.delivery
                  .orderLeadTimeMinutes
              }
            />
          </label>

          <label>
            <span>Подготовка срочного заказа, мин</span>
            <input
              name="expressLeadTimeMinutes"
              type="number"
              min="0"
              step="1"
              defaultValue={
                initialSettings.delivery
                  .expressLeadTimeMinutes
              }
            />
          </label>

          <label className={styles.switchLabel}>
            <input
              name="pickupEnabled"
              type="checkbox"
              defaultChecked={
                initialSettings.delivery
                  .pickupEnabled
              }
            />
            <span>Самовывоз доступен клиентам</span>
          </label>

          <label className={styles.wide}>
            <span>Адрес самовывоза</span>
            <input
              name="pickupAddress"
              defaultValue={
                initialSettings.delivery
                  .pickupAddress
              }
              placeholder="Показывается клиенту при выборе самовывоза"
            />
          </label>

          <label className={styles.wide}>
            <span>Комментарий к самовывозу</span>
            <textarea
              name="pickupNote"
              defaultValue={
                initialSettings.delivery
                  .pickupNote
              }
              rows={3}
            />
          </label>

          <label className={styles.wide}>
            <span>Общее уведомление в корзине</span>
            <textarea
              name="deliveryNotice"
              defaultValue={
                initialSettings.delivery.notice
              }
              rows={3}
              placeholder="Например: в праздничные даты время доставки может увеличиться"
            />
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <span>Оплата</span>
            <h2>Доступные способы</h2>
          </div>

          <p>
            Клиент увидит только включённые способы.
            Сервер повторно проверяет выбор.
          </p>
        </div>

        <div className={styles.switchGrid}>
          <label>
            <input
              name="isTransferPaymentEnabled"
              type="checkbox"
              defaultChecked={
                initialSettings
                  .isTransferPaymentEnabled
              }
            />
            <span>
              <strong>Перевод после подтверждения</strong>
              <small>Доступен уже сейчас</small>
            </span>
          </label>

          <label>
            <input
              name="isCashPaymentEnabled"
              type="checkbox"
              defaultChecked={
                initialSettings
                  .isCashPaymentEnabled
              }
            />
            <span>
              <strong>Оплата при получении</strong>
              <small>Наличными или по договорённости</small>
            </span>
          </label>

          <a
            className={styles.paymentProviderLink}
            href="/admin/finance"
          >
            <span>
              <strong>ЮKassa и онлайн-оплата</strong>
              <small>
                Shop ID, секретный ключ и включение настраиваются в разделе «Финансы»
              </small>
            </span>
            <b>Открыть →</b>
          </a>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <span>Документы</span>
            <h2>Реквизиты и ссылки</h2>
          </div>

          <p>
            Пустые ссылки не показываются клиентам.
          </p>
        </div>

        <div className={styles.grid}>
          <label className={styles.wide}>
            <span>Юридическое наименование</span>
            <input
              name="legalName"
              defaultValue={
                initialSettings.site.legalName
              }
            />
          </label>

          <label>
            <span>ИНН</span>
            <input
              name="inn"
              inputMode="numeric"
              defaultValue={
                initialSettings.site.inn
              }
            />
          </label>

          <label>
            <span>ОГРН / ОГРНИП</span>
            <input
              name="ogrn"
              inputMode="numeric"
              defaultValue={
                initialSettings.site.ogrn
              }
            />
          </label>

          <label>
            <span>Политика конфиденциальности</span>
            <input
              name="policyUrl"
              defaultValue={
                initialSettings.site.policyUrl
              }
              placeholder="/privacy или https://..."
            />
          </label>

          <label>
            <span>Публичная оферта</span>
            <input
              name="offerUrl"
              defaultValue={
                initialSettings.site.offerUrl
              }
              placeholder="/offer или https://..."
            />
          </label>

          <label>
            <span>Условия доставки</span>
            <input
              name="deliveryTermsUrl"
              defaultValue={
                initialSettings.site
                  .deliveryTermsUrl
              }
              placeholder="/delivery или https://..."
            />
          </label>

          <label>
            <span>Возврат и претензии</span>
            <input
              name="returnsUrl"
              defaultValue={
                initialSettings.site.returnsUrl
              }
              placeholder="/returns или https://..."
            />
          </label>
        </div>
      </section>

      <div className={styles.saveBar}>
        <div>
          {message ? (
            <strong>{message}</strong>
          ) : (
            <span>
              Изменения применятся после сохранения.
            </span>
          )}
        </div>

        <button
          type="submit"
          disabled={isSaving}
        >
          {isSaving
            ? "Сохраняем..."
            : "Сохранить настройки"}
        </button>
      </div>
    </form>
  );
}
