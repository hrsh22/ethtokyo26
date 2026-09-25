import { AppNav, Footer } from "@/components/app-nav";

export default function SpacesLayout({ children }: { children: React.ReactNode }) {
  return <div className="relative flex min-h-dvh flex-col overflow-x-clip">
    <div className="blob -left-40 -top-40 size-[440px] bg-[#FFD9C2] opacity-60" />
    <div className="blob -right-40 top-[40vh] size-[480px] bg-[#DCD2FF] opacity-70" />
    <AppNav />
    <main id="main" className="relative mx-auto w-full max-w-[1240px] flex-1 px-4 pt-8 sm:px-8">{children}</main>
    <Footer />
  </div>;
}
