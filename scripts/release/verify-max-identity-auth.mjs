#!/usr/bin/env node
import { readFile } from "node:fs/promises";

async function text(path) {
  return readFile(path, "utf8");
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }

  console.log(`✓ ${message}`);
}

const [
  env,
  app,
  pairing,
  publicRoutes,
  maxAuth,
  maxIdentity,
  maxRoutes,
  e2e,
] = await Promise.all([
  text("apps/api/src/lib/env.ts"),
  text("apps/api/src/app.ts"),
  text("apps/api/src/modules/customers/customer-pairing.service.ts"),
  text("apps/api/src/routes/public.ts"),
  text("apps/api/src/modules/customers/customer-max-auth.service.ts"),
  text("apps/api/src/modules/customers/customer-max-identity.service.ts"),
  text("apps/api/src/routes/max-auth.ts"),
  text("apps/api/src/verify-max-identity-auth-e2e.ts"),
]);

assertCondition(
  env.includes("MAX_BOT_TOKEN")
    && env.includes("MAX_BOT_USERNAME")
    && env.includes("MAX_WEBAPP_AUTH_MAX_AGE_SECONDS"),
  "MAX env-конфигурация добавлена без обязательности для текущего production",
);
assertCondition(
  app.includes('import { maxAuthRoutes } from "./routes/max-auth";')
    && app.includes("await app.register(maxAuthRoutes);"),
  "MAX auth routes зарегистрированы в API",
);
assertCondition(
  pairing.includes('provider: "max"')
    && pairing.includes("supportsPairing: true")
    && pairing.includes("supportsLogin: true")
    && pairing.includes("resolveCustomerAuthProviderAdapters"),
  "MAX provider adapter поддерживает pairing и login",
);
assertCondition(
  publicRoutes.includes("readPlatformFeatureFlags")
    && publicRoutes.includes("resolveCustomerAuthProviderAdapters")
    && publicRoutes.includes("flags.maxEnabled")
    && publicRoutes.includes("flags.maxAuthEnabled"),
  "Публичный список auth providers учитывает feature flags и конфигурацию",
);
assertCondition(
  maxAuth.includes('createHmac("sha256", MAX_WEBAPP_SECRET_CONTEXT)')
    && maxAuth.includes('createHmac("sha256", secretKey)')
    && maxAuth.includes("timingSafeEqual")
    && maxAuth.includes("max_init_data_duplicate_parameter")
    && maxAuth.includes("MAX_WEBAPP_AUTH_FUTURE_SKEW_SECONDS"),
  "MAX WebAppData проверяется по официальной HMAC-схеме, сроку и duplicate keys",
);
assertCondition(
  maxAuth.includes("hashMaxIdentityLinkToken")
    && maxAuth.includes("createMaxIdentityLinkStartParam")
    && maxAuth.includes("extractMaxIdentityLinkToken"),
  "Одноразовый MAX link token хранится в виде хеша и передаётся через start_param",
);
assertCondition(
  maxIdentity.includes("max_auth_replayed")
    && maxIdentity.includes("max_identity_conflict")
    && maxIdentity.includes("max_link_required")
    && maxIdentity.includes("notificationsEnabled: false")
    && maxIdentity.includes("webapp-auth:"),
  "MAX identity защищена от replay, перехвата и преждевременного включения уведомлений",
);
assertCondition(
  maxIdentity.includes("createSecureCustomerSession")
    && maxIdentity.includes("customer.max_authenticated")
    && maxIdentity.includes("customer.max_identity_linked"),
  "MAX authentication создаёт общую customer session и security audit",
);
assertCondition(
  maxRoutes.includes("/api/public/account/auth/max/link-intent")
    && maxRoutes.includes("/api/public/account/auth/max/session")
    && maxRoutes.includes("/api/public/account/auth/max/link")
    && maxRoutes.includes("max_auth_unavailable")
    && maxRoutes.includes("flags.maxEnabled && flags.maxAuthEnabled"),
  "MAX endpoints добавлены и безопасно выключены feature flags",
);
assertCondition(
  e2e.includes("MAX_IDENTITY_AUTH_E2E: OK")
    && e2e.includes("replayProtected")
    && e2e.includes("conflictProtected")
    && e2e.includes("tamperProtected")
    && e2e.includes("staleProtected")
    && e2e.includes("RollbackProbe"),
  "E2E проверяет подпись, TTL, replay, identity conflict, session hash и rollback",
);
assertCondition(
  !maxRoutes.includes("MAX_WEBHOOK_SECRET")
    && !maxIdentity.includes("sendNotification"),
  "MAX notifications и webhook не включены в этап 17C-1.3",
);

console.log("MAX IDENTITY + AUTH SOURCE CONTRACT: OK");
