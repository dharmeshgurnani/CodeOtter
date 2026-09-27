import { BookOpen, ExternalLink, GitPullRequest, LayoutGrid, Settings2 } from "lucide-react";
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
} from "@/components/animate-ui/components/radix/sidebar";

type Props = { repo: string; route: string; openCount: number; go: (path: string) => void };

export function AppSidebar({ repo, route, openCount, go }: Props) {
  const [owner] = repo.split("/");
  const link = (path: string) => ({ isActive: route === path, onClick: () => go(path) });
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip={repo} {...link("/")}>
              <span className="size-7 rounded-full bg-gradient-to-br from-amber-400 to-brand" />
              <span className="font-semibold truncate">{owner}</span>
              <span className="ml-auto rounded-md bg-neutral-200 px-2 text-xs text-neutral-700 group-data-[collapsible=icon]:hidden">Local</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>General</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Reviews" isActive={route === "/" || route.startsWith("/review")} onClick={() => go("/")}>
                <LayoutGrid />
                <span>Reviews</span>
              </SidebarMenuButton>
              <SidebarMenuSub>
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton {...link("/")}>Reviewed</SidebarMenuSubButton>
                </SidebarMenuSubItem>
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton {...link("/open")}>Open pull requests</SidebarMenuSubButton>
                </SidebarMenuSubItem>
              </SidebarMenuSub>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Open pull requests" {...link("/open")}>
                <GitPullRequest />
                <span>Open pull requests</span>
                {openCount > 0 && <span className="ml-auto rounded-md bg-neutral-200 px-1.5 text-xs tabular-nums">{openCount}</span>}
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Settings" {...link("/settings")}>
                <Settings2 />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="GitHub">
              <a href={`https://github.com/${repo}/pulls`} target="_blank" rel="noreferrer">
                <ExternalLink />
                <span>GitHub</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Documentation">
              <a href="https://github.com/dharmeshgurnani/pr-scorer#readme" target="_blank" rel="noreferrer">
                <BookOpen />
                <span>Documentation</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
