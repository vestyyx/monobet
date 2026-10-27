"use client";

// Phase 3 admin panels:
//   AdminPlayersPanel   — /admin/players: list + role/suspend/sign-out/kid/max-stake
//   AdminGroupsPanel    — /admin/groups: squad cards (pot, members, invite code, parent, pause, owner)
//   AdminApprovalsPanel — /admin/approvals: player-created markets awaiting a moderator decision
// Style follows money-panels.tsx (useState + useTransition + sonner toasts).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Input, Select, Badge, Card, Textarea } from "@/components/ui/primitives";
import {
  adminSetRole,
  adminTempBan,
  adminUnban,
  adminForceLogout,
  adminSetKidMode,
  adminSetMaxStake,
  adminPauseSquad,
  adminRotateInviteCode,
  adminSetInviteEnabled,
  adminSetSquadParent,
  adminTransferSquad,
  approvalApproveMarket,
  approvalRejectMarket,
} from "@/lib/actions-admin";
import { squadKick } from "@/lib/actions";
import { fmtMonos, fmtDateTime } from "@/lib/money";
import { getT, serverErr, type Lang } from "@/lib/i18n";
import { UserRound, ShieldCheck, Crown, Ban, LogOut, Baby, Wallet, UserX, Search } from "lucide-react";

// ---------- shared row shapes (serialized server-side) ----------
export type AdminUserRow = {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  kidMode: boolean;
  maxStakeCents: number | null;
  frozenAt: string | null;
  bannedAt: string | null;
  bannedUntil: string | null;
  banReason: string | null;
  suspended: boolean; // precomputed server-side (render stays pure)
  createdAtMs: number;
  squadName: string | null;
  balanceCents: number;
};

export type AdminSquadGroupRow = {
  id: string;
  name: string;
  treasuryCents: number;
  createdAtMs: number;
  pausedAt: string | null;
  inviteCode: string | null;
  inviteEnabled: boolean;
  ownerUsername: string | null;
  members: { id: string; username: string; squadRole: string | null }[];
};

export type AdminPendingMarketRow = {
  id: string;
  slug: string;
  question: string;
  kind: string;
  creator: string | null;
  createdAtMs: number;
};

// ============================================================
// /admin/players
// ============================================================
export function AdminPlayersPanel({ lang, players }: { lang: Lang; players: AdminUserRow[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const shown = players.filter(
    (u) => !q || (u.username ?? "").toLowerCase().includes(q.toLowerCase()) || u.name.toLowerCase().includes(q.toLowerCase())
  );

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) =>
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) throw new Error(res.error ?? "Error");
        if (okMsg) toast.success(okMsg);
        router.refresh();
      } catch (e) {
        toast.error(serverErr(lang, e instanceof Error ? e.message : null) ?? "Error");
      }
    });

  return (
    <div>
      {/* local search on top of the server-side filters */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1 max-w-[280px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-mute pointer-events-none" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.admPlayersQ}
            className="pl-7 h-8 text-[12.5px]"
          />
        </div>
        <span className="text-[11.5px] text-mute">{shown.length}</span>
      </div>

      {shown.length === 0 && <p className="text-[12.5px] text-mute py-8 text-center">{t.admPlayersNoResults}</p>}

      <div className="flex flex-col gap-2">
        {shown.map((u) => (
          <PlayerCard
            key={u.id}
            lang={lang}
            u={u}
            open={openId === u.id}
            onToggle={() => setOpenId(openId === u.id ? null : u.id)}
            busy={pending}
            run={run}
          />
        ))}
      </div>
    </div>
  );
}

function PlayerCard({
  lang,
  u,
  open,
  onToggle,
  busy,
  run,
}: {
  lang: Lang;
  u: AdminUserRow;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) => void;
}) {
  const t = getT(lang);
  const [role, setRole] = useState(u.role === "owner" ? "owner" : u.role === "admin" ? "admin" : u.role === "moderator" ? "moderator" : "user");
  const [days, setDays] = useState("7");
  const [banReason, setBanReason] = useState("");
  const [cap, setCap] = useState(u.maxStakeCents ? String(u.maxStakeCents / 100) : "");
  const [limitReason, setLimitReason] = useState("");

  const bannedNow = u.suspended;

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <a href={`/admin/players/${u.id}`} className="font-semibold text-[13px] hover:underline">
          @{u.username}
        </a>
        <span className="text-[11.5px] text-mute truncate max-w-[180px]">{u.name}</span>
        <Badge tone={u.role === "owner" ? "warn" : u.role === "admin" ? "no" : u.role === "moderator" ? "ink" : "mute"}>
          {u.role === "owner" ? t.admPlayersOwner : u.role === "admin" ? t.admPlayersAdmin : u.role === "moderator" ? t.admPlayersModerator : t.admPlayersStd}
        </Badge>
        {u.kidMode && <Badge tone="yes">{t.admPlayersBadgeKid}</Badge>}
        {u.frozenAt && <Badge tone="no">{t.admPlayersBadgeFrozen}</Badge>}
        {bannedNow && (
          <Badge tone="no">
            {t.admPlayersBadgeBanned}
            {u.bannedUntil ? ` — ${t.admPlayersBannedUntil.replace("{date}", fmtDateTime(new Date(u.bannedUntil), lang))}` : ""}
          </Badge>
        )}
        <span className="ml-auto text-[11.5px] text-mute">{u.squadName ? `@ ${u.squadName}` : ""}</span>
        <span className="text-[11.5px] font-medium">{fmtMonos(u.balanceCents)}</span>
        <Button variant="ghost" size="sm" onClick={onToggle} className="shrink-0">
          {t.admPlayersActions}
        </Button>
      </div>

      {open && u.role !== "owner" && (
        <div className="mt-3 pt-3 border-t border-line flex flex-col gap-3">
          {/* role */}
          <div className="flex items-center gap-2 flex-wrap">
            <UserRound className="size-3.5 text-mute" />
            <Select value={role} onChange={(e) => setRole(e.target.value)} className="h-8 text-[12.5px] w-auto">
              <option value="user">{t.admPlayersStd}</option>
              <option value="moderator">{t.admPlayersModerator}</option>
              <option value="admin">{t.admPlayersAdmin}</option>
            </Select>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(() => adminSetRole({ userId: u.id, role: role as "user" | "moderator" | "admin" }), t.admPlayersDone)}
            >
              {t.admPlayersRoleApply}
            </Button>
          </div>

          {/* suspension */}
          <div className="flex items-center gap-2 flex-wrap">
            <Ban className="size-3.5 text-mute" />
            <Input value={days} onChange={(e) => setDays(e.target.value)} type="number" min="1" max="365" className="h-8 w-[70px] text-[12.5px]" />
            <Input value={banReason} onChange={(e) => setBanReason(e.target.value)} placeholder={t.admPlayersBanReason} className="h-8 flex-1 min-w-[180px] text-[12.5px]" />
            {bannedNow ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => adminUnban({ userId: u.id, reason: banReason }), t.admPlayersDone)}>
                {t.admPlayersUnban}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => run(() => adminTempBan({ userId: u.id, days: Math.round(Number(days) || 0), reason: banReason }), t.admPlayersDone)}
              >
                {t.admPlayersBan}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => run(() => adminForceLogout({ userId: u.id, reason: banReason }), t.admPlayersDone)}
            >
              <LogOut className="size-3.5 mr-1" />
              {t.admPlayersForceLogout}
            </Button>
          </div>

          {/* kid mode + stake cap */}
          <div className="flex items-center gap-2 flex-wrap">
            <Baby className="size-3.5 text-mute" />
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    adminSetKidMode({
                      userId: u.id,
                      on: !u.kidMode,
                      reason: limitReason.trim() || (u.kidMode ? `Kid mode disabled (${u.username})` : `Kid mode enabled (${u.username})`),
                    }),
                  t.admPlayersDone
                )
              }
            >
              {u.kidMode ? t.admPlayersKidOn : t.admPlayersKidOff}
            </Button>
            <Wallet className="size-3.5 text-mute ml-2" />
            <Input value={cap} onChange={(e) => setCap(e.target.value)} placeholder={t.admPlayersMaxStake} className="h-8 w-[170px] text-[12.5px]" />
            <Input value={limitReason} onChange={(e) => setLimitReason(e.target.value)} placeholder={t.admPlayersBanReason} className="h-8 flex-1 min-w-[160px] text-[12.5px]" />
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                run(
                  () => adminSetMaxStake({ userId: u.id, monos: cap.trim() === "" ? null : cap.trim(), reason: limitReason }),
                  t.admPlayersDone
                )
              }
            >
              {t.admPlayersLimitApply}
            </Button>
          </div>
        </div>
      )}
      {open && u.role === "owner" && (
        <div className="mt-3 pt-3 border-t border-line text-[11.5px] text-mute flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" /> 👑
        </div>
      )}
    </Card>
  );
}

// also exposed for the squad member kick lives in a group-context panel;
// exported from actions.ts, called implicitly by AdminGroupsPanel (below).

// ============================================================
// /admin/groups
// ============================================================
export function AdminGroupsPanel({ lang, squads }: { lang: Lang; squads: AdminSquadGroupRow[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) =>
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) throw new Error(res.error ?? "Error");
        if (okMsg) toast.success(okMsg);
        router.refresh();
      } catch (e) {
        toast.error(serverErr(lang, e instanceof Error ? e.message : null) ?? "Error");
      }
    });

  if (squads.length === 0) return <p className="text-[12.5px] text-mute py-8 text-center">{t.admGroupsNothing}</p>;

  return (
    <div className="flex flex-col gap-2">
      {squads.map((s) => (
        <SquadCard
          key={s.id}
          lang={lang}
          s={s}
          open={openId === s.id}
          onToggle={() => setOpenId(openId === s.id ? null : s.id)}
          busy={pending}
          run={run}
        />
      ))}
    </div>
  );
}

function SquadCard({
  lang,
  s,
  open,
  onToggle,
  busy,
  run,
}: {
  lang: Lang;
  s: AdminSquadGroupRow;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) => void;
}) {
  const t = getT(lang);
  const [pauseReason, setPauseReason] = useState("");
  const [parentId, setParentId] = useState(s.members.find((m) => m.squadRole === "parent")?.id ?? "");
  const [transferId, setTransferId] = useState("");

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-[13px]">{s.name}</span>
        {s.pausedAt && <Badge tone="no">{t.admGroupsPaused}</Badge>}
        <span className="text-[11.5px] text-mute">
          {s.members.length === 1 ? t.admGroupsMember1 : t.admGroupsMembers.replace("{n}", String(s.members.length))}
        </span>
        <span className="text-[11.5px] text-mute">
          {t.admGroupsPot}: <span className="font-medium text-ink">{fmtMonos(s.treasuryCents)}</span>
        </span>
        <span className="text-[11.5px] text-mute">
          {t.admGroupsOwner}: <a className="hover:underline" href={s.ownerUsername ? `/u/${s.ownerUsername}` : "#"}>{s.ownerUsername ? `@${s.ownerUsername}` : "—"}</a>
        </span>
        <span className="ml-auto text-[11.5px] text-mute">
          {t.admGroupsCode}:{" "}
          <code className={s.inviteEnabled && s.inviteCode ? "font-mono font-semibold text-ink" : "text-mute"}>{s.inviteCode ?? t.admGroupsCodeNone}</code>
        </span>
        <Button variant="ghost" size="sm" onClick={onToggle} className="shrink-0">
          {t.admGroupsMembersList}
        </Button>
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-line flex flex-col gap-3">
          {/* members */}
          <div className="flex flex-col gap-1">
            {s.members.map((m) => (
              <div key={m.id} className="flex items-center gap-2 text-[12.5px]">
                <Crown className={`size-3.5 ${m.squadRole === "parent" ? "text-warn" : "text-mute"}`} />
                <a href={`/admin/players/${m.id}`} className="hover:underline font-medium">
                  @{m.username}
                </a>
                {m.squadRole === "parent" && <Badge tone="warn">{t.admGroupsParent}</Badge>}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  disabled={busy}
                  onClick={() => run(() => squadKick(m.username), t.admPlayersDone)}
                >
                  <UserX className="size-3.5 mr-1" /> ×
                </Button>
              </div>
            ))}
          </div>

          {/* parent */}
          <div className="flex items-center gap-2 flex-wrap">
            <Crown className="size-3.5 text-mute" />
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)} className="h-8 text-[12.5px] w-auto">
              <option value="">{t.admGroupsParentSelect}</option>
              {s.members.map((m) => (
                <option key={m.id} value={m.id}>
                  @{m.username}
                </option>
              ))}
            </Select>
            <Button size="sm" disabled={busy || !parentId} onClick={() => run(() => adminSetSquadParent({ squadId: s.id, userId: parentId, parent: true }), t.admPlayersDone)}>
              {t.admGroupsParentSelect}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => adminSetSquadParent({ squadId: s.id, userId: parentId, parent: false }), t.admPlayersDone)}>
              {t.admGroupsParentRemove}
            </Button>
          </div>

          {/* pause */}
          <div className="flex items-center gap-2 flex-wrap">
            <Ban className="size-3.5 text-mute" />
            <Input value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} placeholder={t.admGroupsPauseReason} className="h-8 flex-1 min-w-[200px] text-[12.5px]" />
            {s.pausedAt ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => adminPauseSquad({ squadId: s.id, pause: false, reason: pauseReason }), t.admPlayersDone)}>
                {t.admGroupsResume}
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => adminPauseSquad({ squadId: s.id, pause: true, reason: pauseReason }), t.admPlayersDone)}>
                {t.admGroupsPause}
              </Button>
            )}
          </div>

          {/* invite code */}
          <div className="flex items-center gap-2 flex-wrap">
            <UserRound className="size-3.5 text-mute" />
            <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => adminRotateInviteCode({ squadId: s.id }), t.admPlayersDone)}>
              {t.admGroupsRotate}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() =>
              run(
                () =>
                  adminSetInviteEnabled({
                    squadId: s.id,
                    enabled: !s.inviteEnabled,
                    reason: pauseReason.trim() || `${s.name}: invite codes ${!s.inviteEnabled ? "enabled" : "disabled"}`,
                  }),
                t.admPlayersDone
              )
            }>
              {s.inviteEnabled ? t.admGroupsDisableCode : t.admGroupsEnableCode}
            </Button>
          </div>

          {/* owner transfer (admin+) */}
          <div className="flex items-center gap-2 flex-wrap">
            <ShieldCheck className="size-3.5 text-mute" />
            <Select value={transferId} onChange={(e) => setTransferId(e.target.value)} className="h-8 text-[12.5px] w-auto">
              <option value="">{t.admGroupsTransferTo}</option>
              {s.members.map((m) => (
                <option key={m.id} value={m.id}>
                  @{m.username}
                </option>
              ))}
            </Select>
            <Button size="sm" disabled={busy || !transferId} onClick={() => run(() => adminTransferSquad({ squadId: s.id, userId: transferId }), t.admPlayersDone)}>
              {t.admGroupsTransferBtn}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ============================================================
// /admin/approvals
// ============================================================
export function AdminApprovalsPanel({ lang, markets }: { lang: Lang; markets: AdminPendingMarketRow[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) =>
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) throw new Error(res.error ?? "Error");
        if (okMsg) toast.success(okMsg);
        router.refresh();
      } catch (e) {
        toast.error(serverErr(lang, e instanceof Error ? e.message : null) ?? "Error");
      }
    });

  if (markets.length === 0) return <p className="text-[12.5px] text-mute py-8 text-center">{t.admApprovalsNothing}</p>;

  return (
    <div className="flex flex-col gap-2">
      {/* one decision reason shared by the whole batch — family scale */}
      <Card className="p-3">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.admApprovalsReason} rows={2} className="text-[12.5px]" />
      </Card>
      {markets.map((m) => (
        <Card key={m.id} className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <a href={`/market/${m.slug}`} className="font-medium text-[13px] hover:underline line-clamp-1">
              {m.question}
            </a>
            <Badge tone="mute">{m.kind}</Badge>
            <span className="text-[11.5px] text-mute">
              {t.admApprovalsBy} @{m.creator ?? "?"} · {t.admApprovalsWhen} {fmtDateTime(new Date(m.createdAtMs), lang)}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <Button size="sm" disabled={pending} onClick={() => run(() => approvalApproveMarket({ marketId: m.id, reason }), t.admPlayersDone)}>
                {t.admApprovalsApprove}
              </Button>
              <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => approvalRejectMarket({ marketId: m.id, reason }), t.admPlayersDone)}>
                {t.admApprovalsReject}
              </Button>
            </span>
          </div>
        </Card>
      ))}
    </div>
  );
}
