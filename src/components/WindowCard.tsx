import { AppWindow, CornerUpRight, Minimize2 } from "lucide-react";
import type { WindowInfo } from "../types";

interface Props { windowInfo: WindowInfo; selected: boolean; onSelect: () => void; onActivate: () => void; }

export function WindowCard({ windowInfo, selected, onSelect, onActivate }: Props) {
  return (
    <button className={`window-card${selected ? " selected" : ""}`} type="button" data-selected={selected} onMouseEnter={onSelect} onFocus={onSelect} onClick={onActivate}>
      <span className="window-app-icon"><AppWindow size={18} /></span>
      <span className="window-details"><span className="window-title">{windowInfo.title}</span><span className="window-subtitle">{windowInfo.isMinimized ? "Minimized" : "Open window"}</span></span>
      {windowInfo.isMinimized && <Minimize2 className="minimized-icon" size={14} />}
      <CornerUpRight className="activate-icon" size={15} />
    </button>
  );
}
