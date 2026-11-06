import type { Metadata } from "next";
import { Factory, Layers, CalendarClock, LineChart } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

const features = [
  { icon: Layers, text: "Todas tus páginas en un solo panel" },
  { icon: CalendarClock, text: "Calendario editorial y publicación programada" },
  { icon: LineChart, text: "Analítica y optimización con IA" },
];

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -left-24 -top-24 size-96 rounded-full bg-indigo-600/30 blur-3xl" />
        <div className="absolute -bottom-32 -right-20 size-[28rem] rounded-full bg-violet-600/25 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30">
            <Factory className="size-5 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Facebook Factory</span>
        </div>
        <div className="relative space-y-6">
          <h1 className="max-w-md text-4xl font-semibold leading-tight tracking-tight">
            Tu fábrica de contenido para Facebook, en piloto automático.
          </h1>
          <ul className="space-y-3 text-sidebar-muted">
            {features.map((f) => (
              <li key={f.text} className="flex items-center gap-3">
                <f.icon className="size-5 text-indigo-400" /> {f.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-sidebar-muted">Acceso privado · uso exclusivo del administrador</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1.5">
            <h2 className="text-2xl font-semibold tracking-tight">Bienvenido</h2>
            <p className="text-sm text-muted-foreground">Ingresá con tu cuenta de administrador.</p>
          </div>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
