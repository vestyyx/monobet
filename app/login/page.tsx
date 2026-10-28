import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { getLang } from "@/lib/lang-server";
import { getInviter, getSettings } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Přihlášení" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ ref }, lang] = await Promise.all([searchParams, getLang()]);
  const [inviter, settings] = await Promise.all([
    ref ? getInviter(ref) : Promise.resolve(null),
    getSettings(),
  ]);
  return (
    <div className="mx-auto max-w-sm px-4 pt-16">
      <Suspense>
        <AuthForm
          lang={lang}
          inviter={inviter ? { username: inviter.username ?? inviter.name, name: inviter.name, image: inviter.image } : null}
          regOpen={settings?.registrationOpen ?? true}
        />
      </Suspense>
    </div>
  );
}
