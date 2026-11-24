import { CircleCheck, Zap } from "lucide-react";

interface Props { count: number; total: number; hotkeyEnabled: boolean; }

export function StatusBar({ count, total, hotkeyEnabled }: Props) {
  return <div className="status-bar"><span><CircleCheck size={13} /> GestureOS is ready</span><span>{count === total ? total : `${count} / ${total}`} windows</span><span className={hotkeyEnabled ? "hotkey-live" : "hotkey-off"}><Zap size={13} /> {hotkeyEnabled ? "Shortcut active" : "Shortcut off"}</span></div>;
}
