import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Riparr", template: "%s · Riparr" },
  description: "Watches link containers and downloads new content into your library",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/containers", label: "Containers" },
  { href: "/queue", label: "Queue" },
] as const;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-border bg-surface">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Rip<span className="text-accent">arr</span>
            </Link>
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-sm text-muted hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
