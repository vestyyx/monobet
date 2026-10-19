"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Bell, Check, CheckCheck, Circle, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { fmtMonos, timeAgo } from "@/lib/money";
import { playSfx } from "@/lib/sfx";
import { getT, type Lang } from "@/lib/i18n";

export type NotifItem = {
  id: string;
  kind: string;
  amountCents: number;
  memo: string;
  createdAt: Date | string;
  slug: string | null;
};

type NotifState = { read: string[]; cleared: string[] };
const EMPTY: NotifState = { read: [], cleared: [] };

const stateKey = (userId: string) => `monobet.notif.${userId}`;
const legacyKey = (userId: string) => `monobet.notifSeen.${userId}`;
const NOTIF_EVENT = "monobet-notif";

// Parsed snapshots are cached so getSnapshot returns a stable reference.
const parseCache = new Map<string, { raw: string | null; state: NotifState }>();

function readState(userId: string): NotifState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(stateKey(userId));
  } catch {
    return EMPTY;
  }
  const hit = parseCache.get(userId);
  if (hit && hit.raw === raw) return hit.state;
  let state = EMPTY;
  if (raw) {
    try {
      const p = JSON.parse(raw) as Partial<NotifState>;
      state = { read: p.read ?? [], cleared: p.cleared ?? [] };
    } catch {
      state = EMPTY;
    }
  }
  parseCache.set(userId, { raw, state });
  return state;
}

function writeState(userId: string, state: NotifState) {
  localStorage.setItem(stateKey(userId), JSON.stringify(state));
  window.dispatchEvent(new Event(NOTIF_EVENT));
}

export function NotifBell({ items: ssrItems, userId, lang }: { items: NotifItem[]; userId: string; lang?: Lang }) {
  const t = getT(lang ?? "cs");
  const [open, setOpen] = useState(false);
  const [polled, setPolled] = useState<NotifItem[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // Live poll — the server only feeds the bell on navigation; this keeps the
  // badge and dropdown fresh without waiting for a page change.
  useEffect(() => {
    let dead = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/notifications", { cache: "no-store" });
        if (!r.ok || dead) return;
        const data = (await r.json()) as { items?: NotifItem[] };
        if (Array.isArray(data.items)) setPolled(data.items);
      } catch {
        /* offline — keep the last snapshot */
      }
    };
    const id = setInterval(tick, 8000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      dead = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  // SSR props and polled snapshots read the same ledger rows — union by id,
  // newest first, so neither source can hide a fresh row.
  const items = useMemo(() => {
    const m = new Map<string, NotifItem>();
    for (const i of ssrItems) m.set(i.id, i);
    for (const i of polled) m.set(i.id, i);
    return [...m.values()]
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 12);
  }, [ssrItems, polled]);

  // Read/cleared state is per-account — two users sharing a browser shouldn't
  // inherit each other's notifications.
  const state = useSyncExternalStore(
    (cb) => {
      window.addEventListener(NOTIF_EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(NOTIF_EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => readState(userId),
    () => EMPTY
  );

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // One-time migration from the old timestamp marker: everything at or before
  // it counts as read.
  useEffect(() => {
    let legacy: string | null = null;
    try {
      legacy = localStorage.getItem(legacyKey(userId));
    } catch {
      return;
    }
    if (legacy === null) return;
    localStorage.removeItem(legacyKey(userId));
    if (localStorage.getItem(stateKey(userId))) return;
    const ts = Number(legacy) || 0;
    writeState(userId, {
      read: items.filter((i) => new Date(i.createdAt).getTime() <= ts).map((i) => i.id),
      cleared: [],
    });
  }, [userId, items]);

  const readSet = new Set(state.read);
  const clearedSet = new Set(state.cleared);
  const visible = items.filter((i) => !clearedSet.has(i.id));
  const unread = visible.filter((i) => !readSet.has(i.id)).length;

  // Ping when a fresh notification id arrives — skip the initial hydration set.
  const knownRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(visible.map((i) => i.id));
    if (knownRef.current === null) {
      knownRef.current = ids;
      return;
    }
    for (const id of ids) {
      if (!knownRef.current.has(id)) {
        playSfx("notify", 0.45);
        break;
      }
    }
    knownRef.current = ids;
  }, [items, state]);

  const markRead = (id: string) => {
    if (readSet.has(id)) return;
    writeState(userId, { ...state, read: [...state.read, id] });
  };
  const toggleRead = (id: string) => {
    writeState(userId, {
      ...state,
      read: readSet.has(id) ? state.read.filter((r) => r !== id) : [...state.read, id],
    });
  };
  const markAllRead = () =>
    writeState(userId, { ...state, read: [...readSet, ...visible.map((i) => i.id)] });
  const clearAll = () =>
    writeState(userId, { ...state, cleared: [...clearedSet, ...visible.map((i) => i.id)] });

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative size-8 sm:size-9 grid place-items-center rounded-lg text-mute hover:text-ink hover:bg-surface-2 transition cursor-pointer"
        aria-label={t.notifications}
      >
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-4 h-4 px-0.5 rounded-full bg-no text-no-on text-[9.5px] font-bold grid place-items-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-80 rounded-xl border border-line bg-surface shadow-lg p-1.5 z-50 anim-rise max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between px-2.5 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">
              {t.notifications}
            </span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={markAllRead}
                disabled={unread === 0}
                title={t.markAllRead}
                className="size-7 grid place-items-center rounded-md text-mute hover:text-ink hover:bg-surface-2 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              >
                <CheckCheck className="size-3.5" />
              </button>
              <button
                onClick={clearAll}
                disabled={visible.length === 0}
                title={t.clearNotifs}
                className="size-7 grid place-items-center rounded-md text-mute hover:text-no hover:bg-no-soft disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
          {visible.length === 0 && <p className="px-3.5 py-6 text-center text-[13px] text-mute">{t.noNotifs}</p>}
          {visible.map((n) => {
            const isUnread = !readSet.has(n.id);
            const inner = (
              <div
                className={cn(
                  "group flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-surface-2",
                  isUnread && "bg-brand-soft/40"
                )}
              >
                <span className={cn("size-1.5 rounded-full shrink-0", isUnread ? "bg-brand" : "bg-transparent")} />
                <Badge tone={n.kind === "liq" ? "no" : n.amountCents > 0 ? "yes" : "ink"} className="shrink-0">
                  {n.kind === "liq" ? t.kindLiq : n.amountCents > 0 ? `+${fmtMonos(n.amountCents, { lang, decimals: false })}` : t.kindNotify}
                </Badge>
                <span className={cn("text-[12.5px] flex-1 line-clamp-2", isUnread ? "text-ink" : "text-mute")}>
                  {n.memo || n.kind}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <span className="text-[10.5px] text-faint group-hover:hidden">{timeAgo(new Date(n.createdAt), lang)}</span>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleRead(n.id);
                    }}
                    title={isUnread ? t.markRead : t.markUnread}
                    className="hidden group-hover:grid size-6 place-items-center rounded-md text-mute hover:text-ink hover:bg-surface-3 cursor-pointer"
                  >
                    {isUnread ? <Check className="size-3.5" /> : <Circle className="size-3.5" />}
                  </button>
                </span>
              </div>
            );
            return n.slug ? (
              <Link
                key={n.id}
                href={`/market/${n.slug}`}
                onClick={() => {
                  markRead(n.id);
                  setOpen(false);
                }}
              >
                {inner}
              </Link>
            ) : (
              <div key={n.id} onClick={() => markRead(n.id)} className="cursor-pointer">
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
