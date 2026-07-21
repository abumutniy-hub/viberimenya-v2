import { createHash, randomUUID } from "node:crypto";

export const GUEST_CHECKOUT_COOKIE = "vm_guest_checkout";
export const GUEST_CHECKOUT_TTL_SECONDS = 24 * 60 * 60;
const GUEST_CHECKOUT_CONTEXT = "viberimenya:guest-checkout:v1";

export function validGuestCheckoutToken(value: string) {
  return /^[a-f0-9]{64}$/i.test(value);
}

export function createGuestCheckoutToken() {
  return (
    randomUUID().replace(/-/g, "")
    + randomUUID().replace(/-/g, "")
  );
}

export function guestCheckoutScopeId(rawToken: string) {
  if (!validGuestCheckoutToken(rawToken)) {
    throw new Error("Guest checkout token is invalid");
  }

  const digest = createHash("sha256")
    .update(`${GUEST_CHECKOUT_CONTEXT}:${rawToken.toLowerCase()}`)
    .digest("hex");
  const positive = BigInt(`0x${digest.slice(0, 15)}`) + 1n;

  return `-${positive.toString()}`;
}
