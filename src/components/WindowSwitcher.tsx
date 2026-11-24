import { useEffect, useRef } from "react";
import { AppWindow, MonitorX } from "lucide-react";
import type { WindowInfo } from "../types";
import { WindowCard } from "./WindowCard";

interface Props {
  windows: WindowInfo[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onActivate: (windowInfo: WindowInfo) => void;
  onEscape: () => void;
}

export function WindowSwitcher({ windows, selectedIndex, onSelect, onActivate, onEscape }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onEscape(); }
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (windows.length) onSelect((selectedIndex + (event.key === "ArrowDown" ? 1 : -1) + windows.length) % windows.length);
      }
      if (event.key === "Enter" && windows[selectedIndex]) {
        event.preventDefault();
        onActivate(windows[selectedIndex]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onActivate, onEscape, onSelect, selectedIndex, windows]);

  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>("[data-selected='true']");
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <section className="windows-section" aria-label="Open windows">
      <div className="section-heading"><span>AVAILABLE WINDOWS</span><span className="window-count">{windows.length}</span></div>
      <div className="window-list" ref={listRef}>
        {windows.map((item, index) => <WindowCard key={item.id} windowInfo={item} selected={index === selectedIndex} onSelect={() => onSelect(index)} onActivate={() => onActivate(item)} />)}
        {windows.length === 0 && <div className="empty-state"><div className="empty-icon">{listRef.current ? <MonitorX size={22} /> : <AppWindow size={22} />}</div><strong>No windows found</strong><span>Open a desktop app, then refresh the list.</span></div>}
      </div>
    </section>
  );
}
