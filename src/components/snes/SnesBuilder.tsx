import { useCallback, useEffect, useRef, useState } from "react";
import { createDefaultProject } from "@utils/snes/defaults";
import { buildRom, romFilename } from "@utils/snes/rom";
import {
  clearSavedProject,
  downloadBlob,
  loadProject,
  normalizeProject,
  saveProject,
} from "@utils/snes/storage";
import type { GameProject } from "@utils/snes/types";
import LevelPanel from "./LevelPanel";
import PalettePanel from "./PalettePanel";
import PlayPanel from "./PlayPanel";
import SettingsPanel from "./SettingsPanel";
import SpritesPanel from "./SpritesPanel";
import TilesPanel from "./TilesPanel";

const TABS = [
  ["play", "Play"],
  ["level", "Level"],
  ["tiles", "Tiles"],
  ["sprites", "Sprites"],
  ["palettes", "Palettes"],
  ["settings", "Settings"],
] as const;

type Tab = (typeof TABS)[number][0];

interface Status {
  kind: "info" | "error";
  message: string;
}

export default function SnesBuilder() {
  const [project, setProject] = useState<GameProject | null>(null);
  const [tab, setTab] = useState<Tab>("play");
  const [selectedTile, setSelectedTile] = useState(1);
  const [selectedSprite, setSelectedSprite] = useState(0);
  const [status, setStatus] = useState<Status | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load after mount so server rendering and hydration agree.
  useEffect(() => {
    setProject(loadProject());
  }, []);

  useEffect(() => {
    if (!project) return;
    const timer = setTimeout(() => saveProject(project), 400);
    return () => clearTimeout(timer);
  }, [project]);

  const update = useCallback((next: GameProject) => {
    setProject(next);
    setStatus(null);
  }, []);

  const exportRom = useCallback(() => {
    if (!project) return;
    try {
      const { rom, codeSize } = buildRom(project);
      downloadBlob(rom, romFilename(project.title), "application/octet-stream");
      setStatus({
        kind: "info",
        message: `Exported ${(rom.length / 1024) | 0} KiB ROM (${codeSize} bytes of engine code). Open it in any SNES emulator.`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `Export failed: ${(error as Error).message}`,
      });
    }
  }, [project]);

  const exportJson = useCallback(() => {
    if (!project) return;
    const name = romFilename(project.title).replace(/\.sfc$/, ".json");
    downloadBlob(JSON.stringify(project), name, "application/json");
    setStatus({ kind: "info", message: `Saved ${name}.` });
  }, [project]);

  const importJson = useCallback(async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      setProject(normalizeProject(parsed));
      setStatus({ kind: "info", message: `Loaded ${file.name}.` });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `Could not read that file: ${(error as Error).message}`,
      });
    }
  }, []);

  if (!project) {
    return (
      <p className="py-16 text-center text-sm opacity-60">Loading builder…</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-skin-line pb-3">
        <nav className="flex flex-wrap gap-1">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded px-3 py-1.5 text-sm ${
                tab === id
                  ? "bg-skin-accent text-skin-inverted"
                  : "hover:bg-skin-card"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportRom}
            className="rounded bg-skin-accent px-4 py-1.5 text-sm font-semibold text-skin-inverted"
          >
            Export .sfc
          </button>
          <button
            type="button"
            onClick={exportJson}
            className="rounded border border-skin-line px-3 py-1.5 text-sm hover:bg-skin-card"
          >
            Save project
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded border border-skin-line px-3 py-1.5 text-sm hover:bg-skin-card"
          >
            Load project
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                !confirm(
                  "Discard your game and start again from the demo project?"
                )
              )
                return;
              clearSavedProject();
              setProject(createDefaultProject());
              setStatus({
                kind: "info",
                message: "Reset to the demo project.",
              });
            }}
            className="rounded border border-skin-line px-3 py-1.5 text-sm hover:bg-skin-card"
          >
            Reset
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) void importJson(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {status && (
        <p
          role="status"
          className={`rounded border px-3 py-2 text-sm ${
            status.kind === "error"
              ? "border-red-500/60 text-red-500"
              : "border-skin-line opacity-80"
          }`}
        >
          {status.message}
        </p>
      )}

      {tab === "play" && <PlayPanel project={project} />}
      {tab === "level" && (
        <LevelPanel
          project={project}
          onChange={update}
          selectedTile={selectedTile}
          onSelectTile={setSelectedTile}
        />
      )}
      {tab === "tiles" && (
        <TilesPanel
          project={project}
          onChange={update}
          selected={selectedTile}
          onSelect={setSelectedTile}
        />
      )}
      {tab === "sprites" && (
        <SpritesPanel
          project={project}
          onChange={update}
          selected={selectedSprite}
          onSelect={setSelectedSprite}
        />
      )}
      {tab === "palettes" && (
        <PalettePanel project={project} onChange={update} />
      )}
      {tab === "settings" && (
        <SettingsPanel project={project} onChange={update} />
      )}
    </div>
  );
}
