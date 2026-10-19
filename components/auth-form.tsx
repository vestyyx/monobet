"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { signIn, signUp } from "@/lib/auth-client";
import { claimReferral } from "@/lib/actions";
import { Button, Card, Input, Segmented, Avatar } from "@/components/ui/primitives";
import { LogoMark } from "@/components/logo";
import { Gift } from "lucide-react";
import { fmtMonos } from "@/lib/money";
import { playSfx } from "@/lib/sfx";
import { REFEREE_BONUS, REFERRER_BONUS } from "@/lib/rewards";
import { getT, type Lang } from "@/lib/i18n";

type Inviter = { username: string; name: string; image: string | null } | null;

export function AuthForm({ lang, inviter }: { lang?: Lang; inviter?: Inviter }) {
  const params = useSearchParams();
  const t = getT(lang ?? "cs");
  const [mode, setMode] = useState<"login" | "signup">(
    params.get("mode") === "signup" || params.get("ref") ? "signup" : "login"
  );
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = () => {
    if (username.trim().length < 3) return toast.error(t.authUserShort);
    if (password.length < 6) return toast.error(t.authPassShort);
    start(async () => {
      if (mode === "signup") {
        const customEmail = email.trim().toLowerCase();
        const r = await signUp.email({
          // username plugin stores username; email is required by core, so a
          // local placeholder keeps signups friction-free unless a real one
          // is given (e.g. the owner's superadmin email).
          email: customEmail || `${username.trim().toLowerCase()}@monobet.local`,
          name: username.trim(),
          username: username.trim().toLowerCase(),
          password,
        });
        if (r.error) {
          toast.error(r.error.message ?? t.authSignupFailed);
          return;
        }
        const ref = params.get("ref");
        if (ref) {
          const rr = await claimReferral({ ref });
          if (rr.ok) {
            playSfx("claim", 0.5);
            toast.success(`+${fmtMonos(REFEREE_BONUS, { lang, decimals: false })} — ${t.referralApplied}`);
          }
        }
        toast.success(t.authWelcome);
      } else {
        const r = await signIn.username({ username: username.trim().toLowerCase(), password });
        if (r.error) {
          toast.error(t.authWrongCreds);
          return;
        }
      }
      router.push("/");
      router.refresh();
    });
  };

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <LogoMark />
        <span className="font-bold text-[17px] tracking-tight">MonoPredict</span>
      </div>

      <Segmented
        options={[
          { value: "login", label: t.logIn },
          { value: "signup", label: t.signUp },
        ]}
        value={mode}
        onChange={setMode}
      />

      {mode === "signup" && params.get("ref") && (
        <div className="mt-4 rounded-xl border border-brand/30 bg-brand-soft/60 px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            {inviter ? (
              <Avatar name={inviter.username} image={inviter.image} className="size-9" />
            ) : (
              <div className="size-9 rounded-full bg-brand/15 grid place-items-center text-brand-strong">
                <Gift className="size-4" />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-[14px] font-bold leading-tight">
                {t.invitedBy(`@${inviter?.username ?? params.get("ref")!}`)}
              </div>
              <div className="text-[11.5px] text-mute">{t.inviteSub}</div>
            </div>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-[12px] font-semibold">
            <span className="rounded-md bg-yes-soft px-2 py-1 text-yes-strong">
              {t.refYouGet(fmtMonos(REFEREE_BONUS, { lang, decimals: false }))}
            </span>
            <span className="text-faint">+</span>
            <span className="rounded-md bg-surface-2 px-2 py-1 text-mute">
              {t.refTheyGet(fmtMonos(REFERRER_BONUS, { lang, decimals: false }), `@${inviter?.username ?? params.get("ref")!}`)}
            </span>
          </div>
        </div>
      )}

      <form
        className="mt-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div>
          <label className="text-[13px] font-medium text-mute" htmlFor="u">
            {t.username}
          </label>
          <Input
            id="u"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t.usernamePlaceholder}
            autoComplete="username"
            className="mt-1"
          />
        </div>
        {mode === "signup" && (
          <div>
            <label className="text-[13px] font-medium text-mute" htmlFor="e">
              {t.emailOptional}
            </label>
            <Input
              id="e"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="mt-1"
            />
          </div>
        )}
        <div>
          <label className="text-[13px] font-medium text-mute" htmlFor="p">
            {t.password}
          </label>
          <Input
            id="p"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? t.passwordPh : "••••••••"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="mt-1"
          />
        </div>

        <Button className="w-full" size="lg" disabled={pending}>
          {pending ? "…" : mode === "login" ? t.logIn : t.createAccountBtn}
        </Button>
      </form>

      <p className="mt-4 text-center text-[12px] text-faint">
        {t.authPlayMoney}
      </p>
      {mode === "signup" && (
        <p className="mt-1.5 text-center text-[12px] text-faint">
          {t.authAgree}{" "}
          <Link href="/terms" className="underline hover:text-ink">
            {t.termsLink}
          </Link>
          .
        </p>
      )}
    </Card>
  );
}
