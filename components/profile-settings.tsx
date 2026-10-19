"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Users, Bell, LogOut } from "lucide-react";
import { Avatar, Button, Card, Input } from "@/components/ui/primitives";
import { joinSquad, leaveSquad, setNotifPrefs, inviteToSquad, respondSquadInvite, searchUsers } from "@/lib/actions";
import { getT, type Lang } from "@/lib/i18n";

type Invite = { id: string; squadName: string; inviterName: string | null };

// Own-profile settings: squad membership + invites and notification toggles.
export function ProfileSettings({
  squadName,
  invites,
  notifResolve,
  notifClosing,
  lang,
}: {
  squadName: string | null;
  invites: Invite[];
  notifResolve: boolean;
  notifClosing: boolean;
  lang?: Lang;
}) {
  const t = getT(lang ?? "cs");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [suggests, setSuggests] = useState<Awaited<ReturnType<typeof searchUsers>>>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);

  // Username autocomplete — 200ms debounce, squad-less users only. An empty
  // query lists everyone, so focusing the field shows the full pick list.
  useEffect(() => {
    const q = inviteName.trim().replace(/^@/, "");
    const id = setTimeout(() => {
      searchUsers(q).then(setSuggests).catch(() => setSuggests([]));
    }, q ? 200 : 0);
    return () => clearTimeout(id);
  }, [inviteName]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        router.refresh();
      } else toast.error(t.serverErr(r.error));
    });

  return (
    <Card className="p-4 space-y-4">
      {/* Squad */}
      <div>
        <h3 className="text-[13px] font-semibold flex items-center gap-1.5">
          <Users className="size-3.5" /> {t.squadTitle}
        </h3>
        {squadName ? (
          <>
            <div className="mt-2 flex items-center gap-2">
              <Link href="/squads" className="text-[13px] font-medium text-ink flex-1 hover:text-brand-strong">{squadName}</Link>
              <Button size="xs" variant="outline" disabled={pending} onClick={() => run(leaveSquad, t.squadLeftToast)}>
                <LogOut className="size-3" /> {t.squadLeave}
              </Button>
            </div>
            <div className="mt-2 flex gap-1.5">
              <div className="relative flex-1">
                <Input
                  value={inviteName}
                  onChange={(e) => {
                    setInviteName(e.target.value);
                    setSuggestOpen(true);
                  }}
                  onFocus={() => setSuggestOpen(true)}
                  onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
                  placeholder={t.squadInvitePh}
                  className="text-[13px] w-full"
                />
                {suggestOpen && suggests.length > 0 && (
                  <div className="absolute z-20 top-full mt-1 inset-x-0 rounded-lg border border-line bg-surface shadow-lg overflow-hidden">
                    {suggests.map((s) => (
                      <button
                        key={s.username ?? s.name}
                        type="button"
                        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-surface-2 cursor-pointer"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          const uname = s.username ?? s.name;
                          setSuggestOpen(false);
                          run(async () => {
                            const r = await inviteToSquad(uname);
                            if (r.ok) setInviteName("");
                            return r;
                          }, t.squadInvitedToast);
                        }}
                      >
                        <Avatar name={s.username ?? s.name} image={s.image} className="size-6" />
                        <span className="min-w-0 flex-1 text-[13px] font-medium truncate">
                          @{s.username ?? s.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={pending || inviteName.trim().length < 2}
                onClick={() =>
                  run(async () => {
                    const r = await inviteToSquad(inviteName);
                    if (r.ok) setInviteName("");
                    return r;
                  }, t.squadInvitedToast)
                }
              >
                {t.squadInvite}
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-2 flex gap-1.5">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.squadNamePh}
              maxLength={24}
              className="text-[13px]"
            />
            <Button
              size="sm"
              disabled={pending || name.trim().length < 2}
              onClick={() => run(() => joinSquad(name), t.squadJoinedToast)}
            >
              {t.squadJoin}
            </Button>
          </div>
        )}
        <p className="text-[11px] text-faint mt-1">{t.squadHint}</p>

        {invites.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12.5px]">
                <span className="flex-1 min-w-0 truncate">
                  <span className="font-semibold">{inv.squadName}</span>
                  <span className="text-faint"> · @{inv.inviterName}</span>
                </span>
                <Button
                  size="xs"
                  disabled={pending}
                  onClick={() => run(() => respondSquadInvite({ inviteId: inv.id, accept: true }), t.squadJoinedToast)}
                >
                  {t.squadAccept}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run(() => respondSquadInvite({ inviteId: inv.id, accept: false }), t.squadDeclinedToast)}
                >
                  {t.squadDecline}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notifications */}
      <div className="border-t border-line pt-3">
        <h3 className="text-[13px] font-semibold flex items-center gap-1.5">
          <Bell className="size-3.5" /> {t.notifPrefsTitle}
        </h3>
        <div className="mt-2 space-y-2">
          {(
            [
              { key: "resolve" as const, label: t.notifResolveLabel, on: notifResolve },
              { key: "closing" as const, label: t.notifClosingLabel, on: notifClosing },
            ]
          ).map((p) => (
            <label key={p.key} className="flex items-center gap-2.5 text-[13px] cursor-pointer">
              <input
                type="checkbox"
                checked={p.on}
                disabled={pending}
                onChange={(e) =>
                  run(
                    () =>
                      setNotifPrefs({
                        resolve: p.key === "resolve" ? e.target.checked : notifResolve,
                        closing: p.key === "closing" ? e.target.checked : notifClosing,
                      }),
                    t.savedToast
                  )
                }
                className="size-4 accent-brand cursor-pointer"
              />
              {p.label}
            </label>
          ))}
        </div>
      </div>
    </Card>
  );
}
