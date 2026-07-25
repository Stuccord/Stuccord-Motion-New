import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useUser, useClerk, UserButton } from "@clerk/clerk-react";
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
  Settings,
  HelpCircle,
  LogOut,
  Menu,
  X,
  Plus,
  Search,
  ChevronDown,
  CreditCard,
  Bell,
  Command as CommandIcon,
  Gift,
} from "lucide-react";
import logoUrl from "@/assets/logo.png";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: string;
  icon: typeof Home;
  exact?: boolean;
  badge?: string;
};

const workspaceNav: NavItem[] = [
  { to: "/dashboard", label: "Home", icon: Home, exact: true },
  { to: "/projects", label: "Projects", icon: Film },
  { to: "/templates", label: "Templates", icon: Wand2, badge: "New" },
  { to: "/assets", label: "Assets", icon: FolderOpen },
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
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const fetchStats = useServerFn(getUsageStats);
  const { data: usage } = useQuery({
    queryKey: ["usage-stats"],
    queryFn: () => fetchStats(),
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
    await signOut();
    router.invalidate();
    navigate({ to: "/auth", search: { next: undefined }, replace: true });
  }

  const userEmail = user?.primaryEmailAddress?.emailAddress ?? (import.meta.env.DEV ? "dev-user@example.com" : null);
  const displayName = user?.fullName || user?.firstName || (userEmail ? userEmail.split("@")[0] : "Guest");
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
          "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all duration-150",
          active
            ? "bg-primary/10 text-primary font-semibold"
            : "text-muted-foreground hover:text-foreground hover:bg-surface",
        )}
      >
        <Icon className={cn("w-4 h-4 shrink-0 transition-colors", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
        <span className="truncate">{item.label}</span>
        {item.badge && (
          <span className={cn(
            "ml-auto text-[9px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wider",
            active ? "bg-primary/20 text-primary" : "bg-surface-2 text-muted-foreground",
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
        <Link to="/dashboard" className="flex items-center gap-2 min-w-0">
          <img
            src={logoUrl}
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 shrink-0 object-contain"
          />
          <span className="font-display text-[15px] font-semibold tracking-tight truncate text-foreground">
            Stuccord <span className="text-primary">Motion</span>
          </span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <div>
          <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            Workspace
          </div>
          <ul className="space-y-0.5">
            {workspaceNav.map((item) => (
              <li key={item.to}><NavLink item={item} /></li>
            ))}
          </ul>
        </div>

        <div>
          <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            Account
          </div>
          <ul className="space-y-0.5">
            {accountNav.map((item) => (
              <li key={item.to}><NavLink item={item} /></li>
            ))}
          </ul>
        </div>

        <div className="mx-1 relative overflow-hidden rounded-xl border border-primary/20 bg-card p-3.5 shadow-sm">
          <div className="relative">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
              <Gift className="w-3 h-3" /> Starter plan
            </div>
            <div className="mt-2 text-xs text-foreground leading-relaxed">
              <span className="font-semibold tabular-nums">{used} of {cap}</span> renders used this month
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-surface overflow-hidden border border-border">
              <div className="h-full bg-primary transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ width: `${usePct}%` }} />
            </div>
            <Button
              size="sm"
              className="w-full mt-3 h-8 text-xs bg-primary hover:bg-primary/90 text-primary-foreground border-0 shadow-sm"
              onClick={() => navigate({ to: "/billing" })}
            >
              Upgrade to Pro
            </Button>
          </div>
        </div>
      </nav>

      <div className="border-t border-border p-3">
        <button
          onClick={() => (isSignedIn ? navigate({ to: "/settings" }) : navigate({ to: "/auth", search: { next: undefined } }))}
          className="flex w-full items-center gap-2.5 rounded-lg p-2 hover:bg-surface transition-colors text-left"
        >
          {user?.imageUrl ? (
            <img src={user.imageUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 border border-border" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold grid place-items-center shrink-0 shadow-sm">
              {initials}
            </div>
          )}
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
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 border-r border-border bg-card/80 backdrop-blur-xl z-30">
        {SidebarInner}
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-card border-r border-border shadow-xl">
            {SidebarInner}
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur-xl">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button
              className="lg:hidden p-2 -ml-2 rounded-md hover:bg-surface text-foreground"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle navigation"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <div className="hidden md:flex items-center gap-2 flex-1 max-w-md">
              <div className="relative w-full">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="search"
                  placeholder="Search projects, templates, assets…"
                  className="w-full h-9 pl-8 pr-16 text-[13px] bg-surface border border-border rounded-lg focus:bg-card focus:border-primary/50 focus:outline-none transition-all"
                />
                <div className="hidden lg:flex absolute right-2 top-1/2 -translate-y-1/2 items-center gap-0.5 text-[10px] text-muted-foreground font-mono">
                  <kbd className="px-1.5 py-0.5 border border-border rounded bg-card"><CommandIcon className="w-2.5 h-2.5 inline" /></kbd>
                  <kbd className="px-1.5 py-0.5 border border-border rounded bg-card">K</kbd>
                </div>
              </div>
            </div>

            <div className="flex-1 md:hidden" />

            <div className="flex items-center gap-2">
              <button className="p-2 rounded-lg hover:bg-surface relative text-muted-foreground hover:text-foreground transition-colors" aria-label="Notifications">
                <Bell className="w-4 h-4" />
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-primary" />
              </button>
              <Button
                size="sm"
                onClick={() => navigate({ to: "/projects/new" })}
                className="hidden sm:inline-flex"
              >
                <Plus className="w-4 h-4" /> New project
              </Button>

              {isSignedIn ? (
                <UserButton afterSignOutUrl="/auth" />
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 p-1 pr-2 rounded-full hover:bg-surface">
                      <div className="w-7 h-7 rounded-full bg-foreground text-background text-[11px] font-semibold grid place-items-center">
                        {initials}
                      </div>
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground hidden sm:block" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="font-normal">
                      <div className="text-xs text-muted-foreground">Signed in as</div>
                      <div className="text-sm font-medium truncate text-foreground">{userEmail ?? "Guest"}</div>
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
              )}
            </div>
          </div>

          {(title || actions || eyebrow) && (
            <div className="px-4 sm:px-6 pb-5 pt-1 flex items-end justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
                {title && (
                  <h1 className="font-display text-[26px] sm:text-[30px] leading-[1.1] font-semibold tracking-[-0.02em] text-foreground truncate">
                    {title}
                  </h1>
                )}
                {subtitle && (
                  <p className="text-[13px] text-muted-foreground mt-1.5 max-w-2xl">{subtitle}</p>
                )}
              </div>
              {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>
          )}
        </header>

        <main className="px-4 sm:px-6 py-6 max-w-[1400px] mx-auto">{children}</main>
      </div>
    </div>
  );
}
