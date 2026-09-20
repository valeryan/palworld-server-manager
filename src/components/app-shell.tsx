"use client";
import Link from "next/link";
import type { ReactNode } from "react";

export function AppShell({ active, children, className = "" }: { active: "worlds" | "operations" | "settings"; children: ReactNode; className?: string }) {
  return <div className="app-shell"><aside className="sidebar"><Link className="brand" href="/"><span className="brand-mark">P</span><div><strong>Palworld</strong><small>Server Manager</small></div></Link><nav><Link className={active === "worlds" ? "active" : ""} href="/">Worlds</Link><Link className={active === "operations" ? "active" : ""} href="/operations">Operations</Link><Link className={active === "settings" ? "active" : ""} href="/settings">Settings</Link></nav><div className="sidebar-foot"><span className="pulse" />Local manager online<small>Core-first alpha</small></div></aside><main className={`workspace ${className}`}>{children}</main></div>;
}
