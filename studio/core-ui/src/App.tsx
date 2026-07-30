import { useCallback, useEffect, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { PortDragProvider } from "./state/portDragContext";
import { StudioShell } from "./components/StudioShell";
import { ProjectHome } from "./components/ProjectHome/ProjectHome";
import { NamePromptDialog } from "./components/NamePromptDialog";
import { useDesktopProject, type RecentProject } from "./hooks/useDesktopProject";
import { useDesktopMenuCommands } from "./hooks/useDesktopMenuCommands";
import { useEngineSidecar } from "./hooks/useEngineSidecar";
import { ReconnectBanner } from "./components/ReconnectBanner";
import { setApiBaseUrl } from "./api/client";
import type { TemplateDef } from "./data/templates";

export function App() {
  const desktopProject = useDesktopProject();
  const engineStatus = useEngineSidecar();

  // B-M2: the sidecar negotiates its own port (tries 8100, falls back to
  // whatever's free) — point the API client at it once known. No-op in the
  // browser: engineStatus never leaves "unknown" there (see the hook doc).
  useEffect(() => {
    if (engineStatus.status === "ready") setApiBaseUrl(`http://127.0.0.1:${engineStatus.port}`);
  }, [engineStatus]);

  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [initialTemplate, setInitialTemplate] = useState<TemplateDef | null | undefined>(undefined);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [namePromptOpen, setNamePromptOpen] = useState(false);
  const pendingTemplateRef = useRef<TemplateDef | null>(null);
  // Set right before opening the name prompt for the "Try the sample
  // project" card; handleConfirmProjectName checks this instead of the
  // template flag so the two first-run paths stay independent.
  const pendingSampleRef = useRef(false);

  const refreshRecents = useCallback(async () => {
    if (!desktopProject.available) return;
    setRecentProjects(await desktopProject.getRecentProjects());
  }, [desktopProject]);

  useEffect(() => {
    void refreshRecents();
  }, [refreshRecents]);

  const handleOpenProjectDialog = useCallback(async () => {
    const result = await desktopProject.openProjectDialog();
    if (result) {
      setInitialTemplate(undefined);
      setProjectDir(result.dir);
    }
  }, [desktopProject]);

  const handleOpenRecent = useCallback(
    async (path: string) => {
      const project = await desktopProject.openProjectAt(path);
      if (project) {
        setInitialTemplate(undefined);
        setProjectDir(path);
      } else {
        // stale entry (folder moved/deleted since last opened) — refresh, stay on home
        void refreshRecents();
      }
    },
    [desktopProject, refreshRecents],
  );

  const beginCreateProject = useCallback((template: TemplateDef | null) => {
    pendingSampleRef.current = false;
    pendingTemplateRef.current = template;
    setNamePromptOpen(true);
  }, []);

  const beginCreateSampleProject = useCallback(() => {
    pendingSampleRef.current = true;
    setNamePromptOpen(true);
  }, []);

  const handleConfirmProjectName = useCallback(
    async (name: string) => {
      setNamePromptOpen(false);
      if (pendingSampleRef.current) {
        pendingSampleRef.current = false;
        const dir = await desktopProject.createSampleProject(name);
        if (dir) {
          // initialTemplate stays undefined (not set to a TemplateDef):
          // StudioShell's reopen path (projectDir change with
          // initialTemplate === undefined) lists the two .ragsession files
          // createSampleProject just wrote and loads the first, same as
          // opening any existing project from disk.
          setInitialTemplate(undefined);
          setProjectDir(dir);
        }
        return;
      }
      const dir = await desktopProject.createProject(name);
      if (dir) {
        setInitialTemplate(pendingTemplateRef.current);
        setProjectDir(dir);
      }
    },
    [desktopProject],
  );

  // App-level only: project navigation happens above StudioShell, which may
  // not even be mounted yet (see useDesktopMenuCommands doc). The native
  // "New Project" menu item goes straight to the name prompt with no
  // template pre-selected — template choice is a home-screen-only
  // affordance for now.
  useDesktopMenuCommands({
    onNewProject: () => beginCreateProject(null),
    onOpenProject: () => void handleOpenProjectDialog(),
  });

  // available === null: isTauri() check hasn't resolved yet — render
  // nothing rather than flash the canvas then swap to the home screen.
  if (desktopProject.available === null) return null;

  if (desktopProject.available && !projectDir) {
    return (
      <>
        <ReconnectBanner status={engineStatus} />
        <ProjectHome
          recentProjects={recentProjects}
          onCreateProject={beginCreateProject}
          onCreateSampleProject={beginCreateSampleProject}
          onOpenProject={() => void handleOpenProjectDialog()}
          onOpenRecent={(path) => void handleOpenRecent(path)}
        />
        <NamePromptDialog
          open={namePromptOpen}
          title="New project"
          subtitle="Choose a folder name. You'll pick where to create it next."
          confirmLabel="Create"
          defaultName="untitled-project"
          onCancel={() => setNamePromptOpen(false)}
          onConfirm={(name) => void handleConfirmProjectName(name)}
        />
      </>
    );
  }

  return (
    <>
      <ReconnectBanner status={engineStatus} />
      <ReactFlowProvider>
        <PortDragProvider>
          <StudioShell
            projectDir={projectDir}
            initialTemplate={initialTemplate}
            engineReadySignal={engineStatus.status === "ready" ? engineStatus.port : null}
          />
        </PortDragProvider>
      </ReactFlowProvider>
    </>
  );
}
