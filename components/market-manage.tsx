"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck, Ban, Pencil, Lock, ChevronDown, ChevronRight } from "lucide-react";
import { Button, Card, Input, Textarea, Select } from "@/components/ui/primitives";
import { ImageCell, IconPicker } from "@/components/image-cell";
import { MarketIcon } from "@/components/market-icon";
import { CategoryModal } from "@/components/category-modal";
import { DateTimePicker } from "@/components/date-time-picker";
import { resolveMarket, cancelMarket, updateMarket } from "@/lib/actions";
import { fmtMonos } from "@/lib/money";
import { optionColor } from "@/lib/option-style";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Owner/admin controls on a market page — resolve (this happened / did not
// happen), cancel-and-refund, and an edit form mirroring the creation form.
// Locked once bets exist: the question (changes what people bet on) and the
// liquidity depth b (reprices every open position). Market type and starting
// odds are creation-only — the book can't be restructured or reseeded.
export function MarketManagePanel({
  market,
  options,
  categories,
  betCount,
  isAdmin,
  lang,
}: {
  market: {
    id: string;
    question: string;
    description: string;
    context?: string;
    category: string;
    imageUrl: string | null;
    closesAt: string | Date | null;
    opensAt?: string | Date | null;
    status: string;
    kind: string;
    b: number;
    recurDays: number | null;
    maxLeverage: number;
    maxBetCents?: number | null;
  };
  options?: { id: string; label: string; imageUrl: string | null }[];
  categories: string[];
  betCount: number;
  isAdmin?: boolean;
  lang?: Lang;
}) {
  const t = getT(lang ?? "cs");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(market.question);
  const [description, setDescription] = useState(market.description);
  const [context, setContext] = useState(market.context ?? "");
  const [category, setCategory] = useState(market.category);
  const [imageUrl, setImageUrl] = useState(market.imageUrl ?? "");
  const [catModal, setCatModal] = useState(false);
  const [extraCats, setExtraCats] = useState<string[]>([]);
  // datetime-local speaks local wall-time — render the instant in local terms
  // or every edit silently shifts the schedule by the UTC offset.
  const toLocalInput = (d: string | Date) =>
    new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [opensAt, setOpensAt] = useState(market.opensAt ? toLocalInput(market.opensAt) : "");
  const [closesAt, setClosesAt] = useState(market.closesAt ? toLocalInput(market.closesAt) : "");
  const [opts, setOpts] = useState((options ?? []).map((o) => ({ ...o, imageUrl: o.imageUrl ?? "" })));
  const [recurDays, setRecurDays] = useState(String(market.recurDays ?? 0));
  const [maxLeverage, setMaxLeverage] = useState(market.maxLeverage);
  const [maxBet, setMaxBet] = useState(market.maxBetCents != null ? String(market.maxBetCents / 100) : ""); // Ɱ, blank = house default
  const [liquidity, setLiquidity] = useState(market.b);
  const [reason, setReason] = useState("");

  const questionLocked = betCount > 0;
  const live = market.status === "live";
  const isGroup = market.kind === "group";
  const typeLabel = market.kind === "binary" ? t.typeBinary : t.typeMulti;
  const LIQUIDITY = [
    { b: 300, label: t.liqThin, hint: t.liqThinHint },
    { b: 1000, label: t.liqStandard, hint: t.liqStandardHint },
    { b: 3000, label: t.liqDeep, hint: t.liqDeepHint },
  ] as const;

  const run = (fn: () => Promise<{ ok: boolean; error?: string; paidOut?: number }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.paidOut ? `${ok} — ${fmtMonos(r.paidOut, { lang })}` : ok);
        router.refresh();
      } else toast.error(t.serverErr(r.error));
    });

  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-[13px] font-semibold text-mute uppercase tracking-wide flex items-center gap-1.5">
        <Pencil className="size-3.5" /> {t.manage}
      </h3>

      {live && market.kind !== "group" && (
        <div className="space-y-2">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t.reasonPh}
            maxLength={500}
            className="text-[13px]"
          />
          <div className="flex flex-wrap gap-1.5">
            <Button size="xs" variant="yes" disabled={pending} onClick={() => {
              if (confirm(t.resolveYesConfirm)) run(() => resolveMarket({ marketId: market.id, outcome: "yes", reason }), t.resolvedYesToast);
            }}>
              <CircleCheck className="size-3" /> {t.resolveYes}
            </Button>
            <Button size="xs" variant="no" disabled={pending} onClick={() => {
              if (confirm(t.resolveNoConfirm)) run(() => resolveMarket({ marketId: market.id, outcome: "no", reason }), t.resolvedNoToast);
            }}>
              <CircleCheck className="size-3" /> {t.resolveNo}
            </Button>
            <Button size="xs" variant="outline" disabled={pending} onClick={() => {
              if (confirm(t.cancelConfirm)) run(() => cancelMarket(market.id), t.cancelledToast);
            }}>
              <Ban className="size-3" /> {t.cancelRefund}
            </Button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="flex w-full items-center justify-between rounded-lg border border-line-2 bg-surface-2/50 px-3 py-2 text-[12.5px] font-semibold text-ink hover:bg-surface-2 transition-colors cursor-pointer"
        onClick={() => setEditing((v) => !v)}
      >
        <span className="inline-flex items-center gap-1.5">
          <Pencil className="size-3.5 text-faint" /> {t.editMarket}
        </span>
        {editing ? <ChevronDown className="size-4 text-faint" /> : <ChevronRight className="size-4 text-faint" />}
      </button>

      {editing && (
        <form
          className="space-y-3 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                updateMarket({
                  marketId: market.id,
                  question,
                  description,
                  context,
                  category,
                  imageUrl,
                  // Send real instants (ISO) — a raw datetime-local string
                  // would parse in the server's timezone, not the user's.
                  // Empty string clears the field on purpose.
                  opensAt: opensAt ? new Date(opensAt).toISOString() : "",
                  closesAt: closesAt ? new Date(closesAt).toISOString() : "",
                  recurDays: Number(recurDays),
                  maxLeverage,
                  maxBetCents: maxBet.trim() === "" ? null : Math.round(parseFloat(maxBet) * 100),
                  b: liquidity,
                  options: isGroup ? opts.map((o) => ({ id: o.id, label: o.label, imageUrl: o.imageUrl })) : undefined,
                }),
              t.savedToast
            );
          }}
        >
          {/* Live preview — icon + question exactly as cards render them. */}
          <div className="rounded-xl border border-line-2 bg-surface-2/40 p-2.5">
            <div className="flex items-center gap-2.5">
              <MarketIcon market={{ question, category, imageUrl: imageUrl || null }} size="size-10" />
              <span className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug line-clamp-2 text-ink-2">
                {question || "…"}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <ImageCell
                image={imageUrl}
                onImage={setImageUrl}
                imageHint={t.optionImageHint}
                onBadImage={() => toast.error(t.imageBad)}
                className="size-9"
              />
              <IconPicker onPick={setImageUrl} hint={t.iconPickerHint} />
              <p className="min-w-0 flex-1 text-[10.5px] leading-tight text-faint">{t.marketIconHint}</p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
              {t.marketType}
            </label>
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
              <Lock className="size-3 text-faint" /> {typeLabel}
              <span className="text-[10.5px] font-normal text-faint">— {t.typeFixed}</span>
            </p>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
              {t.question}
            </label>
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={200}
              disabled={questionLocked}
              title={questionLocked ? t.questionLocked : undefined}
            />
            {questionLocked && (
              <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-faint">
                <Lock className="size-3" /> {t.questionLocked}
              </p>
            )}
          </div>

          {isGroup && opts.length > 0 && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
                {t.optionsLabel}
              </label>
              <div className="space-y-1.5">
                {opts.map((o, i) => (
                  <div key={o.id} className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full shrink-0" style={{ background: optionColor(i) }} />
                    <Input
                      value={o.label}
                      onChange={(e) => setOpts((s) => s.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
                      maxLength={60}
                      className="h-9 text-[13px] flex-1"
                    />
                    <ImageCell
                      image={o.imageUrl}
                      onImage={(v) => setOpts((s) => s.map((r, j) => (j === i ? { ...r, imageUrl: v } : r)))}
                      imageHint={t.optionImageHint}
                      onBadImage={() => toast.error(t.imageBad)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
              {t.rules}
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.rulesPh}
              className="min-h-24 text-[13px]"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
              {t.marketContext}
            </label>
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder={t.contextPh}
              maxLength={2000}
              className="min-h-16 text-[13px]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
                {t.category}
              </label>
              <Select
                value={category}
                onChange={(e) => {
                  if (e.target.value === "__new__") setCatModal(true);
                  else setCategory(e.target.value);
                }}
              >
                {[...categories, ...extraCats.filter((c) => !categories.includes(c))].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                <option value="__new__">{t.newCategory}</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
                {t.opensLabel}
              </label>
              <DateTimePicker value={opensAt} onChange={setOpensAt} lang={lang} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
                {t.closes}
              </label>
              <DateTimePicker value={closesAt} onChange={setClosesAt} lang={lang} />
            </div>
            {market.kind !== "option" && (
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
                  {t.repeats}
                </label>
                <Select value={recurDays} onChange={(e) => setRecurDays(e.target.value)}>
                  <option value="0">{t.recurNever}</option>
                  <option value="1">{t.recurDaily}</option>
                  <option value="7">{t.recurWeekly}</option>
                  <option value="14">{t.recurBiweekly}</option>
                  <option value="30">{t.recurMonthly}</option>
                </Select>
              </div>
            )}
          </div>

          {market.kind !== "option" && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
                {t.maxLev}
              </label>
              <Select value={String(maxLeverage)} onChange={(e) => setMaxLeverage(Number(e.target.value))}>
                {[1, 2, 3, 5, 10, 20, 50, 100].map((v) => (
                  <option key={v} value={v}>
                    {v === 1 ? `${t.maxLevNone} (1×)` : `${v}×`}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {market.kind !== "option" && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
                {t.maxBetLabel}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mute font-semibold text-sm">Ɱ</span>
                <Input
                  type="number"
                  min={10}
                  step="1"
                  placeholder={t.maxBetPlaceholder}
                  value={maxBet}
                  onChange={(e) => setMaxBet(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
          )}

          {isAdmin && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
                {t.liquidity}
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {LIQUIDITY.map((l) => (
                  <button
                    key={l.b}
                    type="button"
                    disabled={questionLocked}
                    onClick={() => setLiquidity(l.b)}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-left transition-colors",
                      liquidity === l.b ? "border-brand bg-brand-soft" : "border-line hover:border-faint/60",
                      questionLocked ? "opacity-45 cursor-not-allowed" : "cursor-pointer"
                    )}
                  >
                    <div className="text-[12px] font-bold">{l.label}</div>
                    <div className="mt-0.5 text-[10px] leading-tight text-mute">{l.hint}</div>
                  </button>
                ))}
              </div>
              {questionLocked && (
                <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-faint">
                  <Lock className="size-3" /> {t.liqLocked}
                </p>
              )}
            </div>
          )}

          <Button size="sm" className="w-full" disabled={pending || question.trim().length < 10}>
            {pending ? "…" : t.save}
          </Button>
        </form>
      )}

      <CategoryModal
        open={catModal}
        onClose={() => setCatModal(false)}
        onPicked={(name) => {
          setExtraCats((s) => (s.includes(name) ? s : [...s, name]));
          setCategory(name);
          router.refresh();
        }}
        lang={lang}
      />
    </Card>
  );
}
