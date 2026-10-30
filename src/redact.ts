const STRIPE_KEY = /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+/g;

/** Strip anything that looks like a Stripe API key before text leaves the process. */
export function redactSecrets(text: string): string {
  return text.replace(STRIPE_KEY, "[redacted]");
}
