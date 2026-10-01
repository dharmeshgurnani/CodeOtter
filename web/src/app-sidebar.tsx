import { useEffect, useState } from "react";
import { BookOpen, ChevronRight, ChevronsUpDown, ExternalLink, FolderGit2, House, LogIn, LogOut, Plus, Settings2, ShieldCheck } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/animate-ui/components/radix/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/animate-ui/primitives/radix/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/components/radix/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { type User, forgeId, forgeLabel, repoLabel } from "./types";

type Page = { title: string; path: string };
type Props = {
  repositoriesLoaded?: boolean;
  forgeUrls?: Record<string, string>;
  repos: string[];
  route: string;
  openCounts: Record<string, number>;
  settingsPages: { id: string; title: string; group: "settings" | "admin" }[];
  org: string;
  setOrg: (o: string) => void;
  user: User | null;
  signInAvailable: boolean;
  onLogin: () => void;
  onLogout: () => void;
  go: (path: string) => void;
};

// Selected page link: accent text plus a bar over the sub-menu guide line, so it never looks like the category title above it.
const SUB_ACTIVE =
  "relative data-[active=true]:bg-transparent data-[active=true]:text-brand data-[active=true]:font-medium before:absolute before:-left-2.5 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-brand before:opacity-0 data-[active=true]:before:opacity-100";
const initials = (s: string) => s.split(/[\s/_-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

// One collapsible category with page links beneath it, wired exactly like the animate-ui demo (Collapsible + motion height).
function NavGroup({ title, icon: Icon, pages, route, go, badge, landing }: { title: string; icon: typeof Settings2; pages: Page[]; route: string; go: (p: string) => void; badge?: number; landing?: string }) {
  const active = pages.some((p) => route === p.path) || (landing ? route.startsWith(landing) : false);
  const [open, setOpen] = useState(active);
  useEffect(() => { if (active) setOpen(true); }, [active]);
  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={title} isActive={active} onClick={() => { if (!open && landing) go(landing); }}>
            <Icon />
            <span className="truncate">{title}</span>
            {badge ? <span className="ml-auto rounded-md bg-neutral-200 px-1.5 text-xs tabular-nums">{badge}</span> : null}
            <ChevronRight className={`${badge ? "" : "ml-auto"} transition-transform duration-300 group-data-[state=open]/collapsible:rotate-90`} />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {pages.map((p) => (
              <SidebarMenuSubItem key={p.path}>
                <SidebarMenuSubButton className={SUB_ACTIVE} isActive={route === p.path} href={p.path} onClick={(e) => { e.preventDefault(); go(p.path); }}>
                  <span>{p.title}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

// Header: the organization, as the demo's Team Switcher. Organizations are the owners of the onboarded repositories.
function OrgSwitcher({ repos, orgs, active, setActive, canAddRepo, go }: { repos: string[]; orgs: string[]; active: string; setActive: (o: string) => void; canAddRepo: boolean; go: (p: string) => void }) {
  const { isMobile } = useSidebar();
  const count = repos.filter((r) => r.startsWith(`${active}/`)).length;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              {active ? (
                <Avatar className="size-8 rounded-lg">
                  {!forgeId(active) && <AvatarImage src={`https://github.com/${active}.png?size=64`} alt={active} />}
                  <AvatarFallback className="rounded-lg bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">{initials(active)}</AvatarFallback>
                </Avatar>
              ) : (
                <img src="/codeotter-icon.svg" alt="CodeOtter" className="size-8 rounded-lg shadow-xs shrink-0" />
              )}
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{repoLabel(active) || "No organization"}</span>
                <span className="truncate text-xs">{active ? `Organization · ${count} ${count === 1 ? "repository" : "repositories"}` : "Add a repository to begin"}</span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg" align="start" side={isMobile ? "bottom" : "right"} sideOffset={4}>
            <DropdownMenuLabel className="text-xs text-muted-foreground">Organizations</DropdownMenuLabel>
            {orgs.map((o) => (
              <DropdownMenuItem key={o} onClick={() => { setActive(o); go("/"); }} className="gap-2 p-2">
                <Avatar className="size-6 rounded-sm">
                  {!forgeId(o) && <AvatarImage src={`https://github.com/${o}.png?size=48`} alt={o} />}
                  <AvatarFallback className="rounded-sm border text-[10px] font-semibold">{initials(o)}</AvatarFallback>
                </Avatar>
                {repoLabel(o)}
              </DropdownMenuItem>
            ))}
            {canAddRepo && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2 p-2" onClick={() => go("/settings/repos")}>
                  <div className="flex size-6 items-center justify-center rounded-md border bg-background"><Plus className="size-4" /></div>
                  <div className="font-medium text-muted-foreground">Add repository</div>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// Footer: the account, as the demo's NavUser. Signed out it is a single "Sign in" button in the same slot.
function NavUser({ user, signInAvailable, onLogin, onLogout }: { user: User | null; signInAvailable: boolean; onLogin: () => void; onLogout: () => void }) {
  const { isMobile } = useSidebar();
  if (!user) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" tooltip="Sign in" onClick={onLogin} disabled={!signInAvailable}>
            <Avatar className="h-8 w-8 rounded-lg"><AvatarFallback className="rounded-lg"><LogIn className="size-4" /></AvatarFallback></Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">Not signed in</span>
              <span className="truncate text-xs">{signInAvailable ? "Sign in" : "Sign-in unavailable"}</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }
  const Identity = () => (
    <>
      <Avatar className="h-8 w-8 rounded-lg">
        <AvatarImage src={user.avatar || undefined} alt={user.name} />
        <AvatarFallback className="rounded-lg">{initials(user.name)}</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-semibold">{user.name}</span>
        <span className="truncate text-xs">{[user.role, user.email].filter(Boolean).join(" \u00b7 ")}</span>
      </div>
    </>
  );
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <Identity />
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg" side={isMobile ? "bottom" : "right"} align="end" sideOffset={4}>
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm"><Identity /></div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout}><LogOut />Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar({ repositoriesLoaded = true, forgeUrls = {}, repos, route, openCounts, settingsPages, org, setOrg, user, signInAvailable, onLogin, onLogout, go: rawGo }: Props) {
  const { isMobile, setOpenMobile } = useSidebar();
  const go = (path: string) => {
    if (isMobile) setOpenMobile(false);
    rawGo(path);
  };
  const handleLogin = () => {
    if (isMobile) setOpenMobile(false);
    onLogin();
  };
  // Active organization (owned by App, scopes every page): drives which repositories are listed. Follows the route
  // when a page from another organization is opened (home links, direct URLs).
  const orgs = [...new Set(repos.map((r) => r.split("/")[0]))];
  const routeOrg = route.startsWith("/repo/") ? route.slice("/repo/".length).split("/")[0] : "";
  useEffect(() => {
    if (!repositoriesLoaded) return;
    if (routeOrg && orgs.includes(routeOrg) && routeOrg !== org) setOrg(routeOrg);
    else if (orgs.length && !orgs.includes(org)) setOrg(orgs[0]);
    else if (!orgs.length && org) setOrg("");
  }, [routeOrg, repos.join(","), repositoriesLoaded]);
  const visible = repos.filter((r) => r.startsWith(`${org}/`));
  const canAddRepo = settingsPages.some((p) => p.id === "repos");
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="CodeOtter" onClick={() => go("/")} className="hover:bg-sidebar-accent cursor-pointer">
              <img src="/codeotter-icon.svg" alt="CodeOtter" className="size-8 rounded-lg shadow-xs shrink-0" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold tracking-tight text-sidebar-foreground">CodeOtter</span>
                <span className="truncate text-xs text-muted-foreground">AI PR Review &amp; Merge Gates</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <OrgSwitcher repos={repos} orgs={orgs} active={org} setActive={setOrg} canAddRepo={canAddRepo} go={go} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Home" isActive={route === "/"} onClick={() => go("/")}>
                <House />
                <span>Home</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Repositories</SidebarGroupLabel>
          <SidebarMenu>
            {visible.map((r) => (
              <NavGroup
                key={r}
                title={repoLabel(r)}
                icon={FolderGit2}
                route={route}
                go={go}
                badge={openCounts[r]}
                landing={`/repo/${r}`}
                pages={[
                  { title: "Reviews", path: `/repo/${r}` },
                  { title: "Open pull requests", path: `/repo/${r}/open` },
                ]}
              />
            ))}
            {canAddRepo && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Add repository" className="text-muted-foreground" isActive={route === "/settings/repos"} onClick={() => go("/settings/repos")}>
                  <Plus />
                  <span>Add repository</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>
        {settingsPages.some((p) => p.group === "settings") && (
          <SidebarGroup>
            <SidebarGroupLabel>General</SidebarGroupLabel>
            <SidebarMenu>
              <NavGroup title="Settings" icon={Settings2} route={route} go={go} pages={settingsPages.filter((p) => p.group === "settings").map((p) => ({ title: p.title, path: `/settings/${p.id}` }))} />
            </SidebarMenu>
          </SidebarGroup>
        )}
        {/* Platform-wide pages, independent of the organization: shown to admins and owners everywhere */}
        {settingsPages.some((p) => p.group === "admin") && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarMenu>
              <NavGroup title="Admin" icon={ShieldCheck} route={route} go={go} pages={[...settingsPages.filter((p) => p.group === "admin").map((p) => ({ title: p.title, path: `/settings/${p.id}` })), { title: "Setup wizard", path: "/onboarding" }]} />
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={forgeLabel(org)}>
              <a href={forgeId(org) ? `${forgeUrls[forgeId(org)]}/${org.split("~")[1]}` : org ? `https://github.com/${org}` : "https://github.com"} target="_blank" rel="noreferrer">
                <ExternalLink />
                <span>{forgeLabel(org)}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Documentation">
              <a href="https://github.com/dharmeshgurnani/CodeOtter#readme" target="_blank" rel="noreferrer">
                <BookOpen />
                <span>Documentation</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser user={user} signInAvailable={signInAvailable} onLogin={handleLogin} onLogout={onLogout} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
