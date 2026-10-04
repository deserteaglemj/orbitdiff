import { PASSWORD_MIN } from "./sign-up-model";

export type StrengthLevel = "empty" | "too_short" | "weak" | "fair" | "strong";

export interface Strength {
  level: StrengthLevel;
  /** The level in words. The hint never relies on colour. */
  label: string;
  /** One sentence on how to make it stronger. Empty when it is strong. */
  advice: string;
}

const COMMON = ["password", "passwort", "qwerty", "letmein", "welcome", "orbitdiff", "instagram", "iloveyou"];
const LONGER = "Make it longer. A few unrelated words are easier to remember and harder to guess.";

function plain(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True for one character repeated, or a run that only counts up or down ("1234567890", "abcdefghij"). */
function isOnePattern(password: string): boolean {
  if (new Set(password).size <= 2) return true;
  let steps = 0;
  for (let index = 1; index < password.length; index += 1) {
    const step = password.charCodeAt(index) - password.charCodeAt(index - 1);
    if (step === 1 || step === -1 || step === -9) steps += 1;
  }
  return steps >= password.length - 2;
}

function containsCommonWord(password: string): boolean {
  const text = plain(password);
  return COMMON.some((word) => text.includes(word));
}

/** True when the password repeats a recognisable part of the email address or the display name. */
function repeatsPersonalText(password: string, personal: string[]): boolean {
  const text = plain(password);
  return personal
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/))
    .filter((part) => part.length >= 4)
    .some((part) => text.includes(part));
}

function characterKinds(password: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((kind) => kind.test(password)).length;
}

/**
 * A rough strength hint for the sign-up and reset forms. It is advice only: the
 * one hard rule is the minimum length, which the server enforces. Length counts
 * most, and no particular kind of character is ever demanded.
 */
export function passwordStrength(password: string, context: { email?: string; name?: string } = {}): Strength {
  if (password.length === 0) {
    return { level: "empty", label: "Not entered yet", advice: `Use at least ${PASSWORD_MIN} characters.` };
  }
  if (password.length < PASSWORD_MIN) {
    const missing = PASSWORD_MIN - password.length;
    return {
      level: "too_short",
      label: "Too short",
      advice: `Add ${missing} more ${missing === 1 ? "character" : "characters"}.`,
    };
  }
  if (isOnePattern(password)) {
    return { level: "weak", label: "Weak", advice: "It is one repeated or counting pattern. Use unrelated words instead." };
  }
  if (containsCommonWord(password)) {
    return { level: "weak", label: "Weak", advice: "It contains a very common word. Use unrelated words instead." };
  }
  if (repeatsPersonalText(password, [context.email?.split("@")[0] ?? "", context.name ?? ""])) {
    return { level: "weak", label: "Weak", advice: "It repeats your name or email address. Use something unrelated." };
  }
  const long = password.length >= 20;
  const varied = password.length >= 14 && characterKinds(password) >= 3;
  if (long || varied) return { level: "strong", label: "Strong", advice: "" };
  return { level: "fair", label: "Fair", advice: LONGER };
}
