// Admin module registry.
//
// Every admin-manageable part of MonoPredict registers itself here once:
// prediction markets, gigs, and the family games that land in later phases
// (trivia, closest-guess, bracket pools, family quests, word/emoji guess,
// photo guess, group polls).
//
// The admin sidebar, the dashboard quick links and the section router are all
// GENERATED from this list — adding a module or flipping `built` updates the
// whole panel automatically. No hardcoded navigation anywhere.
//
// `built: false` modules render a shared "planned" stub page until their
// phase delivers the real page, so the registry can ship complete today.
import {
  BarChart3,
  Wallet,
  Landmark,
  Users,
  Network,
  Inbox,
  ShieldAlert,
  ScrollText,
  Settings,
  Sparkles,
  Brain,
  Target,
  Trophy,
  Compass,
  MessageCircleQuestion,
  ImageIcon,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/admin/rbac";

export type AdminModuleDef = {
  id: string; // URL segment under /admin — also the stable registry key
  labelEn: string;
  labelCs: string;
  descEn: string; // one-liner shown on the "planned" stub and dashboard hints
  descCs: string;
  icon: LucideIcon;
  minRole: Role; // lowest role that may see/act on the module
  built: boolean; // real admin UI exists for this module yet?
  deliveryPhase: string; // shown on stubs, e.g. "Phase 5"
  group: string; // sidebar section heading ("platform" | "money" | "people" | "safety" | "games")
};

export const ADMIN_MODULES: AdminModuleDef[] = [
  // ---------- platform ----------
  {
    id: "approvals",
    labelEn: "Approvals",
    labelCs: "Schvalování",
    descEn: "New members and player-created markets, questions and gigs waiting for a decision.",
    descCs: "Noví členové a trhy, otázky a brigády od hráčů čekající na rozhodnutí.",
    icon: Inbox,
    minRole: "moderator",
    built: false,
    deliveryPhase: "Phase 3",
    group: "platform",
  },
  {
    id: "settings",
    labelEn: "Platform settings",
    labelCs: "Nastavení platformy",
    descEn: "Versioned economy config, announcements, maintenance mode, registration switch.",
    descCs: "Verzovaná ekonomika, oznámení, režim údržby, přepínač registrací.",
    icon: Settings,
    minRole: "admin",
    built: false,
    deliveryPhase: "Phase 6",
    group: "platform",
  },
  {
    id: "audit-log",
    labelEn: "Audit log",
    labelCs: "Auditní log",
    descEn: "Immutable log of every admin action — who, what, target, reason, when.",
    descCs: "Neměnný log každého zásahu administrátora — kdo, co, cíl, důvod, kdy.",
    icon: ScrollText,
    minRole: "admin",
    built: false,
    deliveryPhase: "Phase 2",
    group: "platform",
  },

  // ---------- money ----------
  {
    id: "money",
    labelEn: "Player money",
    labelCs: "Hráčské Mony",
    descEn: "Ledger-backed grants, deductions, transfers, refunds, reversals, freeze, bulk pay-outs.",
    descCs: "Připsání, odečty, převody, refundace, obrácení položek, zmrazení i hromadné výplaty.",
    icon: Wallet,
    minRole: "admin",
    built: false,
    deliveryPhase: "Phase 2",
    group: "money",
  },
  {
    id: "economy",
    labelEn: "Economy dashboard",
    labelCs: "Ekonomika",
    descEn: "Supply, distribution, inflation trend, income vs sinks, reconciliation check.",
    descCs: "Zásoba peněz, distribuce, inflace, příjmy vs odstupy, kontrola součtů.",
    icon: Landmark,
    minRole: "admin",
    built: false,
    deliveryPhase: "Phase 6",
    group: "money",
  },

  // ---------- people ----------
  {
    id: "players",
    labelEn: "Players & groups",
    labelCs: "Hráči a skupiny",
    descEn: "Player accounts, balances at a glance, groups, invites and per-group settings.",
    descCs: "Účty hráčů, přehled zůstatků, skupiny, pozvánky a nastavení skupin.",
    icon: Users,
    minRole: "moderator",
    built: false,
    deliveryPhase: "Phase 3",
    group: "people",
  },
  {
    id: "groups",
    labelEn: "Groups",
    labelCs: "Skupiny",
    descEn: "Family/class/friends groups: members, invite codes, per-group economy, pause.",
    descCs: "Skupiny rodina/třída/kamarádi: členové, kódy pozvánek, ekonomika, pauza.",
    icon: Network,
    minRole: "moderator",
    built: false,
    deliveryPhase: "Phase 3",
    group: "people",
  },

  // ---------- safety ----------
  {
    id: "moderation",
    labelEn: "Moderation",
    labelCs: "Moderace",
    descEn: "Reports queue, content hiding, warnings, blocklists, suspicious activity view.",
    descCs: "Fronta nahlášených, skrytí obsahu, varování, bloklisty, podezřelá aktivita.",
    icon: ShieldAlert,
    minRole: "moderator",
    built: false,
    deliveryPhase: "Phase 4",
    group: "safety",
  },

  // ---------- games ----------
  {
    id: "markets",
    labelEn: "Prediction markets",
    labelCs: "Sázkové trhy",
    descEn: "Create, edit, resolve, cancel/refund and delete markets; per-group availability.",
    descCs: "Tvorba, úpravy, vyhodnocení, zrušení s refundací a mazání trhů.",
    icon: BarChart3,
    minRole: "admin",
    built: false,
    deliveryPhase: "Phase 5",
    group: "games",
  },
  {
    id: "gigs",
    labelEn: "Gigs",
    labelCs: "Brigády",
    descEn: "Create gigs, review submissions, pay rewards through the ledger.",
    descCs: "Zakládání brigád, schvalování prací, automatická výplaty přes účetní knihu.",
    icon: ListChecks,
    minRole: "admin",
    built: false,
    deliveryPhase: "Phase 5",
    group: "games",
  },
  {
    id: "trivia",
    labelEn: "Daily trivia",
    labelCs: "Denní kvíz",
    descEn: "Question bank, difficulty, schedule and answer statistics.",
    descCs: "Banka otázek, obtížnost, rozvrh a statistiky odpovědí.",
    icon: Brain,
    minRole: "admin",
    built: false,
    deliveryPhase: "Phase 4+ (family games)",
    group: "games",
  },
  {
    id: "closest-guess",
    labelEn: "Closest guess",
    labelCs: "Nejbližší tip",
    descEn: "Guess-the-number-style rounds: create, resolve, payouts.",
    descCs: "Kol typu odhadni číslo: tvorba, vyhodnocení, výplaty.",
    icon: Target,
    minRole: "admin",
    built: false,
    deliveryPhase: "Phase 4+ (family games)",
    group: "games",
  },
  {
    id: "brackets",
    labelEn: "Bracket pools",
    labelCs: "Tipovačky pavouků",
    descEn: "Season-long prediction brackets with scoring rules and winners.",
    descCs: "Celosezónní tipování výsledků s pravidly bodování a výherci.",
    icon: Trophy,
    minRole: "admin",
    built: false,
    deliveryPhase: "Phase 4+ (family games)",
    group: "games",
  },
  {
    id: "quests",
    labelEn: "Family quests",
    labelCs: "Rodinné úkoly",
    descEn: "Real-life quests with photo/password proof and rewards.",
    descCs: "Úkoly ze skutečného života s důkazem a odměnami.",
    icon: Compass,
    minRole: "admin",
    built: false,
    deliveryPhase: "Phase 4+ (family games)",
    group: "games",
  },
  {
    id: "word-guess",
    labelEn: "Word & emoji guess",
    labelCs: "Slovní hádanky",
    descEn: "Word/emoji riddle rounds and their review queue.",
    descCs: "Slovní a emoji hádanky a jejich schvalování.",
    icon: MessageCircleQuestion,
    minRole: "admin",
    built: false,
    deliveryPhase: "Phase 4+ (family games)",
    group: "games",
  },
  {
    id: "photo-guess",
    labelEn: "Photo guess",
    labelCs: "Fotografie",
    descEn: "Upload review before publish, rounds, resolutions.",
    descCs: "Kontrola fotek před zveřejněním, kola, vyhodnocení.",
    icon: ImageIcon,
    minRole: "admin",
    built: false,
    deliveryPhase: "Phase 4+ (family games)",
    group: "games",
  },
  {
    id: "polls",
    labelEn: "Group polls",
    labelCs: "Hlasování skupiny",
    descEn: "Weekly group polls: create, close, payouts per group.",
    descCs: "Týdenní hlasování skupin: tvorba, uzavření, výplaty.",
    icon: Sparkles,
    minRole: "admin",
    built: false,
    deliveryPhase: "Phase 4+ (family games)",
    group: "games",
  },
];

// Sidebar grouping order. Headings are rendered CZ/EN by the sidebar itself.
export const ADMIN_GROUPS: { id: string; labelEn: string; labelCs: string }[] = [
  { id: "platform", labelEn: "Platform", labelCs: "Platforma" },
  { id: "money", labelEn: "Money", labelCs: "Finance" },
  { id: "people", labelEn: "People", labelCs: "Lidé" },
  { id: "safety", labelEn: "Safety", labelCs: "Bezpečnost" },
  { id: "games", labelEn: "Games", labelCs: "Hry a trhy" },
];

// Modules visible to a role, in sidebar order. Modules below the role's rank
// are filtered out server-side (permission not just hidden).
export function modulesForRole(role: Role): AdminModuleDef[] {
  const order = ADMIN_GROUPS.map((g) => g.id);
  return ADMIN_MODULES.filter((m) => {
    const rankMod = { user: 0, moderator: 1, admin: 2, owner: 3 }[m.minRole];
    const rankRole = { user: 0, moderator: 1, admin: 2, owner: 3 }[role];
    return rankRole >= rankMod;
  }).sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

export function moduleById(id: string): AdminModuleDef | undefined {
  return ADMIN_MODULES.find((m) => m.id === id);
}
