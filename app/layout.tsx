import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { LogoMark } from "@/components/logo";
import { IntroVideo, TrailerLink } from "@/components/intro-video";
import { getLang } from "@/lib/lang-server";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  metadataBase: new URL("https://monobet.tdvorak.dev"),
  title: { default: "MonoPredict — Platforma pro kolektivní prognózování", template: "MonoPredict — %s" },
  description: "MonoPredict — Platforma pro kolektivní prognózování",
  openGraph: {
    siteName: "MonoPredict",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f9d58",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [lang, user] = await Promise.all([getLang(), getCurrentUser()]);
  const t = getT(lang);
  return (
    <html lang="cs" className={inter.variable} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('mm-theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-dvh flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line mt-16">
          <div className="mx-auto max-w-6xl px-4 py-10">
            <div className="flex flex-col sm:flex-row items-start justify-between gap-8">
              <div className="max-w-xs">
                <div className="flex items-center gap-2">
                  <LogoMark className="size-6" />
                  <span className="font-bold text-[15px] tracking-tight">MonoPredict</span>
                </div>
                <p className="mt-3 text-[13px] text-mute leading-relaxed">
                  {t.tagline}
                </p>
              </div>
              <nav className="grid grid-cols-2 gap-x-16 gap-y-2 text-[13px] font-medium">
                <Link href="/" className="text-mute hover:text-ink transition-colors">{t.markets}</Link>
                <Link href="/leaderboard" className="text-mute hover:text-ink transition-colors">{t.leaderboard}</Link>
                <Link href="/propose" className="text-mute hover:text-ink transition-colors">{t.newMarket}</Link>
                <Link href="/portfolio" className="text-mute hover:text-ink transition-colors">{t.portfolio}</Link>
                <Link href="/terms" className="text-mute hover:text-ink transition-colors">{t.terms}</Link>
                <TrailerLink lang={lang} />
              </nav>
            </div>
            <p className="mt-8 pt-5 border-t border-line-2 text-[12px] text-faint leading-relaxed max-w-3xl">
              {t.legalNotice}
            </p>
            <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-[12px] text-faint">
              <p>{t.playMoneyDisclaimer}</p>
              <a
                href="https://github.com/Dvorinka/monobet"
                className="inline-flex items-center gap-1.5 hover:text-ink transition-colors"
                target="_blank"
                rel="noreferrer"
              >
                <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden>
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                </svg>
                {t.openSource}
              </a>
            </div>
          </div>
        </footer>
        <IntroVideo lang={lang} autoplay={!user} />
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              fontFamily: "var(--font-sans)",
              background: "var(--color-surface)",
              color: "var(--color-ink)",
              border: "1px solid var(--color-line)",
            },
          }}
        />
      </body>
    </html>
  );
}
