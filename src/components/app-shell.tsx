import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getUsageStats } from "@/lib/projects.functions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Home,
  Film,
  Sparkles,
  Wand2,
  FolderOpen,
  BarChart3,
  Send,
  Settings,
  HelpCircle,
  LogOut,
  Plus,
  PanelLeft,
  Gem,
  Search,
  ChevronDown,
  CreditCard,
  Gift,
} from "lucide-react";
import logoUrl from "@/assets/logo.png";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { useWorkspace } from "@/lib/use-workspace";
import { NotificationsBell } from "@/components/notifications-bell";
import { GlobalSearch, openGlobalSearch } from "@/components/global-search";
import { cn } from "@/lib/utils";
import { isUnlimited } from "@/lib/plans";

type NavItem = {
  to: string;
  label: string;
  icon: typeof Home;
  exact?: boolean;
  badge?: string;
};

const workspaceNav: NavItem[] = [
  { to: "/dashboard", label: "Explore", icon: Home, exact: true },
  { to: "/projects", label: "Library", icon: Film },
  { to: "/templates", label: "Presets", icon: Wand2, badge: "New" },
  { to: "/assets", label: "Assets", icon: FolderOpen },
  { to: "/publishing", label: "Publishing", icon: Send },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
];

const accountNav: NavItem[] = [
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/billing", label: "Billing", icon: CreditCard },
  { to: "/help", label: "Help & docs", icon: HelpCircle },
];

export function AppShell({
  children,
  title,
  subtitle,
  actions,
  eyebrow,
  barTitle,
}: {
  children: ReactNode;
  /** The page's name in the top bar on phones and tablets, when it has no title (Home). */
  barTitle?: string;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<{ email?: string; user_metadata?: { full_name?: string } } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUser(data.user);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // New project has its own bottom bar (Cancel / Make my video).
  const hideTabBar = pathname === "/projects/new";
  const fetchStats = useServerFn(getUsageStats);
  // The allowance of the workspace you're in (a team's is shared by its members).
  const ws = useWorkspace();
  const { data: usage } = useQuery({
    queryKey: ["usage-stats", ws.id],
    queryFn: () => fetchStats({ data: { workspace: ws.id } }),
    staleTime: 30_000,
  });
  const used = usage?.rendersThisMonth ?? 0;
  const cap = usage?.renderCap ?? 5;
  const usePct = Math.min(100, Math.round((used / cap) * 100));

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/auth", search: { next: undefined }, replace: true });
  }

  const userEmail = user?.email ?? null;
  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? null;
  const displayName = fullName || (userEmail ? userEmail.split("@")[0] : "Creator");
  const initials = displayName.slice(0, 2).toUpperCase();

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + "/");

  const NavLink = ({ item }: { item: NavItem }) => {
    const Icon = item.icon;
    const active = isActive(item);
    return (
      <Link
        to={item.to}
        className={cn(
          // Phones and tablets (the More menu): Higgsfield's rows, 44 px, 20 px
          // icons, 16 px labels. Computers: the compact sidebar.
          "group relative flex items-center gap-2.5 rounded-[10px] lg:rounded-lg h-11 lg:h-auto px-2.5 lg:py-2 text-[16px] leading-5 lg:text-[13px] lg:leading-normal font-medium transition-all duration-150",
          active
            ? "bg-white/[0.07] text-foreground font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
        )}
      >
        <Icon className={cn("w-5 h-5 lg:w-4 lg:h-4 shrink-0 transition-colors", active ? "text-primary-glow" : "text-muted-foreground group-hover:text-foreground")} />
        <span className="truncate">{item.label}</span>
        {item.badge && (
          <span className={cn(
            "ml-auto text-[9px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wider",
            active ? "bg-primary text-primary-foreground" : "bg-white/10 text-foreground/80",
          )}>
            {item.badge}
          </span>
        )}
      </Link>
    );
  };

  const SidebarInner = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-4 border-b border-border">
        <Link to="/dashboard" className="flex items-center gap-2 min-w-0 flex-1">
          <img
            src={logoUrl}
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 shrink-0 object-contain rounded-lg bg-white p-px"
          />
          <span className="font-display text-[15px] font-bold tracking-tight truncate text-foreground">
            Stuccord <span className="text-foreground/60">Motion</span>
          </span>
        </Link>
        {/* Phones and tablets: close it with the same icon that opened it. */}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-surface hover:text-foreground"
          aria-label="Close menu"
        >
          <PanelLeft className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {/* The More menu's first row, like Higgsfield's "Create". */}
        <div className="lg:hidden space-y-2">
        <button
          type="button"
          onClick={() => {
            setMobileOpen(false);
            openGlobalSearch();
          }}
          className="lg:hidden flex h-11 w-full items-center gap-2.5 rounded-[10px] bg-surface px-3 text-[16px] leading-5 text-muted-foreground"
        >
          <Search className="h-5 w-5" /> Search
        </button>
        <Link
          to="/projects/new"
          className="lg:hidden flex h-11 items-center gap-2.5 rounded-[10px] border border-white/10 bg-white/[0.06] px-2.5 text-[16px] font-semibold leading-5 text-foreground"
        >
          <Plus className="w-5 h-5" /> Create
        </Link>
        </div>
        <div>
          <div className="px-2 pb-2 font-display text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">
            Workspace
          </div>
          <div className="px-1 pb-2">
            <WorkspaceSwitcher />
          </div>
          <ul className="space-y-0.5">
            {workspaceNav.map((item) => (
              <li key={item.to}><NavLink item={item} /></li>
            ))}
          </ul>
        </div>

        <div>
          <div className="px-2 pb-2 font-display text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">
            Account
          </div>
          <ul className="space-y-0.5">
            {accountNav.map((item) => (
              <li key={item.to}><NavLink item={item} /></li>
            ))}
          </ul>
        </div>

        <div className="mx-1 relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
          <div className="relative">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/70">
              <Gift className="w-3 h-3" /> {usage?.allowance.plan ?? "Free"} plan
            </div>
            <div className="mt-2 text-xs text-foreground leading-relaxed">
              {isUnlimited(cap) ? (
                <>
                  <span className="block font-semibold">No limit</span>
                  <span className="block text-muted-foreground">
                    <span className="tabular-nums">{used}</span>{" "}
                    {ws.team ? `${ws.team.name} exports` : "exports"} this month
                  </span>
                </>
              ) : (
                <>
                  <span className="font-semibold tabular-nums">{used} of {cap}</span>{" "}
                  {ws.team ? `${ws.team.name} exports` : "exports"} used this month
                </>
              )}
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-primary transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ width: `${usePct}%` }} />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full mt-3 h-8 text-xs"
              onClick={() => navigate({ to: "/billing" })}
            >
              Plan &amp; usage
            </Button>
          </div>
        </div>
      </nav>

      {/* Your account: here at the bottom of the menu (where Higgsfield keeps it on
          phones; computers also have it at the top-right). */}
      <div className="border-t border-border p-3 space-y-1">
        {user && (
          <button
            type="button"
            onClick={handleSignOut}
            className="lg:hidden flex h-11 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-[16px] font-medium leading-5 text-destructive hover:bg-surface"
          >
            <LogOut className="h-5 w-5" /> Sign out
          </button>
        )}
        <button
          onClick={() => (!!user ? navigate({ to: "/settings" }) : navigate({ to: "/auth", search: { next: undefined } }))}
          className="flex w-full items-center gap-2.5 rounded-lg p-2 hover:bg-surface transition-colors text-left"
        >
          <div className="w-8 h-8 rounded-full bg-white/10 text-foreground text-[11px] font-semibold grid place-items-center shrink-0 shadow-sm">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium truncate text-foreground">{displayName}</div>
            <div className="text-[10px] text-muted-foreground truncate">{userEmail ?? ""}</div>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 border-r border-border bg-[oklch(0.135_0.004_275)] z-30">
        {SidebarInner}
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[327px] max-w-[87vw] bg-[oklch(0.135_0.004_275)] border-r border-border shadow-2xl">
            {SidebarInner}
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-border bg-background/75 backdrop-blur-xl">
          <div className="relative flex h-14 items-center gap-3 px-4 sm:px-6">
            {/* Phones and tablets: the page's name in the middle of the bar (Higgsfield's way). */}
            {(title ?? barTitle) && (
              <div
                className="lg:hidden pointer-events-none absolute inset-x-0 top-0 flex h-14 items-center justify-center"
                aria-hidden
              >
                <span className="max-w-[48%] truncate text-[16px] font-medium leading-5 text-foreground">
                  {title ?? barTitle}
                </span>
              </div>
            )}
            {/* Phones and tablets: the menu opens from here, top-left (where Higgsfield has it). */}
            <button
              type="button"
              className="lg:hidden relative z-10 -ml-1.5 grid h-9 w-9 place-items-center rounded-lg text-foreground hover:bg-surface"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Menu"
              aria-expanded={mobileOpen}
            >
              <PanelLeft className="h-5 w-5" />
            </button>

            <div className="relative z-10 flex md:flex-1 items-center md:max-w-md max-lg:order-2 max-lg:md:flex-none max-lg:[&>button]:hidden">
              <GlobalSearch />
            </div>

            <div className="flex-1 max-lg:order-1" />

            <div className="relative z-10 flex items-center gap-2 max-lg:order-3">
              <NotificationsBell />
              {/* Phones and tablets: one bright pill, like Higgsfield's "Upgrade"
                  before you subscribe. Not for accounts without limits. */}
              {usage && !isUnlimited(cap) && (
                <Link
                  to="/billing"
                  className="lg:hidden inline-flex h-7 items-center gap-1.5 rounded-full bg-primary px-3 text-[12px] font-medium leading-4 text-primary-foreground shadow-[0_6px_18px_-6px_color-mix(in_oklab,var(--color-primary)_70%,transparent)]"
                  data-upgrade-pill
                >
                  <Gem className="h-3.5 w-3.5" /> Upgrade
                </Link>
              )}
              <Button
                size="sm"
                onClick={() => navigate({ to: "/projects/new" })}
                className="hidden sm:inline-flex"
              >
                <Plus className="w-4 h-4" /> Create
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="max-lg:hidden flex items-center gap-2 p-1 pr-2 rounded-full hover:bg-surface cursor-pointer">
                    <div className="w-7 h-7 rounded-full bg-white/10 text-foreground text-[11px] font-semibold grid place-items-center">
                      {initials}
                    </div>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground hidden sm:block" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="text-xs text-muted-foreground">Signed in as</div>
                    <div className="text-sm font-medium truncate text-foreground">{userEmail ?? "Creator"}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate({ to: "/settings" })}>
                    <Settings className="w-4 h-4 mr-2" /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate({ to: "/billing" })}>
                    <CreditCard className="w-4 h-4 mr-2" /> Billing
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate({ to: "/help" })}>
                    <HelpCircle className="w-4 h-4 mr-2" /> Help
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                    <LogOut className="w-4 h-4 mr-2" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {(title || subtitle || actions || eyebrow) && (
            <div
              className={cn(
                "px-4 sm:px-6 pb-4 lg:pb-5 pt-1 flex items-end justify-between gap-4 flex-wrap",
                // Below lg the name is in the bar: nothing left to show here without these.
                !subtitle && !actions && !eyebrow && "max-lg:hidden",
              )}
            >
              <div className="min-w-0">
                {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
                {title && (
                  <h1 className="max-lg:sr-only font-display text-[32px] leading-[1.1] font-bold tracking-[-0.03em] text-foreground text-balance break-words">
                    {title}
                  </h1>
                )}
                {subtitle && (
                  <p className="text-[14px] leading-5 lg:text-[13px] lg:leading-normal text-muted-foreground lg:mt-1.5 max-w-2xl">
                    {subtitle}
                  </p>
                )}
              </div>
              {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>
          )}
        </header>

        <main
          className={cn(
            "px-4 sm:px-6 py-6 max-w-[1400px] mx-auto",
            // Room for the tab bar below (and the phone's home bar).
            !hideTabBar && "pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-6",
          )}
        >
          {children}
        </main>
      </div>

      {!hideTabBar && (
        <MobileTabBar
          isActive={(to, exact) =>
            exact ? pathname === to : pathname === to || pathname.startsWith(to + "/")
          }
        />
      )}
    </div>
  );
}

/**
 * Phones and tablets: the main pages along the bottom (Higgsfield's words), with "Create"
 * as the big button in the middle and Assets last (Higgsfield's My Assets);
 * the full menu opens from the top-left, with your account at its bottom.
 */
function MobileTabBar({
  isActive,
}: {
  isActive: (to: string, exact?: boolean) => boolean;
}) {
  const tab = (active: boolean) =>
    cn(
      "flex flex-1 flex-col items-center justify-center gap-1 py-1.5 text-[12px] leading-4 transition-colors",
      active ? "text-foreground font-semibold" : "text-muted-foreground font-medium hover:text-foreground",
    );
  const icon = (active: boolean) => cn("w-[22px] h-[22px]", active && "text-primary-glow");
  const before = [
    { to: "/dashboard", label: "Explore", Icon: Home, exact: true },
    { to: "/projects", label: "Library", Icon: Film },
  ];
  const after = [
    { to: "/templates", label: "Presets", Icon: Wand2 },
    { to: "/assets", label: "Assets", Icon: FolderOpen },
  ];
  const link = ({ to, label, Icon, exact }: (typeof before)[number] & { exact?: boolean }) => {
    const active = isActive(to, exact) && !isActive("/projects/new");
    return (
      <Link key={to} to={to} className={tab(active)} aria-current={active ? "page" : undefined}>
        <Icon className={icon(active)} />
        {label}
      </Link>
    );
  };
  return (
    <nav
      className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
      aria-label="Main"
      data-tab-bar
    >
      <div className="mx-auto flex h-[68px] max-w-lg items-center px-2">
        {before.map(link)}
        <div className="flex flex-1 justify-center">
          <Link
            to="/projects/new"
            aria-label="Create"
            className="flex h-[46px] w-[76px] items-center justify-center rounded-[14px] bg-primary text-primary-foreground shadow-[0_8px_24px_-6px_color-mix(in_oklab,var(--color-primary)_70%,transparent)] active:scale-95 transition-transform"
          >
            <Sparkles className="w-6 h-6" />
          </Link>
        </div>
        {after.map(link)}
      </div>
    </nav>
  );
}
