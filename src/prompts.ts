import { createInterface, type Interface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// A single shared readline interface for the whole session. Creating/closing
// one per question tears down stdin on piped (non-TTY) input, so we reuse one
// and close it explicitly via closePrompts() when the run finishes.
let rl: Interface | null = null;

function getRl(): Interface {
  if (!rl) rl = createInterface({ input, output });
  return rl;
}

async function ask(question: string): Promise<string> {
  const answer = await getRl().question(question);
  return answer.trim();
}

export function closePrompts(): void {
  rl?.close();
  rl = null;
}

export async function promptEmail(): Promise<string> {
  let email = "";
  while (!email) {
    email = await ask("Target customer email: ");
    if (!email.includes("@")) {
      console.log("  Please enter a valid email.");
      email = "";
    }
  }
  return email;
}

export async function promptSpan(): Promise<string> {
  return ask('Advance time span (e.g. "1 month", "3 days", "1 year"): ');
}

export async function promptConfirm(message: string): Promise<boolean> {
  const a = (await ask(`${message} [y/N]: `)).toLowerCase();
  return a === "y" || a === "yes";
}

// Returns the raw choice: a subscription id, "UPDATE ALL", or "" (empty).
export async function promptSubscriptionChoice(): Promise<string> {
  return ask('Enter subscription id to update (or type "UPDATE ALL"): ');
}

// Used as the second explicit gate before advancing the Stripe clock.
export async function promptTypeToken(token: string, message: string): Promise<boolean> {
  const a = await ask(`${message}\nType "${token}" to proceed: `);
  return a === token;
}

export async function promptEnterWhenReady(message: string): Promise<void> {
  await ask(`${message}\nPress Enter when ready to continue...`);
}
