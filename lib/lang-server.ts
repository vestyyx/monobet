import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, type Lang } from "@/lib/i18n";

// The user's language choice lives in a plain cookie so the toggle is a
// simple document.cookie write + router.refresh().
export async function getLang(): Promise<Lang> {
  const c = await cookies();
  return c.get(LANG_COOKIE)?.value === "en" ? "en" : "cs";
}
