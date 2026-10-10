/** Signed-out pages: the logo above a centred card, on the app canvas (both themes via tokens). */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10"
      style={{ paddingTop: "max(2.5rem, env(safe-area-inset-top))", paddingBottom: "max(2.5rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex w-full max-w-[400px] flex-col gap-6">
        <div className="flex items-center justify-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG brand mark */}
          <img src="/logo-mark.svg" alt="" width={44} height={44} className="size-11" />
          <span className="font-display text-[34px] leading-none text-fg">Riparr</span>
        </div>
        {children}
      </div>
    </div>
  );
}
