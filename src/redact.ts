const STRIPE_KEY = /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+/g;

/** Strip anything that looks like a Stripe API key before text leaves the process. */
export function redactSecrets(text: string): string {
  return text.replace(STRIPE_KEY, "[redacted]");
}

/** "jane.doe@example.com" -> "j***@example.com". Keeps the domain, hides the rest of the local part. */
export function maskEmail(email: string | null): string | null {
  if (email === null) return null;
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
