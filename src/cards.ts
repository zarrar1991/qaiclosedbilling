// Test-card helpers shared by browser-automation flows.
export function randomFutureExpiry(): string {
  const now = new Date();
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
  const yearsAhead = 3 + Math.floor(Math.random() * 5);
  const yy = String((now.getFullYear() + yearsAhead) % 100).padStart(2, "0");
  return `${month}/${yy}`;
}

export function randomCvc(): string {
  return String(Math.floor(100 + Math.random() * 900));
}

export function last4(cardNumber: string): string {
  return cardNumber.replace(/\D/g, "").slice(-4);
}
