import { LayoutDashboard, Layers, FileText, CalendarDays, Image as ImageIcon, BarChart3, Bot, Settings } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, phase: 1 },
  { href: "/paginas", label: "Páginas", icon: Layers, phase: 1 },
  { href: "/contenidos", label: "Contenidos", icon: FileText, phase: 1 },
  { href: "/multimedia", label: "Multimedia", icon: ImageIcon, phase: 1 },
  { href: "/calendario", label: "Calendario", icon: CalendarDays, phase: 1 },
  { href: "/automatizacion", label: "Automatización", icon: Bot, phase: 1 },
  { href: "/analiticas", label: "Analíticas", icon: BarChart3, phase: 6 },
  { href: "/configuracion", label: "Configuración", icon: Settings, phase: 1 },
] as const;
